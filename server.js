import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import {
  amount,
  createPayload,
  fabrickRequest,
  successfulDetail,
  tokenFromDetail,
} from './fabrick.js';
import { errorPage, homePage, sessionPage } from './views.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const envFile = `${root}.env`;
const sessions = new Map();
const csrf = randomBytes(24).toString('hex');

function readDotEnv() {
  const values = {};
  if (!fs.existsSync(envFile)) return values;

  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)\s*$/);
    if (match) {
      values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return values;
}

const bootEnv = readDotEnv();
const port = Number(process.env.PORT || bootEnv.PORT || 3000);
const appOrigin = (
  process.env.APP_ORIGIN || bootEnv.APP_ORIGIN || `http://localhost:${port}`
).replace(/\/$/, '');
const s2sOrigin = (
  process.env.FABRICK_S2S_ORIGIN || bootEnv.FABRICK_S2S_ORIGIN || ''
).replace(/\/$/, '');

function credentials() {
  const fileEnv = readDotEnv();
  return {
    shopLogin: (process.env.FABRICK_SHOP_LOGIN || fileEnv.FABRICK_SHOP_LOGIN || '').trim(),
    apiKey: (process.env.FABRICK_API_KEY || fileEnv.FABRICK_API_KEY || '').trim(),
  };
}

function requireCredentials(config) {
  if (!config.shopLogin || !config.apiKey || config.apiKey === 'replace-me') {
    throw new Error('Configura FABRICK_SHOP_LOGIN e FABRICK_API_KEY nel file .env.');
  }
}

function send(res, status, body, contentType = 'text/html; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

async function readForm(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 12000) throw new Error('Modulo troppo grande.');
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function requireCsrf(form) {
  if (form.csrf !== csrf) throw new Error('Aggiorna la pagina e riprova.');
}

function trace(title, method, path, request, result) {
  return {
    title,
    method,
    path,
    request,
    response: result.data,
    httpStatus: result.httpStatus,
  };
}

async function callFabrick(options) {
  const startedAt = Date.now();
  try {
    const result = await fabrickRequest(options);
    const code = result.data?.error?.code ?? '—';
    const elapsed = Date.now() - startedAt;
    console.log(
      `[Fabrick] ${options.method} ${options.path} -> `
      + `HTTP ${result.httpStatus}, code ${code} (${elapsed} ms)`,
    );
    return result;
  } catch (error) {
    console.error(`[Fabrick] ${options.method} ${options.path} -> ${error.message}`);
    throw error;
  }
}

function createdSuccessfully(result) {
  const payload = result.data?.payload;
  return String(result.data?.error?.code) === '0'
    && Boolean(payload?.paymentID)
    && Boolean(payload?.paymentToken);
}

function newSession({ payload, result, kind, method, title, firstPaymentID }) {
  return {
    paymentID: String(result.data.payload.paymentID),
    paymentToken: String(result.data.payload.paymentToken),
    firstPaymentID,
    shopLogin: payload.shopLogin,
    shopTransactionID: payload.shopTransactionID,
    amount: payload.amount,
    authAmount: payload.transDetails?.authenticationAmount,
    kind,
    method,
    createdAt: new Date().toLocaleString('it-IT'),
    traces: [trace(title, 'POST', '/payment/create', payload, result)],
  };
}

async function refreshSession(session, config) {
  const path = `/payment/detail/${encodeURIComponent(session.paymentID)}`;
  const result = await callFabrick({
    method: 'GET',
    path,
    apiKey: config.apiKey,
  });
  session.traces.push(trace('Verifica esito e token', 'GET', path, null, result));
  session.detail = result.data;

  console.log(`[REFRESH] Refreshed session for paymentID: ${session.paymentID} with detail: ${JSON.stringify(session.detail)}`);

  if (session.kind.endsWith('First') && successfulDetail(result.data)) {
    session.token = tokenFromDetail(result.data);
  }
  return result;
}

function sendCreateError(res, title, traceTitle, result, payload) {
  const message = result.data?.error?.description || 'Risposta inattesa dal sandbox.';
  const log = trace(traceTitle, 'POST', '/payment/create', payload, result);
  send(res, 502, errorPage(title, message, log));
}

async function handleReturn(url, res, config) {
  const session = sessions.get(url.searchParams.get('paymentID'));
  if (!session) {
    const message = 'Il server è stato riavviato oppure la transazione non è disponibile.';
    return send(res, 404, errorPage('Transazione non trovata', message));
  }

  const returnStatus = url.searchParams.get('Status');
  if (
    ['OK', 'KO', 'XX'].includes(returnStatus)
    && url.searchParams.get('paymentToken') === session.paymentToken
  ) {
    session.returnStatus = returnStatus;
  }

  let note = `Fabrick ha riportato Status=${returnStatus || '—'}. `
    + 'L’app ha richiesto payment/detail per la conferma.';
  try {
    await refreshSession(session, config);
  } catch (error) {
    note += ` Verifica non riuscita: ${error.message}`;
  }
  send(res, 200, sessionPage(session, { note, csrf }));
}

async function handleSession(url, res, config, paymentID) {
  const session = sessions.get(paymentID);
  console.log(`[SESSION] Handling session for paymentID: ${paymentID}`);
  if (!session) {
    console.log(`[SESSION] No session found for paymentID: ${paymentID}`);
    return send(res, 404, errorPage(
      'Transazione non trovata',
      'La sessione non è disponibile in memoria.',
    ));
  }

  let note = '';
  if (url.searchParams.has('refresh')) {
    try {
      await refreshSession(session, config);
    } catch (error) {
      note = `Verifica non riuscita: ${error.message}`;
    }
  }
  send(res, 200, sessionPage(session, { note, csrf }));
}

async function handleCreate(req, res, config) {
  const form = await readForm(req);
  requireCsrf(form);
  requireCredentials(config);
  if (!['lightbox', 'component'].includes(form.method)) {
    throw new Error('Metodo di checkout non valido.');
  }

  const payload = createPayload({
    shopLogin: config.shopLogin,
    kind: form.kind,
    amountValue: form.amount,
    authAmount: form.authAmount,
    frequency: form.frequency,
    expiry: form.expiry,
    responseOrigin: appOrigin,
    s2sOrigin,
  });
  console.log(`[CREATE] Payload: ${JSON.stringify(payload)}`);
  const result = await callFabrick({
    method: 'POST',
    path: '/payment/create',
    apiKey: config.apiKey,
    body: payload,
  });

  if (!createdSuccessfully(result)) {
    console.log(`[CREATE] Error: ${JSON.stringify(result.data?.error)}`);
    return sendCreateError(
      res, 'Fabrick non ha creato la sessione', 'Crea sessione', result, payload
    );
  }

  const session = newSession({
    payload,
    result,
    kind: form.kind,
    method: form.method,
    title: 'Crea sessione',
  });
  sessions.set(session.paymentID, session);
  redirect(res, `/sessions/${encodeURIComponent(session.paymentID)}`);
}

async function submitNext(session, token) {
  const path = '/payment/submit';
  const body = {
    shopLogin: session.shopLogin,
    paymentType: 'CREDITCARD',
    paymentTypeDetails: { creditcard: { token } },
  };
  const request = {
    header: { PaymentToken: session.paymentToken },
    body,
  };

  try {
    const result = await callFabrick({
      method: 'POST',
      path,
      paymentToken: session.paymentToken,
      body,
    });
    session.submit = result.data;
    session.traces.push(trace('Addebita con il token', 'POST', path, request, result));
  } catch (error) {
    session.traces.push({
      title: 'Addebita con il token',
      method: 'POST',
      path,
      request,
      response: { error: error.message },
    });
  }
}

async function handleNext(req, res, config) {
  const form = await readForm(req);
  requireCsrf(form);
  requireCredentials(config);

  const first = sessions.get(form.firstPaymentID);
  const ready = first?.kind.endsWith('First')
    && successfulDetail(first.detail)
    && Boolean(first.token);
  if (!ready) {
    throw new Error('Verifica prima l’esito del primo pagamento e il token.');
  }
  if (first.shopLogin !== config.shopLogin) {
    throw new Error('Usa lo stesso shopLogin del primo pagamento.');
  }
  if (Number(amount(form.amount)) > Number(first.authAmount)) {
    throw new Error('L’importo supera il massimo autorizzato nel primo pagamento.');
  }

  const kind = first.kind === 'scheduledFirst' ? 'scheduledNext' : 'unscheduledNext';
  const payload = createPayload({
    shopLogin: config.shopLogin,
    kind,
    amountValue: form.amount,
    firstPaymentID: first.paymentID,
    responseOrigin: appOrigin,
    s2sOrigin,
  });
  const result = await callFabrick({
    method: 'POST',
    path: '/payment/create',
    apiKey: config.apiKey,
    body: payload,
  });
  console.log(`[CREATE] Result for payment creation: ${JSON.stringify(result)}`);

  if (!createdSuccessfully(result)) {
    console.log(`[CREATE] Payment creation failed: ${JSON.stringify(result)}`);
    return sendCreateError(
      res, 'Fabrick non ha creato l’addebito', 'Crea addebito', result, payload
    );
  }

  const session = newSession({
    payload,
    result,
    kind,
    method: 'api',
    title: 'Crea addebito',
    firstPaymentID: first.paymentID,
  });
  sessions.set(session.paymentID, session);
  await submitNext(session, first.token);
  redirect(res, `/sessions/${encodeURIComponent(session.paymentID)}`);
}

function handleNotification(url, res, config) {
  const paymentID = url.searchParams.get('paymentID');
  const session = sessions.get(paymentID);
  console.log(`[NOTIFICATION] Received paymentID: ${JSON.stringify(paymentID)}`);

  // Fabrick expects an immediate 200 response with an empty body.
  send(res, 200, '', 'text/plain; charset=utf-8');

  if (!session) {
    console.log(`[NOTIFICATION] No session found for paymentID: ${JSON.stringify(paymentID)}`);
    return;
  }

  refreshSession(session, config).catch(error => {
    console.error(`[NOTIFICATION] Verification failed: ${error.message}`);
  });
}

async function handle(req, res) {
  const config = credentials();
  const url = new URL(req.url, appOrigin);

  if (req.method === 'GET' && url.pathname === '/style.css') {
    const css = fs.readFileSync(`${root}style.css`, 'utf8');
    return send(res, 200, css, 'text/css; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname === '/client.js') {
    const javascript = fs.readFileSync(`${root}client.js`, 'utf8');
    return send(res, 200, javascript, 'text/javascript; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname === '/') {
    const configured = Boolean(
      config.shopLogin && config.apiKey && config.apiKey !== 'replace-me'
    );
    return send(res, 200, homePage({
      shopLogin: config.shopLogin,
      configured,
      csrf,
      sessions,
    }));
  }
  if (req.method === 'GET' && url.pathname === '/return') {
    return handleReturn(url, res, config);
  }

  const sessionMatch = url.pathname.match(/^\/sessions\/(\d+)$/);
  if (req.method === 'GET' && sessionMatch) {
    return handleSession(url, res, config, sessionMatch[1]);
  }
  if (req.method === 'POST' && url.pathname === '/payments') {
    return handleCreate(req, res, config);
  }
  if (req.method === 'POST' && url.pathname === '/payments/next') {
    return handleNext(req, res, config);
  }
  if (['GET', 'POST'].includes(req.method) && url.pathname === '/notification') {
    return handleNotification(url, res, config);
  }
  send(res, 404, errorPage('Pagina non trovata', 'Controlla l’indirizzo e riprova.'));
}

export const server = http.createServer((req, res) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const path = new URL(req.url, appOrigin).pathname;
    const elapsed = Date.now() - startedAt;
    console.log(`[HTTP] ${req.method} ${path} -> ${res.statusCode} (${elapsed} ms)`);
  });
  handle(req, res).catch(error => {
    send(res, 500, errorPage('Operazione non riuscita', error.message));
  });
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(port, '127.0.0.1', () => {
    console.log(`Fabrick Lab: http://localhost:${port}`);
  });
}

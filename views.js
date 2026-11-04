import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { successfulDetail } from './fabrick.js';

const templateDir = fileURLToPath(new URL('./templates/', import.meta.url));
const docsBase = 'https://docs.fabrick.com/en/payment-hub-and-orchestra/ecommerce/';

const sdkUrls = {
  lightbox: 'https://sandbox.gestpay.net/pagam/javascript/axerve.js',
  component: 'https://sandbox-web.axerve.com/orchestra/checkout/assets/elements/fbk-elements.js',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[character];
  });
}

// Double braces escape data. Triple braces are only for HTML built by another template.
function render(name, values = {}) {
  const template = fs.readFileSync(`${templateDir}${name}.html`, 'utf8');
  return template.replace(/{{{(\w+)}}}|{{(\w+)}}/g, (_, rawKey, escapedKey) => {
    if (rawKey) return String(values[rawKey] ?? '');
    return escapeHtml(values[escapedKey]);
  });
}

function layout(title, content, sdkUrl = '') {
  const sdkScript = sdkUrl ? render('sdk-script', { url: sdkUrl }) : '';
  return render('layout', {
    title,
    content,
    sdkScript,
    docsUrl: `${docsBase}integration-methods/`,
  });
}

function statusOf(session) {
  const detailOK = String(session.detail?.error?.code) === '0';
  const submitOK = String(session.submit?.error?.code) === '0';
  const result = detailOK
    ? session.detail?.payload?.transactionResult
    : submitOK ? session.submit?.payload?.transactionResult : null;

  if (['APPROVED', 'AUTHENTICATED', 'OK'].includes(result)) {
    return { label: 'Approvato', className: 'success' };
  }
  if (['DECLINED', 'KO'].includes(result)) {
    return { label: 'Rifiutato', className: 'danger' };
  }
  if (['PENDING', 'WAITING', 'UNSUBMITTED'].includes(result)) {
    return { label: result, className: 'warning' };
  }
  return { label: 'Da verificare', className: 'neutral' };
}

function transactionRow(session) {
  const status = statusOf(session);
  const kindLabel = session.kind === 'oneoff'
    ? 'Pagamento singolo'
    : session.kind.endsWith('First') ? 'Primo pagamento' : 'Addebito successivo';

  return render('transaction', {
    paymentID: session.paymentID,
    icon: session.kind === 'oneoff' ? '↗' : '↻',
    kindLabel,
    createdAt: session.createdAt,
    amount: session.amount,
    statusLabel: status.label,
    statusClass: status.className,
  });
}

export function homePage({ shopLogin, configured, csrf, sessions }) {
  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + 1);

  const history = sessions.size
    ? [...sessions.values()].reverse().map(transactionRow).join('')
    : render('empty-history');

  const content = render('home', {
    csrf,
    expiry: expiry.toISOString().slice(0, 10),
    configClass: configured ? 'success' : 'warning',
    configLabel: configured ? 'Pronto' : 'Da configurare',
    shopLabel: configured ? shopLogin : '—',
    apiLabel: configured ? 'Configurata sul server' : 'Mancante',
    configHint: configured
      ? 'Puoi iniziare creando una transazione.'
      : 'Copia .env.example in .env e inserisci le credenziali sandbox.',
    submitDisabled: configured ? '' : 'disabled',
    recurringDocsUrl: `${docsBase}features/recurring-payments/`,
    history,
  });

  return layout('Panoramica', content);
}

export function errorPage(title, message, trace = null) {
  const traceHtml = trace
    ? render('error-trace', { traceJson: JSON.stringify(trace, null, 2) })
    : '';
  return layout(title, render('error', { title, message, trace: traceHtml }));
}

function traceBlock(trace, index) {
  return render('trace', {
    open: index === 0 ? 'open' : '',
    number: String(index + 1).padStart(2, '0'),
    title: trace.title,
    method: trace.method,
    path: trace.path,
    httpStatus: trace.httpStatus ?? '—',
    requestJson: JSON.stringify(trace.request ?? {}, null, 2),
    responseJson: JSON.stringify(trace.response ?? {}, null, 2),
  });
}

function componentHasEnded(session) {
  if (session.method !== 'component') return false;

  const result = String(session.detail?.error?.code) === '0'
    ? session.detail?.payload?.transactionResult
    : null;
  const finalResults = ['APPROVED', 'AUTHENTICATED', 'DECLINED'];
  return Boolean(session.returnStatus) || finalResults.includes(result);
}

function checkoutFor(session) {
  if (session.kind.endsWith('Next')) return render('checkout-next');
  if (componentHasEnded(session)) return render('checkout-finished');
  const template = session.method === 'lightbox'
    ? 'checkout-lightbox'
    : 'checkout-component';
  return render(template, session);
}

function nextPanelFor(session, csrf) {
  if (!session.kind.endsWith('First')) return '';

  const ready = successfulDetail(session.detail) && Boolean(session.token);
  const content = ready
    ? render('next-ready', {
      csrf,
      paymentID: session.paymentID,
      amount: session.amount === '0.00' ? session.authAmount : session.amount,
    })
    : render('next-waiting');

  return render('next-panel', { content });
}

function factsFor(session) {
  const methodNames = {
    lightbox: 'Lightbox',
    component: 'Web Component',
    api: 'Server API',
  };
  const facts = [
    ['Importo', `€ ${session.amount}`],
    ['Modalità', methodNames[session.method]],
    ['Tipo', session.kind],
    ['Payment ID', session.paymentID, 'mono'],
  ];
  if (session.kind.endsWith('First')) {
    facts.push(['Token carta/wallet', session.token || 'In attesa', 'mono']);
  }

  const rows = facts.map(([label, value, className = '']) => {
    return render('fact', { label, value, className });
  });
  if (session.kind.endsWith('Next')) {
    rows.push(render('fact-link', {
      label: 'Primo pagamento',
      href: `/sessions/${encodeURIComponent(session.firstPaymentID)}`,
      value: session.firstPaymentID,
    }));
  }
  return rows.join('');
}

function resultMessageFor(session) {
  if (session.detail?.payload) {
    return `Esito verificato: ${session.detail.payload.transactionResult || '—'}`;
  }
  if (session.submit) {
    const outcome = session.submit.payload?.transactionResult
      || session.submit.error?.description
      || '—';
    return `Risposta submit: ${outcome}`;
  }
  return 'Il risultato non è stato ancora verificato con payment/detail.';
}

export function sessionPage(session, { note = '', csrf } = {}) {
  const first = session.kind.endsWith('First');
  const next = session.kind.endsWith('Next');
  const componentEnded = componentHasEnded(session);
  const status = statusOf(session);
  const kindHeading = first
    ? 'PRIMO PAGAMENTO · TOKENIZZAZIONE'
    : next ? 'ADDEBITO SUCCESSIVO · TOKEN' : 'PAGAMENTO SINGOLO';
  const softDecline = String(session.submit?.payload?.transactionErrorCode) === '8026';

  const content = render('session', {
    paymentID: session.paymentID,
    createdAt: session.createdAt,
    shopTransactionID: session.shopTransactionID,
    kindHeading,
    statusClass: status.className,
    statusLabel: status.label,
    note: note ? render('notice', { message: note }) : '',
    softDecline: softDecline ? render('notice', {
      className: 'warning-box',
      message: 'Soft decline (8026): il cliente deve completare un nuovo '
        + 'primo pagamento autenticato prima di altri addebiti.',
    }) : '',
    checkoutHeading: next
      ? 'Addebito dal server'
      : componentEnded ? 'Esito del pagamento' : 'Completa il pagamento',
    checkout: checkoutFor(session),
    testCard: next || componentEnded ? '' : render('test-card'),
    resultMessage: resultMessageFor(session),
    nextPanel: nextPanelFor(session, csrf),
    facts: factsFor(session),
    traces: session.traces.map(traceBlock).join(''),
  });

  const sdkUrl = componentEnded ? '' : sdkUrls[session.method];
  return layout(`Transazione ${session.paymentID}`, content, sdkUrl);
}

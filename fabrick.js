import { randomUUID } from 'node:crypto';

export const FABRICK_API_BASE = 'https://sandbox.gestpay.net/api/v1';

export function amount(value, { allowZero = false } = {}) {
  const input = String(value ?? '').trim().replace(',', '.');
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(input)) {
    throw new Error('Inserisci un importo valido in EUR, con massimo due decimali.');
  }
  const cents = Math.round(Number(input) * 100);
  if (!allowZero && cents === 0) throw new Error('L’importo deve essere maggiore di zero.');
  return (cents / 100).toFixed(2);
}

export function createPayload({ shopLogin, kind, amountValue, authAmount, frequency, expiry, firstPaymentID, responseOrigin, s2sOrigin }) {
  const types = { oneoff: null, scheduledFirst: '01F', unscheduledFirst: '03F', scheduledNext: '01N', unscheduledNext: '03N' };
  if (!(kind in types)) throw new Error('Tipo di transazione non valido.');
  const isFirst = kind.endsWith('First');
  const isNext = kind.endsWith('Next');
  const paidAmount = amount(amountValue, { allowZero: isFirst });
  const payload = {
    shopLogin,
    amount: paidAmount,
    currency: 'EUR',
    shopTransactionID: `LAB-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
  };
  if (responseOrigin) {
    payload.responseURLs = {
      buyerOK: `${responseOrigin}/return`,
      buyerKO: `${responseOrigin}/return`,
    };
    if (s2sOrigin) payload.responseURLs.serverNotificationURL = `${s2sOrigin}/notification`;
  }
  if (isFirst) {
    const maxAmount = amount(authAmount);
    if (Number(maxAmount) < Number(paidAmount)) throw new Error('L’importo massimo autorizzato deve coprire il primo addebito.');
    payload.paymentType = ['CREDITCARD'];
    payload.requestToken = 'MASKEDPAN';
    payload.transDetails = { type: types[kind], authenticationAmount: maxAmount };
    if (kind === 'scheduledFirst') {
      const days = Number(frequency);
      if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('La frequenza deve essere tra 1 e 365 giorni.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expiry)) || Number.isNaN(Date.parse(`${expiry}T00:00:00Z`)) || expiry <= new Date().toISOString().slice(0, 10)) {
        throw new Error('Inserisci una data di scadenza futura.');
      }
      payload.transDetails.recurringTransaction = { expiry: Number(expiry.replaceAll('-', '')), frequency: days };
    }
  }
  if (isNext) {
    if (!/^\d+$/.test(String(firstPaymentID))) throw new Error('Riferimento al primo pagamento non valido.');
    payload.transDetails = { type: types[kind], previousTransDetails: { paymentID: String(firstPaymentID) } };
  }
  return payload;
}

export function tokenFromDetail(data) {
  return data?.payload?.token || data?.payload?.tokenDetails?.TokenValue || null;
}

export function successfulDetail(data) {
  return String(data?.error?.code) === '0' && ['APPROVED', 'AUTHENTICATED'].includes(data?.payload?.transactionResult);
}

export async function fabrickRequest({ method, path, apiKey, body, paymentToken, fetchImpl = fetch }) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `apikey ${apiKey}`;
  if (paymentToken) headers.PaymentToken = paymentToken;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetchImpl(`${FABRICK_API_BASE}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal,
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { error: { code: String(response.status), description: raw.slice(0, 500) || 'Risposta non JSON' } }; }
    return { httpStatus: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

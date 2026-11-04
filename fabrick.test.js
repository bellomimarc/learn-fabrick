import test from 'node:test';
import assert from 'node:assert/strict';
import { amount, createPayload, fabrickRequest, successfulDetail, tokenFromDetail } from './fabrick.js';

const base = { shopLogin: 'GESPAY12345', responseOrigin: 'http://localhost:3000' };

test('one-off payload uses server-side create with browser return URLs', () => {
  const payload = createPayload({ ...base, kind: 'oneoff', amountValue: '12,50' });
  assert.equal(payload.amount, '12.50');
  assert.equal(payload.currency, 'EUR');
  assert.equal(payload.responseURLs.buyerOK, 'http://localhost:3000/return');
  assert.equal(payload.responseURLs.buyerKO, 'http://localhost:3000/return');
  assert.equal(payload.requestToken, undefined);
});

test('scheduled first and next contain the documented recurring fields', () => {
  const first = createPayload({ ...base, kind: 'scheduledFirst', amountValue: '0', authAmount: '25', frequency: '30', expiry: '2028-12-31' });
  assert.equal(first.requestToken, 'MASKEDPAN');
  assert.deepEqual(first.paymentType, ['CREDITCARD']);
  assert.deepEqual(first.transDetails, { type: '01F', authenticationAmount: '25.00', recurringTransaction: { expiry: 20281231, frequency: 30 } });
  const next = createPayload({ ...base, kind: 'scheduledNext', amountValue: '9.99', firstPaymentID: '123456789' });
  assert.deepEqual(next.transDetails, { type: '01N', previousTransDetails: { paymentID: '123456789' } });
  assert.equal(next.requestToken, undefined);
});

test('unscheduled first and next use 03F and 03N', () => {
  const first = createPayload({ ...base, kind: 'unscheduledFirst', amountValue: '1', authAmount: '10' });
  const next = createPayload({ ...base, kind: 'unscheduledNext', amountValue: '2', firstPaymentID: '1234' });
  assert.equal(first.transDetails.type, '03F');
  assert.equal(next.transDetails.type, '03N');
});

test('rejects invalid monetary and recurrence inputs', () => {
  assert.throws(() => amount('-1'));
  assert.throws(() => amount('1.999'));
  assert.throws(() => createPayload({ ...base, kind: 'scheduledFirst', amountValue: '20', authAmount: '10', frequency: '30', expiry: '2028-12-31' }));
  assert.throws(() => createPayload({ ...base, kind: 'scheduledFirst', amountValue: '0', authAmount: '10', frequency: '0', expiry: '2028-12-31' }));
});

test('detail is authoritative for the reusable token', () => {
  const detail = { error: { code: '0' }, payload: { transactionResult: 'APPROVED', token: 'TOKEN123' } };
  assert.equal(successfulDetail(detail), true);
  assert.equal(tokenFromDetail(detail), 'TOKEN123');
  assert.equal(successfulDetail({ ...detail, payload: { transactionResult: 'PENDING', token: 'TOKEN123' } }), false);
});

test('API request keeps the API key in the Authorization header and session token in PaymentToken', async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return { status: 200, text: async () => '{"error":{"code":"0"},"payload":{}}' };
  };
  await fabrickRequest({ method: 'POST', path: '/payment/submit', paymentToken: 'SESSION', body: { paymentType: 'CREDITCARD' }, fetchImpl });
  assert.equal(captured.options.headers.PaymentToken, 'SESSION');
  assert.equal(captured.options.headers.Authorization, undefined);
  assert.match(captured.url, /sandbox\.gestpay\.net\/api\/v1\/payment\/submit$/);
  await fabrickRequest({ method: 'GET', path: '/payment/detail/123', apiKey: 'SECRET', fetchImpl });
  assert.equal(captured.options.headers.Authorization, 'apikey SECRET');
});

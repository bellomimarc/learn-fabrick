import test from 'node:test';
import assert from 'node:assert/strict';
import { errorPage, homePage, sessionPage } from './views.js';

function firstSession() {
  return {
    paymentID: '123456',
    paymentToken: 'SESSION-TOKEN',
    shopLogin: 'GESPAY12345',
    shopTransactionID: 'ORDER-1',
    amount: '0.00',
    authAmount: '10.00',
    kind: 'scheduledFirst',
    method: 'lightbox',
    createdAt: '4/11/2026',
    traces: [{
      title: 'Crea sessione',
      method: 'POST',
      path: '/payment/create',
      request: { amount: '0.00' },
      response: { error: { code: '0' } },
      httpStatus: 200,
    }],
  };
}

test('home renders the payment form and escapes the shop name', () => {
  const html = homePage({
    shopLogin: '<script>alert(1)</script>',
    configured: true,
    csrf: 'TEST-CSRF',
    sessions: new Map(),
  });
  assert.match(html, /action="\/payments"/);
  assert.match(html, /value="TEST-CSRF"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test('first payment page shows checkout and enables next only after verified token', () => {
  const session = firstSession();
  const waiting = sessionPage(session, { csrf: 'TEST-CSRF' });
  assert.match(waiting, /id="open-lightbox"/);
  assert.doesNotMatch(waiting, /action="\/payments\/next"/);

  session.detail = {
    error: { code: '0' },
    payload: { transactionResult: 'APPROVED' },
  };
  session.token = 'CARD-TOKEN';
  const ready = sessionPage(session, { csrf: 'TEST-CSRF' });
  assert.match(ready, /action="\/payments\/next"/);
  assert.match(ready, /value="10.00"/);
  assert.match(ready, /CARD-TOKEN/);
  assert.match(ready, /sandbox\.gestpay\.net\/pagam\/javascript\/axerve\.js/);
});

test('completed Web Component is not mounted again after payment/detail', () => {
  const session = { ...firstSession(), method: 'component', kind: 'oneoff' };
  const checkout = sessionPage(session);
  assert.match(checkout, /<fbk-checkout/);
  assert.match(checkout, /fbk-elements\.js/);

  session.detail = {
    error: { code: '0' },
    payload: { transactionResult: 'APPROVED' },
  };
  const outcome = sessionPage(session);
  assert.match(outcome, /Checkout terminato/);
  assert.match(outcome, /Approvato/);
  assert.doesNotMatch(outcome, /<fbk-checkout/);
  assert.doesNotMatch(outcome, /fbk-elements\.js/);
});

test('Web Component stays unmounted after a pending browser return', () => {
  const session = {
    ...firstSession(),
    method: 'component',
    kind: 'oneoff',
    returnStatus: 'XX',
    detail: {
      error: { code: '0' },
      payload: { transactionResult: 'PENDING' },
    },
  };
  const outcome = sessionPage(session);
  assert.match(outcome, /Checkout terminato/);
  assert.match(outcome, /PENDING/);
  assert.doesNotMatch(outcome, /<fbk-checkout/);
  assert.doesNotMatch(outcome, /fbk-elements\.js/);
});

test('error page escapes remote descriptions', () => {
  const html = errorPage('Errore', '<img src=x onerror=alert(1)>');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});

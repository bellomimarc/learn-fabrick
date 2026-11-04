const form = document.getElementById('payment-form');
if (form) {
  const update = () => {
    const kind = form.elements.kind.value;
    const recurring = kind !== 'oneoff';
    form.querySelector('.recurring-fields').hidden = !recurring;
    const scheduled = kind === 'scheduledFirst';
    const scheduledFields = form.querySelector('.scheduled-fields');
    scheduledFields.hidden = !scheduled;
    scheduledFields.querySelectorAll('input').forEach(input => { input.disabled = !scheduled; });
    const amount = form.elements.amount;
    if (recurring && amount.value === '10.00') amount.value = '0.00';
    if (!recurring && amount.value === '0.00') amount.value = '10.00';
  };
  form.querySelectorAll('input[name="kind"]').forEach(input => input.addEventListener('change', update));
  update();
}

const lightboxButton = document.getElementById('open-lightbox');
if (lightboxButton) {
  const status = document.getElementById('sdk-status');
  const waitForSdk = () => {
    if (window.axerve?.lightBox) {
      window.axerve.lightBox.shop = lightboxButton.dataset.shop;
      status.textContent = 'Checkout pronto. Inserisci i dati solo nel popup Fabrick.';
    } else {
      status.textContent = 'Il checkout Fabrick non è stato caricato. Controlla connessione e blocco popup.';
    }
  };
  window.addEventListener('load', waitForSdk);
  lightboxButton.addEventListener('click', () => {
    if (!window.axerve?.lightBox) return waitForSdk();
    status.textContent = 'Pagamento in corso nella Lightbox…';
    window.axerve.lightBox.open(lightboxButton.dataset.paymentId, lightboxButton.dataset.paymentToken, response => {
      const result = response?.status || '—';
      status.textContent = `Callback ricevuta: ${result}. Verifica dell’esito sul server…`;
      window.location.assign(`/sessions/${encodeURIComponent(lightboxButton.dataset.paymentId)}?refresh=1`);
    });
  });
}

const component = document.querySelector('fbk-checkout');
if (component) {
  const status = document.getElementById('sdk-status');
  window.addEventListener('load', () => {
    status.textContent = customElements.get('fbk-checkout') ? 'Componente caricato. Il pagamento è gestito da Fabrick.' : 'Il componente Fabrick non è stato caricato. Controlla la connessione.';
  });
  window.addEventListener('fbk-elements-error', event => {
    status.textContent = event.detail?.message || 'Il componente Fabrick ha segnalato un errore.';
  });
}

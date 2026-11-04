# Fabrick Lab

App SSR locale per esplorare Fabrick Payment Orchestra nel **sandbox**. La pagina HTML viene generata da Node.js; il browser carica soltanto gli script ufficiali di Lightbox o Web Component. La chiave API resta sul server e i dati della carta vengono inseriti nell'interfaccia Fabrick.

## Avvio

Richiede Node.js 20 o superiore. Non ci sono dipendenze da installare.

```bash
cp .env.example .env
```

Nel file `.env`, inserisci `FABRICK_SHOP_LOGIN` e `FABRICK_API_KEY` della sandbox. La chiave si crea nella Gestpay Dashboard, in **Configuration → Security → APIKEY**. Verifica che la configurazione di sicurezza autorizzi le richieste API dalla tua macchina.

Se il server è già avviato, aggiorna semplicemente la pagina dopo aver salvato `.env`: le credenziali vengono rilette a ogni richiesta. Per cambiare `PORT`, `APP_ORIGIN` o `FABRICK_S2S_ORIGIN`, riavvia il server.

```bash
npm start
```

Apri [http://localhost:3000](http://localhost:3000). Il server ascolta solo su `127.0.0.1`.
Lascia aperto il terminale: qui compaiono le richieste HTTP e le chiamate a Fabrick,
con codice di risposta e durata. I log non mostrano la chiave API né il token.
Ferma il server con `Ctrl+C`.

## Prove guidate

1. **Pagamento singolo:** scegli Lightbox o Web Component, inserisci l'importo e crea la sessione. Completa il pagamento con una [carta di test Fabrick](https://docs.fabrick.com/payment-hub-and-orchestra/ecommerce/testing/sandbox-cards/). Nella pagina della transazione, usa **Aggiorna da payment/detail** per confermare l'esito.
2. **Ricorrenza:** scegli “Ricorrente fisso” (`01F`/`01N`) oppure “Ricorrente variabile” (`03F`/`03N`). Completa il primo pagamento: Fabrick autentica il cliente e genera un token. Dopo la verifica dell'esito, il laboratorio mostra il token e abilita il pulsante per l'addebito successivo. Quest'ultimo usa `payment/create`, poi `payment/submit` con `PaymentToken` nell'header e il token carta nel body.
3. **Capire l'integrazione:** apri la sezione **Chiamate API** di ogni transazione per vedere il JSON inviato e la risposta. La chiave API viene omessa.

## Dove leggere il codice

- `server.js`: riceve le richieste HTTP, valida i form, chiama Fabrick e conserva le sessioni in memoria.
- `fabrick.js`: costruisce i payload e invia le richieste alle API sandbox.
- `views.js`: prepara i dati da mostrare e li passa ai template.
- `templates/*.html`: contiene l'HTML delle pagine e dei singoli componenti.
- `client.js`: mostra i campi del form e avvia Lightbox o Web Component nel browser.

I template usano `{{nome}}` per inserire testo con escape HTML e `{{{nome}}}`
solo per inserire frammenti HTML prodotti da altri template. In questo modo
`server.js` non contiene markup.

Per seguire `server.js`, parti dalla funzione `handle()` in fondo al file:

1. `GET /` mostra il form.
2. `POST /payments` crea un pagamento singolo o il primo pagamento ricorrente.
3. `GET /sessions/:id` mostra la sessione; con `?refresh=1` legge `payment/detail`.
4. `POST /payments/next` crea e invia un addebito ricorrente tramite token.
5. `/return` e `/notification` gestiscono rispettivamente ritorno del browser
   e notifica server-to-server, confermando l'esito con `payment/detail`.

L'importo è espresso in **euro**, per esempio `10.00`. Per il primo pagamento ricorrente puoi usare `0.00` (verifica del metodo di pagamento) e un importo massimo autorizzato maggiore di zero. L'app non pianifica i futuri addebiti: il pulsante simula un singolo “Next” manuale. L'accordo commerciale con il cliente resta responsabilità dell'esercente.

## Redirect e notifiche

`buyerOK` e `buyerKO` sono redirect del **browser**, non email. Con il browser sullo
stesso computer, `APP_ORIGIN=http://localhost:3000` funziona. La Lightbox usa
anche una callback; il Web Component può reindirizzare alla pagina `/return`.
Quando il browser torna su `/return`, la pagina mostra l'esito senza rimontare
il Web Component della stessa transazione. Anche un aggiornamento della pagina
di una transazione già approvata o rifiutata non riavvia il checkout.
Se il browser gira su un altro dispositivo, imposta `APP_ORIGIN` a un URL che
quel dispositivo può raggiungere.

La notifica **server-to-server** di Fabrick richiede invece un URL pubblico.
Per provarla, lascia l'app sulla porta 3000 e avvia in un altro terminale:

```bash
ngrok http 3000
```

Copia l'origine HTTPS mostrata da ngrok, senza `/notification`, nel file `.env`:

```dotenv
FABRICK_S2S_ORIGIN=https://example.ngrok-free.app
```

Riavvia l'app e **crea una nuova transazione**: il payload conterrà
`responseURLs.serverNotificationURL` impostato a
`https://example.ngrok-free.app/notification`. La transazione già creata non
cambia. L'endpoint risponde subito con HTTP 200 e poi rilegge `payment/detail`
per verificare l'esito. Puoi vedere l'arrivo della notifica nei log del server.

Il tunnel espone l'intera app locale: usalo solo per i test sandbox e chiudilo
alla fine. Senza tunnel, il pulsante di verifica manuale permette comunque di
controllare l'esito tramite `payment/detail`.

Le sessioni e i token sono conservati **solo in memoria** e scompaiono al riavvio. Non usare questa app con credenziali di produzione o carte reali.

## Documentazione di riferimento

- [Metodi di integrazione](https://docs.fabrick.com/en/payment-hub-and-orchestra/ecommerce/integration-methods/)
- [Lightbox](https://docs.fabrick.com/en/payment-hub-and-orchestra/ecommerce/integration-methods/lightbox/)
- [Web Components](https://docs.fabrick.com/en/payment-hub-and-orchestra/ecommerce/integration-methods/web-component/)
- [Pagamenti ricorrenti](https://docs.fabrick.com/en/payment-hub-and-orchestra/ecommerce/features/recurring-payments/)
- [Sandbox](https://docs.fabrick.com/payment-hub-and-orchestra/ecommerce/testing/sandbox-env/)

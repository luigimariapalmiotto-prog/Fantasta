# FantAsta — beta

App web per gestire un'asta del Fantacalcio in tempo reale da più telefoni/browser.
Nessuna dipendenza da installare: serve solo Node.js.

## Avvio (3 passi)

1. Installa Node.js (versione 18 o superiore) da https://nodejs.org — scarica la versione "LTS" e fai avanti-avanti-fine.
2. Apri il terminale nella cartella `fantasta`
   - Windows: apri la cartella, tieni premuto Shift e clicca col destro → "Apri nel terminale"
   - Mac: apri Terminale e scrivi `cd ` seguito dal trascinamento della cartella dentro la finestra, poi Invio
3. Scrivi `node server.js` e premi Invio.

Il terminale stampa due indirizzi:
- `http://localhost:3000` → per il computer su cui gira
- `http://192.168.x.x:3000` → per i telefoni, che devono essere sullo **stesso Wi-Fi**

## Test del flusso

1. Sul computer apri `http://localhost:3000` → "Crea una stanza" → compila lega, partecipanti, budget, timer, nomi → "Crea stanza".
2. Appare il codice stanza e la tabella con username/password. "Copia tutte le credenziali" e inviale su WhatsApp.
3. "Vai alla console del master": vedi la lobby con chi è entrato (✅/❌).
4. Ogni partecipante apre l'indirizzo `http://192.168.x.x:3000` dal telefono, inserisce codice, username, password → entra in lobby.
5. Il master preme "Avvia asta". Esce un calciatore casuale su tutti gli schermi.
6. I partecipanti rilanciano con **+1** o con l'offerta manuale. Il timer parte alla prima offerta e si azzera a ogni rilancio.
7. A zero: "AGGIUDICATO", il budget del vincitore scende, dopo 4 secondi esce il prossimo.
8. Scheda "Rose" in qualsiasi momento; "Termina asta" (master) mostra il riepilogo finale a tutti.

Controlli master: Avvia asta · Pausa/Riprendi · Estrai prossimo (salta il calciatore corrente, che torna nel mazzo) · Termina asta.

## Note

- Lo stato vive in memoria: se chiudi il terminale l'asta si perde (voluto per la beta).
- Se il telefono ricarica la pagina, rientra da solo nella stanza (stessa scheda del browser).
- Il master non fa offerte dalla console: per giocare usa un'utenza partecipante da un altro dispositivo o da un'altra scheda in incognito.
- Il master decide anche quando l'asta finisce: non c'è un limite automatico di giocatori per rosa.
- Per giocare da reti diverse (non stesso Wi-Fi) basta pubblicare la cartella su un servizio gratuito Node (es. Render o Railway, comando di avvio `node server.js`) oppure esporre la porta 3000 con `npx localtunnel --port 3000`.

## File

- `server.js` — server, regole d'asta, timer, aggiornamenti in tempo reale
- `public/index.html` — interfaccia (mobile-first)
- `players.json` — 609 calciatori estratti dal PDF (nome, squadra, ruolo, costo listone). Allenatori esclusi.
- `extract_players.py` — script usato per estrarre i dati dal PDF (opzionale, richiede `pip install pdfplumber`)

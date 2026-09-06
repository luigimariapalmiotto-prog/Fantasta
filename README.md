# FantAsta — beta

Dalla home: pulsante **Come funziona · demo guidata** (`public/tour.js`): percorso di 23 passi con spotlight sulle schermate reali, stati dimostrativi (nessuna stanza reale, nessuna chiamata al server); lo stato In solitaria dell'utente viene salvato e ripristinato all'uscita.

Due modalità dalla home:
- **In solitaria**: Fantalgoritmo come copilota durante un'asta che si svolge altrove (setup budget e composizione rosa; ricerca giocatore; prezzo attuale → COMPRA/RILANCIA · VICINO AL LIMITE · LASCIA; valore Fantalgoritmo e limite consigliato dinamico; AFFARE/CORRETTO/CARO/SOVRAPREZZATO; piano B; "l'ho comprato" / "venduto ad altro"; la mia rosa; chi posso comprare; confronto; inflazione dell'asta e distribuzione del budget residuo). Stato salvato nel browser (localStorage).
- **Asta con gli amici**: la modalità multiplayer descritta sotto, con in più: composizione rosa impostata dal master, modalità di chiamata (random / chiamata del master con "estrai random"), consigli Fantalgoritmo sul calciatore in asta (valore, tuo limite consigliato, verdetto RILANCIA / VICINO AL LIMITE / LASCIA sull'offerta corrente, AFFARE…SOVRAPREZZATO) e pilota automatico (imposta come rilancio automatico il limite consigliato e passa sui calciatori che non servono).

## Base dati Fantalgoritmo

- `fantalgoritmo.xlsx` — il file Fantalgoritmo (base 1000 FM). Per aggiornarlo: sostituisci il file e lancia `python3 build_data.py` (richiede `pip install openpyxl`), poi ricarica `public/data.json` sul sito.
- `public/data.json` — dataset unito listone + Excel usato dall'app. Colonne economiche riparametrate in app: P. Med. Aste (valore Fantalgoritmo), P. stat., P. Gol M. × budget/1000. IA, fascia, note, SOS, quotazione, FV, trend e statistiche non vengono riparametrati.
- `senza_excel.csv` — calciatori del listone senza riga Fantalgoritmo; `senza_listone.csv` — righe Excel non presenti nel listone. Rigenerati da `build_data.py`.
- Logica consigli in `public/fa.js`: inflazione prudente (peso n/(n+8), cap ±30%, per ruolo da 5 vendite), limite consigliato = min(valore corretto per inflazione (+20% se sotto budget nel ruolo), quota del ruolo meno il minimo per gli altri slot, budget meno 1 FM per ogni altro slot). In modalità condivisa entra anche la concorrenza: +3% per ogni avversario che ha ancora slot nel ruolo e budget per arrivare al valore (max +10%); se nessun avversario ha più bisogno di quel ruolo il limite è l'offerta base; il limite non supera mai di più di 1 FM il massimo che il miglior avversario può ancora offrire.


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
8. Scheda "Rose" in qualsiasi momento: tabella riassuntiva (giocatori per ruolo, spesi, residuo) e rosa completa di ogni squadra. "Termina asta" (master) mostra il riepilogo finale a tutti con il pulsante "Scarica PDF" (file PDF generato direttamente nel browser). Il master trova sempre codice stanza e credenziali in "Impostazioni stanza · credenziali" nella sua console.

Regole rose: 3 portieri, 8 difensori, 8 centrocampisti, 6 attaccanti (25 giocatori). Chi ha completato un ruolo non partecipa alle aste di quel ruolo; chi ha completato la rosa ha finito. Offerta massima = budget meno 1 M per ogni slot ancora da riempire.

Rilancio automatico: ogni partecipante può impostare un massimo per il calciatore in asta; il server rilancia di 1 M al posto suo finché non lo raggiunge (chi ha il massimo più alto vince pagando 1 M più del secondo).

Skip: finché non ci sono offerte, ogni partecipante idoneo può premere "Passa"; se passano tutti, il calciatore viene scartato. Gli scartati tornano in gioco solo se il ruolo si esaurisce e qualcuno ha ancora slot liberi.

Timer per ruolo: il master imposta un timer diverso per portieri, difensori, centrocampisti, attaccanti (default 8/10/12/15 s).

Listone: scheda con tutti i calciatori, filtri per ruolo e stato (disponibili, assegnati, scartati), ricerca, prezzo di listino.

Suoni e vibrazione: segnale al nuovo calciatore, tick negli ultimi 3 secondi, vibrazione quando vieni superato (Android; iPhone non supporta la vibrazione web). Interruttore suoni nella barra delle schede.

Ordine d'asta: prima tutti i portieri, poi difensori, centrocampisti, attaccanti; estrazione casuale dentro ogni fase.

Controlli master: Avvia asta · Pausa/Riprendi · Estrai prossimo (salta il calciatore corrente, che torna nel mazzo) · Annulla e ripeti (azzera le offerte in corso, oppure revoca l'ultima aggiudicazione con rimborso e rimette il calciatore in asta) · Termina asta.

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

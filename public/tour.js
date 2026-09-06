// Demo guidata: percorso passo-passo su schermate reali con spotlight e spiegazione.
// Usa stati dimostrativi (nessun server, nessuna stanza reale). Lo stato "In solitaria" dell'utente viene salvato e ripristinato all'uscita.
(() => {
  const $ = (id) => document.getElementById(id);
  const TKEY = "fantasta_tour", SKEY = "fantasta_solo", BKEY = "fantasta_solo_backup";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let idx = 0, active = false, realApi = null;

  // ---------- stato demo multiplayer (costruito dal listone reale) ----------
  function demoState(master) {
    const L = (typeof LISTONE !== "undefined" && LISTONE) || [];
    const find = (n, t) => L.find((p) => p.name === n && p.team === t) || L[0];
    const cur = find("DIMARCO", "INT"), pick = (n, t, price) => ({ ...find(n, t), price });
    return {
      code: "DEMO", league: "Lega dei Campioni", status: "live", timerSeconds: 10, timers: { POR: 8, DIF: 10, CEN: 12, ATT: 15 },
      limits: { POR: 3, DIF: 8, CEN: 8, ATT: 6 }, budget: 500, callMode: master ? "master" : "random", waitingCall: false, skippedList: [],
      participants: [
        { name: "Tu", username: "tu", budget: 462, online: true, roster: [pick("MAIGNAN", "MIL", 38)], maxBid: 439, eligible: true },
        { name: "Marco", username: "marco", budget: 471, online: true, roster: [pick("SVILAR", "ROM", 29)], maxBid: 448, eligible: true },
        { name: "Andrea", username: "andrea", budget: 500, online: true, roster: [], maxBid: 476, eligible: true },
        { name: "Francesco", username: "francesco", budget: 484, online: false, roster: [pick("MERET", "NAP", 16)], maxBid: 461, eligible: true },
      ],
      current: { player: cur, bid: 36, bidder: "marco", timeLeft: 7, sold: false, skipped: false, skips: [], eligibleCount: 4, offlineCount: 1, autoActive: [] },
      remaining: 605, phase: "DIF", phaseRemaining: 203, lastAward: { name: "MAIGNAN", winner: "Tu", price: 38 },
      log: ["MAIGNAN → Tu per 38 FM", "SVILAR → Marco per 29 FM", "MERET → Francesco per 16 FM"],
    };
  }
  function demoSolo() {
    return { budget: 500, participants: 8, limits: { POR: 3, DIF: 8, CEN: 8, ATT: 6 }, roster: [], sold: [], excluded: [], history: [] };
  }
  const setPrice = (v) => { const e = $("so-price"); if (!e) return; e.value = v; e.dispatchEvent(new Event("input")); };
  const soloMode = async () => { if ($("s-solo").classList.contains("hidden")) { $("mode-solo").click(); await sleep(250); } };
  const soloTab = async (t) => { await soloMode(); SOLO.setMode("assist"); const b = document.querySelector(`#so-tabs [data-t=${t}]`); if (b) { b.click(); await sleep(150); } };
  const soloKean = async () => { await soloTab("asta"); if (!document.querySelector("#so-card .player")) { $("so-q").value = "kean"; $("so-q").dispatchEvent(new Event("input")); await sleep(120); const r = document.querySelector("#so-results .lrow[data-id='KEAN|FIO|ATT']"); if (r) r.click(); await sleep(150); } };
  const friends = async () => { window.showHome(); $("mode-friends").click(); await sleep(150); };
  const live = async (master) => {
    session = { code: "DEMO", token: "demo", master, name: master ? "Master" : "Tu", username: "tu" };
    state = demoState(master); show("s-live");
    $("l-code").textContent = "DEMO"; $("l-me").textContent = master ? "master" : "Tu";
    $("master-panel").classList.toggle("hidden", !master); $("bidding").classList.toggle("hidden", master); $("my-budget").classList.toggle("hidden", master); $("autopilot").classList.toggle("hidden", master);
    document.querySelectorAll("#l-tabs button").forEach((x) => x.classList.toggle("on", x.dataset.view === "asta")); view = "asta";
    render(); await sleep(100);
  };

  // ---------- passi ----------
  const STEPS = [
    { t: "Benvenuto nella demo", d: "In tre minuti vedrai tutto: l'Asta guidata (Fantalgoritmo costruisce il piano e lo ricalcola a ogni evento), l'Assistente e l'asta con gli amici. Puoi uscire quando vuoi.", target: "#modes", prep: async () => window.showHome() },
    { t: "Due modi di vivere l'asta", d: "In solitaria: Fantalgoritmo ti affianca durante un'asta che si svolge altrove (dal vivo o su un'altra piattaforma). Asta con gli amici: l'asta intera si fa qui dentro, in tempo reale da più telefoni.", target: "#modes" },
    // --- solitaria
    { t: "Budget, partecipanti, rosa", d: "Imposti i fantamilioni, quante squadre partecipano all'asta e quanti giocatori servono per ruolo. I partecipanti contano davvero: 8 squadre × 6 attaccanti = 48 attaccanti che usciranno dal mercato, e la strategia ne tiene conto.", target: "#so-setup .card", prep: async () => { await soloMode(); $("so-setup").classList.remove("hidden"); $("so-main").classList.add("hidden"); window.scrollTo(0, 0); } },
    { t: "Riquadri sempre visibili", d: "Residuo e slot per ruolo (presi/totali) restano in alto in ogni schermata.", target: "#so-main .stats", prep: async () => { await soloMode(); $("so-setup").classList.add("hidden"); $("so-main").classList.remove("hidden"); await soloTab("asta"); window.scrollTo(0, 0); } },
    // --- asta guidata (momento centrale)
    { t: "Due modi di farsi aiutare", d: "Assistente asta: scegli tu il giocatore e Fantalgoritmo ti dice quanto spendere. Asta guidata: è Fantalgoritmo a dirti chi comprare adesso, con il budget e la rosa che hai in questo momento.", target: "#so-mode", prep: async () => { await soloMode(); $("so-setup").classList.add("hidden"); $("so-main").classList.remove("hidden"); GUIDED.reset(); SOLO.setMode("guided"); GUIDED.openPlan(false); SOLO.render(); window.scrollTo(0, 0); } },
    { t: "Fantalgoritmo genera la rosa obiettivo", d: "Con 500 FM, 8 squadre e 3-8-8-6 ottimizza la migliore rosa realmente acquistabile: budget per reparto, slot con fascia (TOP, SEMITOP, TITOLARE, LOW COST), prezzo target, limite e alternative. I prezzi attesi includono un premio di scarsità: più partecipanti, più costano i giocatori in cima alla domanda.", target: "#g-plan", prep: async () => { GUIDED.openPlan(true); SOLO.render(); await sleep(50); $("g-plan-toggle").scrollIntoView({ block: "start" }); }, skipScroll: true },
    { t: "Prossimo obiettivo e mercato", d: "In alto lo stato del mercato: squadre, venduti per ruolo, disponibili, inflazione. Poi la risposta a “e adesso chi compro?” con l'urgenza: priorità alta se i giocatori di quel livello scarseggiano rispetto ai rivali che li vogliono, altrimenti puoi aspettare.", target: "#so-guided .card.player", prep: async () => { GUIDED.openPlan(false); SOLO.render(); window.scrollTo(0, 0); }, target2: ".gmarket" },
    { t: "Un avversario compra Lautaro", d: "Viene chiamato un giocatore che non è il tuo obiettivo. Nel campo “Registra acquisto avversario” cerchi il nome, scrivi il prezzo e confermi: tre tap. Il giocatore esce dal mercato.", target: ".gquick", prep: async () => { window.scrollTo(0, 0); GUIDED.setQuick("MARTINEZ|INT|ATT"); SOLO.render(); await sleep(60); if ($("gq-price")) $("gq-price").value = "128"; } },
    { t: "Il piano si ricalcola", d: "Lautaro non compare più tra obiettivi, alternative e piano B. Il prezzo pagato entra nell'inflazione dell'asta e Fantalgoritmo ricostruisce la miglior rosa ancora possibile: budget per reparto, target e strategia possono cambiare.", target: ".gbanner", prep: async () => { if ($("gq-other")) { $("gq-other").click(); await sleep(160); } window.scrollTo(0, 0); }, target2: "#so-guided .card.player" },
    { t: "Scarsità attacco ↑", d: "Anche Thuram va a un avversario a 103 FM. Fantalgoritmo misura che la qualità rimasta per coprire la domanda di attaccanti sta calando: segnala SCARSITÀ ATTACCO ↑, alza la priorità e, se conviene, cambia strategia (meno top, più semitop, budget spostato altrove).", target: ".gbanner", prep: async () => { $("gb-close")?.click(); await sleep(60); GUIDED.setQuick("THURAM|INT|ATT"); SOLO.render(); await sleep(60); if ($("gq-price")) { $("gq-price").value = "103"; $("gq-other").click(); await sleep(160); } window.scrollTo(0, 0); } },
    { t: "L'ho comprato", d: "Prendi il nuovo obiettivo a 82 FM. Confermi il prezzo, entra nella rosa, il budget scende e il piano spiega dove recupera la differenza rispetto al target.", target: ".gbanner", prep: async () => { window.scrollTo(0, 0); $("gb-close")?.click(); await sleep(60); $("g-buy")?.click(); await sleep(80); if ($("g-price")) { $("g-price").value = "82"; $("g-confirm").click(); await sleep(160); } window.scrollTo(0, 0); }, target2: ".gstatus" },
    { t: "Nuovo obiettivo, si continua", d: "Fantalgoritmo passa subito al prossimo. Non genera una squadra una volta sola: segue tutta l'asta e ricalcola cosa è ancora possibile comprare, con questo budget, contro queste squadre. Se sbagli un tap, ↩ Annulla ripristina tutto.", target: "#so-guided .card.player", prep: async () => { $("gb-close")?.click(); await sleep(60); window.scrollTo(0, 0); }, target2: "#g-undo" },
    // --- assistente
    { t: "Assistente asta: quando decidi tu", d: "Stessa rosa e stesso budget dell'Asta guidata. Qui scegli il giocatore e chiedi: quanto posso spendere?", target: "#so-mode", prep: async () => { SOLO.setMode("assist"); await soloTab("asta"); window.scrollTo(0, 0); } },
    { t: "Cerca il giocatore chiamato", d: "Scrivi il nome (o la squadra) del giocatore appena chiamato all'asta; puoi filtrare per ruolo. Basta un tap sul risultato.", target: "#so-q", prep: async () => { await soloTab("asta"); document.querySelector("#so-back")?.click(); await sleep(100); $("so-q").value = "kean"; $("so-q").dispatchEvent(new Event("input")); await sleep(150); } , target2: "#so-results" },
    { t: "Valore e limite consigliato", d: "Il valore Fantalgoritmo è riparametrato sul tuo budget. Il tuo limite consigliato non è un numero generico: tiene conto di residuo, slot mancanti, giocatori già presi e inflazione dell'asta. La riga sotto spiega perché.", target: "#so-card .fagrid", prep: soloKean },
    { t: "Scrivi il prezzo raggiunto", d: "Digita il prezzo attuale dell'asta (o usa +1 / +5 / +10). Sotto compare subito il verdetto: COMPRA / RILANCIA, VICINO AL LIMITE o LASCIA, più il giudizio AFFARE · CORRETTO · CARO · SOVRAPREZZATO.", target: "#so-verd", prep: async () => { await soloKean(); setPrice("87"); await sleep(100); }, target2: ".pricebox" },
    { t: "Quando conviene lasciare", d: "Se il prezzo supera il tuo limite (qui 140 FM), Fantalgoritmo dice LASCIA e propone subito il Piano B: alternative dello stesso ruolo ancora disponibili, con il target di spesa per ciascuna. Un tap e passi alla scheda dell'alternativa.", target: ".planb", prep: async () => { await soloKean(); setPrice("140"); await sleep(120); document.querySelector(".planb")?.scrollIntoView({ block: "center" }); } , target2: "#so-verd" },
    { t: "Registra com'è finita", d: "L'ho comprato: inserisci il prezzo e rosa, budget e slot si aggiornano. Venduto ad altro: registri il prezzo senza indicare chi; serve a misurare l'inflazione dell'asta e adattare i consigli.", target: "#so-buy", prep: async () => { await soloKean(); setPrice("87"); await sleep(80); $("so-buy").scrollIntoView({ block: "center" }); }, target2: "#so-other" },
    { t: "La mia rosa", d: "Tutti gli acquisti per ruolo, spesa, residuo e la distribuzione consigliata del budget che resta: quanto puoi ancora spendere per ogni ruolo mancante.", target: "#so-rosa", prep: async () => { await soloTab("rosa"); window.scrollTo(0, 0); } },
    { t: "Chi posso comprare?", d: "Scegli ruolo e budget massimo: ottieni i migliori giocatori ancora disponibili, ordinati per indice Fantalgoritmo, con il limite consigliato per ciascuno.", target: "#so-cerca .card", prep: async () => { await soloTab("cerca"); window.scrollTo(0, 0); } },
    { t: "Confronto e andamento", d: "Confronto: due giocatori a specchio con il verdetto su chi conviene. Andamento: l'inflazione dell'asta osservata e quella applicata prudentemente ai valori, anche per ruolo.", target: "#so-tabs", prep: async () => { await soloTab("andamento"); window.scrollTo(0, 0); } },
    // --- amici
    { t: "Asta con gli amici", d: "Il master crea la stanza: nome della lega, partecipanti (senza limite), fantamilioni, timer diverso per ruolo, composizione della rosa e modalità di chiamata: random oppure chiamata del master.", target: "#c-limits", target2: "#c-mode", prep: async () => { await friends(); document.querySelector('#s-home .tabs [data-tab=create]').click(); await sleep(150); $("c-mode").scrollIntoView({ block: "center" }); } },
    { t: "Credenziali e lobby", d: "Per ogni partecipante vengono generati username e password da inviare su WhatsApp con il codice stanza. Nella lobby si vede chi è entrato; solo il master può avviare.", target: "#lobby", prep: async () => { await live(false); state.status = "lobby"; state.current = null; render(); } },
    { t: "Il calciatore in asta", d: "Tutti vedono lo stesso calciatore con colori della squadra, offerta corrente, miglior offerente e timer. Ogni rilancio fa ripartire il timer: a zero, il calciatore è assegnato in automatico.", target: "#cur", prep: async () => { await live(false); window.scrollTo(0, 0); } },
    { t: "Rilancia", d: "+1 è il pulsante principale. Sotto puoi scrivere un importo libero, oppure attivare il rilancio automatico fino a una cifra: il server rilancia per te di 1 finché non la raggiungi (il tuo massimo resta segreto).", target: "#plus", prep: async () => { await live(false); $("plus").scrollIntoView({ block: "center" }); }, target2: "#auto-set" },
    { t: "Passa", d: "Se un calciatore non ti interessa premi Passa: quando passano tutti i presenti, viene scartato e si va avanti. Chi non è collegato conta come se avesse passato.", target: "#skip", prep: async () => { await live(false); state.current.bid = 0; state.current.bidder = null; state.current.timeLeft = null; render(); $("skip").scrollIntoView({ block: "center" }); } },
    { t: "Budget, fase, slot", d: "Residuo, fase in corso e quanti giocatori ti mancano in quel ruolo. Il server ti impedisce di offrire più di quanto serve per completare la rosa (1 FM per ogni slot mancante) e di comprare oltre il limite del ruolo.", target: "#my-budget", prep: async () => { await live(false); $("my-budget").scrollIntoView({ block: "center" }); }, target2: "#maxbid" },
    { t: "Consigli Fantalgoritmo nell'asta", d: "Sul calciatore in asta: valore, tuo limite consigliato (che considera anche budget e slot degli avversari), verdetto sull'offerta corrente e la scheda dati completa.", target: "#advice", prep: async () => { await live(false); $("advice").scrollIntoView({ block: "center" }); if (!$("advice-box").classList.contains("hidden") === false) $("advice").click(); await sleep(100); }, target2: "#advice-box" },
    { t: "Pilota automatico", d: "Con il pilota attivo, Fantalgoritmo imposta da solo il rilancio automatico al tuo limite consigliato su ogni calciatore che ti serve, e passa sugli altri. Puoi intervenire a mano in ogni momento.", target: "#autopilot", prep: async () => { await live(false); $("autopilot").scrollIntoView({ block: "center" }); } },
    { t: "Rose e listone", d: "Rose: tabella di tutte le squadre (slot per ruolo, spesi, residuo) e ogni rosa nel dettaglio; a fine asta il PDF. Listone: tutti i calciatori con filtri per ruolo e stato (disponibili, assegnati, scartati) e ricerca.", target: "#l-tabs", prep: async () => { await live(false); document.querySelector("#l-tabs [data-view=rose]").click(); await sleep(100); window.scrollTo(0, 0); } },
    { t: "La console del master", d: "Avvia, pausa/riprendi, estrai prossimo (o random), annulla e ripeti (azzera le offerte o revoca l'ultima aggiudicazione), termina asta. Con la chiamata del master cerca e mette all'asta il calciatore che vuole. Credenziali sempre a portata di mano.", target: "#master-panel", prep: async () => { await live(true); document.querySelector("#l-tabs [data-view=asta]").click(); await sleep(80); $("master-panel").scrollIntoView({ block: "center" }); } },
    { t: "Pronto?", d: "Hai visto tutto. Scegli come vivere la tua asta: da solo con il copilota, o con gli amici dentro l'app.", target: "#modes", prep: async () => { window.showHome(); window.scrollTo(0, 0); }, last: true },
  ];

  // ---------- overlay ----------
  const ov = document.createElement("div"); ov.id = "tour"; ov.className = "hidden";
  ov.innerHTML = `<svg id="tour-mask" width="100%" height="100%"><defs><mask id="tm"><rect width="100%" height="100%" fill="#fff"/><rect id="tour-hole" rx="16" fill="#000"/><rect id="tour-hole2" rx="16" fill="#000" width="0" height="0"/></mask></defs><rect width="100%" height="100%" fill="rgba(0,0,0,.72)" mask="url(#tm)"/></svg>
    <div id="tour-card"><div class="tour-step" id="tour-n"></div><h3 id="tour-t"></h3><p id="tour-d"></p>
    <div class="tour-nav"><button class="secondary" id="tour-prev">Indietro</button><button id="tour-next">Avanti</button></div><a href="#" id="tour-exit">Esci dalla demo</a></div>`;
  document.body.appendChild(ov);
  const st = document.createElement("style"); st.textContent = `
    #tour{position:fixed;inset:0;z-index:100}
    #tour svg{position:absolute;inset:0;width:100%;height:100%}
    #tour-card{position:absolute;left:12px;right:12px;bottom:12px;background:#0b1f15;border:1px solid rgba(52,209,127,.45);border-radius:18px;padding:16px 16px 12px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
    #tour-card.top{bottom:auto;top:12px}
    #tour-card .tour-step{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--green);font-weight:700}
    #tour-card h3{font-family:var(--display);font-weight:400;font-size:24px;letter-spacing:.02em;text-transform:uppercase;margin:4px 0 6px}
    #tour-card p{margin:0;font-size:14px;line-height:1.45;color:#dbe7df}
    .tour-nav{display:flex;gap:8px;margin-top:10px}
    .tour-nav button{margin:0;padding:12px}
    #tour-exit{display:block;text-align:center;margin-top:8px;font-size:12px;color:var(--muted)}
    .tour-cta{display:flex;gap:8px;margin-top:10px}
    .tour-cta button{margin:0}`;
  document.head.appendChild(st);

  function rectOf(sel) { const el = sel && document.querySelector(sel); if (!el || el.offsetParent === null && el.tagName !== "BODY") return null; const r = el.getBoundingClientRect(); if (r.width === 0) return null; return r; }
  function place() {
    const s = STEPS[idx]; const r = rectOf(s.target), r2 = rectOf(s.target2);
    const hole = $("tour-hole"), hole2 = $("tour-hole2");
    const set = (h, rr) => { if (!rr) { h.setAttribute("width", 0); h.setAttribute("height", 0); return; } h.setAttribute("x", rr.left - 8); h.setAttribute("y", rr.top - 8); h.setAttribute("width", rr.width + 16); h.setAttribute("height", rr.height + 16); };
    set(hole, r); set(hole2, r2);
    const card = $("tour-card"); card.classList.toggle("top", !!r && r.top + r.height / 2 > innerHeight * 0.55);
    $("tour-n").textContent = `Demo · ${idx + 1} di ${STEPS.length}`; $("tour-t").textContent = s.t; $("tour-d").textContent = s.d;
    $("tour-prev").disabled = idx === 0; $("tour-next").textContent = s.last ? "Fine" : "Avanti";
    const old = card.querySelector(".tour-cta"); if (old) old.remove();
    if (s.last) { const cta = document.createElement("div"); cta.className = "tour-cta"; cta.innerHTML = `<button class="green" id="tour-go-solo">In solitaria</button><button class="secondary" id="tour-go-friends">Con gli amici</button>`; card.querySelector(".tour-nav").before(cta); $("tour-go-solo").onclick = () => { stop(); setTimeout(() => $("mode-solo").click(), 50); }; $("tour-go-friends").onclick = () => { stop(); setTimeout(() => $("mode-friends").click(), 50); }; }
  }
  async function go(i) {
    idx = Math.max(0, Math.min(STEPS.length - 1, i)); sessionStorage.setItem(TKEY, String(idx));
    const s = STEPS[idx]; ov.classList.add("hidden");
    try { if (s.prep) await s.prep(); } catch (e) { console.warn("tour prep", e); }
    await sleep(60);
    const r = rectOf(s.target); if (!s.skipScroll && r && (r.top < 60 || r.bottom > innerHeight - 260)) { document.querySelector(s.target).scrollIntoView({ block: "center" }); await sleep(120); }
    ov.classList.remove("hidden"); place();
  }
  function start() {
    if (localStorage.getItem(SKEY) && !localStorage.getItem(BKEY)) localStorage.setItem(BKEY, localStorage.getItem(SKEY));
    localStorage.setItem(SKEY, JSON.stringify(demoSolo())); sessionStorage.setItem(TKEY, "0"); sessionStorage.removeItem("fantasta");
    location.reload();
  }
  function stop() {
    active = false; ov.classList.add("hidden"); sessionStorage.removeItem(TKEY);
    const b = localStorage.getItem(BKEY); if (b) { localStorage.setItem(SKEY, b); localStorage.removeItem(BKEY); } else localStorage.removeItem(SKEY);
    if (realApi) api = realApi;
    state = null; session = null; sessionStorage.removeItem("fantasta"); window.showHome(); location.reload();
  }
  async function resume() {
    const v = sessionStorage.getItem(TKEY); if (v === null) return;
    active = true; realApi = api; api = async () => ({ ok: true, amount: 0 }); // nessuna chiamata reale in demo
    await FA.load(); for (let k = 0; k < 40 && !(typeof LISTONE !== "undefined" && LISTONE); k++) await sleep(50);
    go(parseInt(v, 10) || 0);
  }
  $("tour-next").onclick = () => (STEPS[idx].last ? stop() : go(idx + 1));
  $("tour-prev").onclick = () => go(idx - 1);
  $("tour-exit").onclick = (e) => { e.preventDefault(); stop(); };
  addEventListener("resize", () => active && place()); addEventListener("scroll", () => active && place(), true);
  window.startTour = start;
  addEventListener("load", () => setTimeout(resume, 200));
})();

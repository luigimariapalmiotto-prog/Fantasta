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
    return { budget: 500, participants: 8, limits: { POR: 3, DIF: 8, CEN: 8, ATT: 6 }, config: { mode: "classic", auction: "chiamata", modDif: true, names: ["Tu", "Marco", "Andrea", "Francesco", "Giulia", "Paolo", "Sara", "Dario"] }, roster: [], sold: [], excluded: [], history: [] };
  }
  const setPrice = (v) => { const e = $("so-price"); if (!e) return; e.value = v; e.dispatchEvent(new Event("input")); };
  const soloMode = async () => { if ($("s-solo").classList.contains("hidden")) { $("mode-solo").click(); await sleep(250); } };
  const soloTab = async (t) => { await soloMode(); SOLO.setMode("assist"); const b = document.querySelector(`#so-tabs [data-t=${t}]`); if (b) { b.click(); await sleep(150); } };
  const soloKean = async () => { await soloTab("asta"); if (!document.querySelector("#so-card .player")) { $("so-q").value = "dimar"; $("so-q").dispatchEvent(new Event("input")); await sleep(120); const r = document.querySelector("#so-results .lrow[data-id='DIMARCO|INT|DIF']"); if (r) r.click(); await sleep(150); } };
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
    { t: "Configurazione della lega", d: "Fantamilioni, partecipanti (e i loro nomi, se li hai), modalità, tipologia d'asta, modificatore difesa e composizione della rosa. I partecipanti cambiano scarsità e prezzi attesi; il modificatore difesa alza il peso dei difensori.", target: "#so-setup .card", prep: async () => { await soloMode(); $("so-setup").classList.remove("hidden"); $("so-main").classList.add("hidden"); window.scrollTo(0, 0); } },
    { t: "Riquadri sempre visibili", d: "Residuo e slot per ruolo (presi/totali) restano in alto in ogni schermata.", target: "#so-main .stats", prep: async () => { await soloMode(); $("so-setup").classList.add("hidden"); SOLO.setMode("guided"); window.scrollTo(0, 0); } },
    // --- asta guidata (momento centrale)
    { t: "Due strade, un solo stato", d: "Asta guidata: scegli una strategia, Fantalgoritmo costruisce la rosa ideale e la aggiorna a ogni chiamata dicendoti se e quanto offrire. Assistente asta: scegli tu il giocatore e chiedi quanto spendere. Stesso budget e stessa rosa.", target: "#so-choose .modes", prep: async () => { await soloMode(); SOLO.setMode("choose"); GUIDED.reset(); window.scrollTo(0, 0); } },
    { t: "Scegli la tua strategia d'asta", d: "Quattro card confrontabili: descrizione, distribuzione del budget con crediti e giocatori di fascia alta per reparto, rischio, punti di forza, criticità, tipo di rosa. La Consigliata dal Fantalgoritmo è preselezionata.", target: ".gcard.on", prep: async () => { SOLO.setMode("guided"); const S = SOLO.get(); delete S.strategy; delete S.draft; SOLO.save(); GUIDED.reset(); SOLO.render(); await sleep(250); window.scrollTo(0, 0); }, skipScroll: true },
    { t: "Confronta: aggressiva e convenzionale", d: "Aggressiva: circa metà del budget all'attacco, 1–2 top, value altrove, rischio alto. Convenzionale: crescita progressiva portieri < difesa < centrocampo < attacco, rischio basso. Le percentuali sono adattate alla tua lega.", target: "[data-strat=agg]", prep: async () => { document.querySelector("[data-strat=agg]").scrollIntoView({ block: "start" }); }, target2: "[data-strat=conv]", skipScroll: true },
    { t: "Personalizzata: i tuoi giocatori", d: "Scegli fino a 5 giocatori prioritari con livello (indispensabile, alta priorità, opportunità) e prezzo massimo personale. Se due priorità non stanno nel budget del reparto, Fantalgoritmo lo dice e propone la correzione.", target: ".gcust", prep: async () => { document.querySelector("[data-pick=cust]")?.click(); await sleep(300); const S = SOLO.get(); if (!S.draft.priorities.length) { S.draft.priorities.push({ id: "MARTINEZ|INT|ATT", level: "must", max: 140 }); S.draft.priorities.push({ id: "DIMARCO|INT|DIF", level: "high", max: null }); } SOLO.render(); await sleep(300); document.querySelector(".gcust").scrollIntoView({ block: "start" }); }, skipScroll: true },
    { t: "Slider del budget e fattibilità", d: "Quattro slider (somma sempre 100%) con crediti, giocatori, spesa media a slot e fascia media. Il controllo di fattibilità dice se la strategia è sostenibile, rischiosa, difficile o incompatibile, e cosa cambiare.", target: ".gsum", prep: async () => { const S = SOLO.get(); S.draft.share = { POR: 6, DIF: 16, CEN: 26, ATT: 52 }; SOLO.render(); await sleep(400); document.querySelector(".gsum").scrollIntoView({ block: "start" }); }, skipScroll: true },
    { t: "La tua rosa ideale", d: "Dopo “Genera la mia rosa ideale”: per ogni reparto budget iniziale e attuale, giocatori con obiettivo e massimo, priorità, fascia, motivazione, alternative dello stesso livello e più economiche. È un piano dinamico, non una previsione rigida.", target: "#g-plan", prep: async () => { const S = SOLO.get(); S.draft.key = "fa"; SOLO.render(); await sleep(200); $("g-generate")?.click(); await sleep(400); $("g-plan").scrollIntoView({ block: "start" }); }, skipScroll: true },
    { t: "Blocco portieri", d: "I portieri si ragionano per blocco: titolare affidabile più riserve della stessa squadra (le “R” del database valgono 1 FM). Costo del blocco, affidabilità e alternativa, non tre titolari mediocri per dividere il budget.", target: "#g-plan .grole", prep: async () => { document.querySelector("#g-plan .grole").scrollIntoView({ block: "start" }); }, skipScroll: true },
    { t: "Giocatore chiamato: Kean a 60", d: "Scrivi il giocatore all'asta e il prezzo. Valutazione in tempo reale: coerenza, ruolo nella rosa ideale, valore, tre soglie (ideale, accettabile, limite massimo), spendibile ora, verdetto con motivazione, impatto sul budget e sugli altri obiettivi, affidabilità e Perché?.", target: "#g-eval", prep: async () => { GUIDED.setCalled("KEAN|FIO|ATT", "60"); GUIDED.setUI({ why: true }); SOLO.render(); await sleep(300); $("g-eval")?.scrollIntoView({ block: "start" }); }, skipScroll: true },
    { t: "L'ho comprato", d: "Un tap e il prezzo: Kean entra nella rosa, budget e slot si aggiornano, la rosa ideale si ricalcola e il messaggio spiega le conseguenze (quanto sopra o sotto il target, come cambia il budget dei reparti).", target: ".gbanner", prep: async () => { $("gc-mine")?.click(); await sleep(400); window.scrollTo(0, 0); }, target2: ".gtop" },
    { t: "Preso da un avversario", d: "Thuram va a Marco a 103 FM. Il giocatore esce dal mercato, il prezzo aggiorna le stime, la rosa ideale trova l'alternativa e le priorità cambiano. Con i nomi dei partecipanti, Fantalgoritmo segue anche budget e slot residui degli avversari.", target: ".gbanner", prep: async () => { $("gb-close")?.click(); await sleep(60); GUIDED.setCalled("THURAM|INT|ATT", "103", "Marco"); SOLO.render(); await sleep(200); $("gc-other")?.click(); await sleep(400); window.scrollTo(0, 0); } },
    { t: "La tua strategia, sempre visibile", d: "Il pannello confronta strategia iniziale e aggiornata: budget per reparto (iniziale, aggiornato, speso) con il motivo delle deviazioni, residuo e percentuale, slot mancanti, coerenza strategica con classificazione e spiegazione, giocatori prioritari, obiettivi.", target: "#g-strat", prep: async () => { $("gb-close")?.click(); GUIDED.setUI({ strat: true }); SOLO.render(); await sleep(200); $("g-strat").scrollIntoView({ block: "start" }); }, skipScroll: true },
    { t: "Come sta andando la tua asta", d: "Confronto in una schermata: budget iniziale ed effettivo per reparto, obiettivi iniziali presi, rischio e coerenza iniziali e attuali, strategia iniziale e aggiornata, storico delle modifiche.", target: "#g-going", prep: async () => { GUIDED.setUI({ strat: false, going: true }); SOLO.render(); await sleep(200); $("g-going").scrollIntoView({ block: "start" }); }, skipScroll: true },
    { t: "Rivedi strategia", d: "Puoi cambiare strategia anche durante l'asta: prima di applicare vedi budget dei reparti, giocatori che diventano prioritari, obiettivi che escono e rischio. Gli acquisti restano; la nuova strategia parte dalla situazione reale.", target: "#g-reviewbox", prep: async () => { GUIDED.setUI({ going: false, review: true }); SOLO.render(); await sleep(400); $("g-reviewbox").scrollIntoView({ block: "start" }); }, skipScroll: true },
    // --- assistente
    { t: "Assistente asta: quando decidi tu", d: "Stessa rosa e stesso budget dell'Asta guidata (Kean è già qui). Scegli il giocatore e chiedi: quanto posso spendere?", target: "#so-tabs", prep: async () => { $("gb-close")?.click(); SOLO.setMode("assist"); await soloTab("asta"); window.scrollTo(0, 0); } },
    { t: "Cerca il giocatore chiamato", d: "Scrivi il nome (o la squadra) del giocatore appena chiamato all'asta; puoi filtrare per ruolo. Basta un tap sul risultato.", target: "#so-q", prep: async () => { await soloTab("asta"); document.querySelector("#so-back")?.click(); await sleep(100); $("so-q").value = "dimar"; $("so-q").dispatchEvent(new Event("input")); await sleep(150); } , target2: "#so-results" },
    { t: "Valore e limite consigliato", d: "Il valore Fantalgoritmo è riparametrato sul tuo budget. Il tuo limite consigliato non è un numero generico: tiene conto di residuo, slot mancanti, giocatori già presi e inflazione dell'asta. La riga sotto spiega perché.", target: "#so-card .fagrid", prep: soloKean },
    { t: "Scrivi il prezzo raggiunto", d: "Digita il prezzo attuale dell'asta (o usa +1 / +5 / +10). Sotto compare subito il verdetto: COMPRA / RILANCIA, VICINO AL LIMITE o LASCIA, più il giudizio AFFARE · CORRETTO · CARO · SOVRAPREZZATO.", target: "#so-verd", prep: async () => { await soloKean(); setPrice("50"); await sleep(100); }, target2: ".pricebox" },
    { t: "Quando conviene lasciare", d: "Se il prezzo supera il tuo limite (qui 110 FM), Fantalgoritmo dice LASCIA e propone subito il Piano B: alternative dello stesso ruolo ancora disponibili, con il target di spesa per ciascuna. Un tap e passi alla scheda dell'alternativa.", target: ".planb", prep: async () => { await soloKean(); setPrice("110"); await sleep(120); document.querySelector(".planb")?.scrollIntoView({ block: "center" }); } , target2: "#so-verd" },
    { t: "Registra com'è finita", d: "L'ho comprato: inserisci il prezzo e rosa, budget e slot si aggiornano. Venduto ad altro: registri il prezzo senza indicare chi; serve a misurare l'inflazione dell'asta e adattare i consigli.", target: "#so-buy", prep: async () => { await soloKean(); setPrice("50"); await sleep(80); $("so-buy").scrollIntoView({ block: "center" }); }, target2: "#so-other" },
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

// Guida al Campionato — dopo l'asta: chi schierare, controllo della formazione, analisi della sfida.
// Un solo motore (score atteso per giocatore + ottimizzatore di modulo), tre livelli di informazione.
// Dati di giornata (avversario reale, casa/trasferta, indisponibilità, ballottaggi): MOCK deterministici in dayData() — da collegare a una fonte live.
window.SEASON = (() => {
  const $ = (id) => document.getElementById(id);
  const ROLES = ["POR", "DIF", "CEN", "ATT"], RL = FA.ROLE_LABEL, RS = FA.ROLE_SHORT;
  const KEY = "fantasta_season";
  const MODULES = { "3-4-3": [1, 3, 4, 3], "4-3-3": [1, 4, 3, 3], "4-4-2": [1, 4, 4, 2], "3-5-2": [1, 3, 5, 2], "4-5-1": [1, 4, 5, 1], "5-3-2": [1, 5, 3, 2], "5-4-1": [1, 5, 4, 1] };
  const TEAMS_SA = ["ATA", "BOL", "CAG", "COM", "FIO", "FRO", "GEN", "INT", "JUV", "LAZ", "LEC", "MIL", "MON", "NAP", "PAR", "ROM", "SAS", "TOR", "UDI", "VEN"];
  const STRENGTH = { INT: 5, NAP: 5, MIL: 4.5, JUV: 4.5, ATA: 4.5, ROM: 4, LAZ: 4, BOL: 4, FIO: 3.5, COM: 3.5, TOR: 3, UDI: 3, GEN: 2.5, CAG: 2.5, PAR: 2.5, SAS: 2.5, LEC: 2, VEN: 2, FRO: 2, MON: 2 };
  let S = JSON.parse(localStorage.getItem(KEY) || "null"); // { league:{name,teams:[{name,owner,players:[id]}],my,demo,updatedAt}, view, opp, mode, risk, lineup, lineupOpp, imp }
  const save = () => localStorage.setItem(KEY, JSON.stringify(S));
  let ui = { step: "start", imp: null, cmp: null, sim: null, full: false, swap: null, swapOpp: null, teamView: null, matchday: 1 };
  const rnd = (seed) => { let h = 2166136261; for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 10000) / 10000; };

  // ---------- dati di giornata (MOCK deterministico) ----------
  function dayData(p, md) {
    const r1 = rnd(p.id + "|opp|" + md), r2 = rnd(p.id + "|home|" + md), r3 = rnd(p.id + "|inj|" + md);
    const others = TEAMS_SA.filter((t) => t !== p.team); const opp = others[Math.floor(r1 * others.length)]; const home = r2 < 0.5;
    const status = r3 < 0.04 ? "infortunato" : r3 < 0.06 ? "squalificato" : (p.fa?.fv ?? 0.7) < 0.6 ? "ballottaggio" : "titolare";
    const diff = STRENGTH[opp] || 3; // 2 facile … 5 durissima
    return { opp, home, status, diff, updatedAt: "2026-09-05 18:30" }; // TODO: sostituire con probabili formazioni / infortuni live
  }
  // score atteso di giornata: base Fantalgoritmo × titolarità × difficoltà partita × casa, + upside bonus secondo l'approccio al rischio
  function score(p, md, risk = "eq") {
    const f = p.fa || {}, d = dayData(p, md);
    if (d.status === "infortunato" || d.status === "squalificato") return { s: 0, d, upside: 0, base: 0 };
    const base = (f.fmed || f.media || 6) + ((f.ia || 60) - 60) / 40;
    const start = d.status === "ballottaggio" ? 0.55 : Math.min(1, 0.7 + 0.3 * (f.fv ?? 0.7));
    const match = 1 + (3 - d.diff) * 0.045 + (d.home ? 0.03 : -0.02);
    const upside = ((f.gol || 0) * 3 + (f.ass || 0)) / Math.max(1, f.pg || 30) * 3 + (f.trG > 0 ? 0.15 : 0) + (/rigor/i.test(f.note || "") ? 0.25 : 0) + (/piazz/i.test(f.note || "") ? 0.15 : 0);
    const riskW = risk === "prud" ? { st: 1.25, up: 0.4 } : risk === "agg" ? { st: 0.85, up: 1.3 } : { st: 1, up: 0.8 };
    const s = base * Math.pow(start, riskW.st) * match + upside * riskW.up;
    return { s, d, upside, base, start };
  }
  const isOut = (p, md) => ["infortunato", "squalificato"].includes(dayData(p, md).status);

  // ottimizzatore: miglior 11 tra i moduli consentiti, panchina ordinata
  function bestLineup(ids, md, risk) {
    const ps = ids.map((id) => FA.get(id)).filter(Boolean).map((p) => ({ p, ...score(p, md, risk) }));
    const byRole = {}; ROLES.forEach((r) => (byRole[r] = ps.filter((x) => x.p.role === r).sort((a, b) => b.s - a.s)));
    let best = null;
    Object.entries(MODULES).forEach(([m, n]) => { let tot = 0, ok = true, xi = []; ROLES.forEach((r, i) => { if (byRole[r].length < n[i]) ok = false; const pick = byRole[r].slice(0, n[i]); xi.push(...pick); tot += pick.reduce((a, x) => a + x.s, 0); }); if (ok && (!best || tot > best.tot)) best = { module: m, xi, tot }; });
    if (!best) return null;
    const xiIds = new Set(best.xi.map((x) => x.p.id)); const bench = ps.filter((x) => !xiIds.has(x.p.id)).sort((a, b) => b.s - a.s);
    return { module: best.module, xi: best.xi, bench, total: best.tot, all: ps };
  }
  function evalLineup(ids, rosterIds, md, risk) {
    const best = bestLineup(rosterIds, md, risk); const ps = ids.map((id) => FA.get(id)).filter(Boolean).map((p) => ({ p, ...score(p, md, risk) }));
    const total = ps.reduce((a, x) => a + x.s, 0); const adequacy = best ? Math.round(100 * Math.min(1, total / Math.max(1e-6, best.total))) : 0;
    const counts = ROLES.map((r) => ps.filter((x) => x.p.role === r).length); const module = Object.entries(MODULES).find(([m, n]) => n.every((v, i) => v === counts[i]))?.[0] || counts.slice(1).join("-");
    const risky = ps.filter((x) => x.d.status === "ballottaggio").length, out = ps.filter((x) => x.s === 0).length;
    const riskLvl = out ? "Alto" : risky >= 3 ? "Alto" : risky ? "Medio" : "Basso";
    return { ps, total, adequacy, module, best, riskLvl, risky, out };
  }
  // cambi consigliati: per ogni ruolo confronto chi è in campo con la panchina
  function suggestions(lineupIds, rosterIds, md, risk) {
    const inL = new Set(lineupIds); const roster = rosterIds.map((id) => FA.get(id)).filter(Boolean).map((p) => ({ p, ...score(p, md, risk) }));
    const out = [];
    ROLES.forEach((r) => { const inR = roster.filter((x) => x.p.role === r && inL.has(x.p.id)).sort((a, b) => a.s - b.s); const benchR = roster.filter((x) => x.p.role === r && !inL.has(x.p.id)).sort((a, b) => b.s - a.s); inR.forEach((w) => { const b = benchR.find((x) => !out.some((o) => o.in.p.id === x.p.id)); if (!b) return; const d = b.s - w.s; if (d > 0.08) out.push({ out: w, in: b, delta: d, cls: w.s === 0 ? "change" : d > 0.45 ? "change" : d > 0.15 ? "eval" : "keep", why: reason(w, b) }); }); });
    return out.sort((a, b) => b.delta - a.delta);
  }
  const reason = (w, b) => w.s === 0 ? `${w.p.name} è ${w.d.status}: non gioca.` : w.d.status === "ballottaggio" && b.d.status === "titolare" ? `${b.p.name} è titolare sicuro, ${w.p.name} è in ballottaggio.` : b.upside > w.upside + 0.2 ? `${b.p.name} ha potenziale bonus più alto${b.d.diff <= 2.5 ? " e una partita favorevole" : ""} rispetto a ${w.p.name}.` : b.d.diff < w.d.diff ? `${b.p.name} affronta ${b.d.opp} (più abbordabile di ${w.d.opp} per ${w.p.name}).` : `${b.p.name} ha un rendimento atteso leggermente superiore.`;
  function compare(a, b, md, risk) {
    const A = { p: a, ...score(a, md, risk) }, B = { p: b, ...score(b, md, risk) }; const win = A.s >= B.s ? A : B, lose = win === A ? B : A;
    const conf = Math.round(50 + 50 * Math.min(1, Math.abs(A.s - B.s) / 1.6));
    const rows = [["Titolarità", (x) => x.d.status], ["Avversario", (x) => `${x.d.opp} ${x.d.home ? "(casa)" : "(trasferta)"} · difficoltà ${x.d.diff}/5`], ["Forma", (x) => x.p.fa?.trM > 0 ? "in crescita" : x.p.fa?.trM < 0 ? "in calo" : "stabile"], ["Potenziale bonus", (x) => x.upside.toFixed(2)], ["Fantamedia", (x) => (x.p.fa?.fmed ?? "—")], ["Rigori / piazzati", (x) => [/rigor/i.test(x.p.fa?.note || "") ? "rigorista" : null, /piazz/i.test(x.p.fa?.note || "") ? "piazzati" : null].filter(Boolean).join(", ") || "—"], ["Rischio", (x) => x.d.status === "ballottaggio" ? "medio/alto" : "basso"], ["Score atteso", (x) => x.s.toFixed(2)]];
    return { A, B, win, lose, conf, rows, why: reason(lose, win) };
  }
  const deptDots = (ps, r) => { const s = ps.filter((x) => x.p.role === r).reduce((a, x) => a + x.s, 0), n = ps.filter((x) => x.p.role === r).length || 1; return Math.max(1, Math.min(5, Math.round((s / n - 5.6) / 0.45))); };

  // ---------- demo league ----------
  const NAMES = ["FC Milano", "Real Roma", "Atletico Napoli", "AC Torino", "Sporting Firenze", "Dynamo Bologna", "Racing Como", "United Bergamo", "Inter Genova", "Olympique Bari", "Vikings Udine", "Lokomotiv Cagliari"];
  const OWNERS = ["Luca", "Marco", "Giulia", "Andrea", "Sara", "Paolo", "Elena", "Davide", "Chiara", "Matteo"];
  function demoLeague() {
    const pool = FA.players().filter((p) => p.fa && p.src !== "excel"); const limits = { POR: 3, DIF: 8, CEN: 8, ATT: 6 };
    const names = NAMES.slice().sort(() => Math.random() - 0.5).slice(0, 8), owners = OWNERS.slice().sort(() => Math.random() - 0.5);
    const teams = names.map((n, i) => ({ name: n, owner: owners[i], players: [] }));
    ROLES.forEach((r) => { const list = pool.filter((p) => p.role === r).sort((a, b) => (b.fa.ia || 0) - (a.fa.ia || 0)).slice(0, limits[r] * 8 + 10); let order = [...Array(8).keys()]; for (let round = 0; round < limits[r]; round++) { order.forEach((ti) => { const idx = Math.min(list.length - 1, Math.floor(Math.random() * Math.min(4, list.length))); teams[ti].players.push(list.splice(idx, 1)[0].id); }); order.reverse(); } });
    return { name: "Lega Demo", teams, my: Math.floor(Math.random() * 8), demo: true, updatedAt: new Date().toISOString() };
  }

  // ---------- import Excel ----------
  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’`.]/g, " ").replace(/\s+/g, " ").trim();
  function lev(a, b) { const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; }
  function matchPlayer(raw) {
    const q = norm(raw); if (!q) return { status: "empty" };
    const all = FA.players(); const exact = all.filter((p) => norm(p.name) === q || norm(p.faName || "") === q || q.split(" ").includes(norm(p.name)) && q.length <= norm(p.name).length + 12);
    if (exact.length === 1) return { status: "ok", id: exact[0].id };
    if (exact.length > 1) return { status: "ambiguous", options: exact.map((p) => p.id) };
    const scored = all.map((p) => ({ p, d: Math.min(lev(q, norm(p.name)), lev(q.split(" ").pop(), norm(p.name))) })).filter((x) => x.d <= Math.max(1, Math.floor(norm(x.p.name).length * 0.3))).sort((a, b) => a.d - b.d).slice(0, 3);
    return scored.length ? { status: "suggest", options: scored.map((x) => x.p.id) } : { status: "unknown" };
  }
  function downloadTemplate() {
    if (!window.XLSX) return alert("Libreria Excel non caricata: riprova tra un istante.");
    const rows = [["Fantasquadra", "Partecipante", "Giocatore"], ["FC Milano", "Luca", "Maignan"], ["FC Milano", "Luca", "Dimarco"], ["FC Milano", "Luca", "Barella"], ["Real Roma", "Marco", "Svilar"], ["Real Roma", "Marco", "Bastoni"]];
    const ws = XLSX.utils.aoa_to_sheet(rows); ws["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 26 }];
    const info = XLSX.utils.aoa_to_sheet([["Modello lega Fantalgoritmo"], [""], ["Compila il foglio 'Rose': una riga per ogni giocatore."], ["Campi obbligatori: Fantasquadra e Giocatore. Partecipante è facoltativo."], ["Scrivi il giocatore come nel listone (cognome basta: es. Dimarco). Ruolo, squadra, quotazione e fascia li recupera il Fantalgoritmo."], ["Puoi incollare le rose copiate da altre fonti; le righe di esempio vanno cancellate."], ["Salva e carica il file nella Guida al Campionato."]]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Rose"); XLSX.utils.book_append_sheet(wb, info, "Istruzioni"); XLSX.writeFile(wb, "Fantalgoritmo_modello_lega.xlsx");
  }
  async function parseUpload(file) {
    const buf = await file.arrayBuffer(); const wb = XLSX.read(buf, { type: "array" }); const ws = wb.Sheets["Rose"] || wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
    const hdr = (rows[0] || []).map((h) => norm(h)); const iT = hdr.findIndex((h) => h.startsWith("fantasquadra") || h === "squadra"), iO = hdr.findIndex((h) => h.startsWith("partecipante")), iP = hdr.findIndex((h) => h.startsWith("giocatore") || h.startsWith("calciatore"));
    const errors = [];
    if (iT < 0 || iP < 0) return { fatal: `Colonne mancanti: servono "Fantasquadra" e "Giocatore"${iT < 0 && iP < 0 ? "" : iT < 0 ? " (manca Fantasquadra)" : " (manca Giocatore)"}. Usa il modello scaricato.` };
    const items = [];
    rows.slice(1).forEach((r, i) => { const team = String(r[iT] || "").trim(), owner = iO >= 0 ? String(r[iO] || "").trim() : "", raw = String(r[iP] || "").trim(); if (!team && !raw) return; if (!team || !raw) { errors.push({ type: "row", line: i + 2, msg: `Riga ${i + 2} incompleta (${!team ? "manca la fantasquadra" : "manca il giocatore"}).` }); return; } const m = matchPlayer(raw); items.push({ line: i + 2, team, owner, raw, ...m }); });
    // duplicati e stesso giocatore in più squadre
    const seen = {}; items.forEach((it) => { if (it.id) { (seen[it.id] = seen[it.id] || []).push(it); } });
    Object.values(seen).forEach((arr) => { if (arr.length > 1) { const teams = [...new Set(arr.map((x) => x.team))]; arr.slice(1).forEach((x) => (x.dup = true)); errors.push({ type: "dup", id: arr[0].id, msg: `${FA.get(arr[0].id).name} compare ${teams.length > 1 ? "in " + teams.length + " fantasquadre (" + teams.join(", ") + ")" : "due volte nella stessa squadra"}.`, items: arr }); } });
    return { items, errors, teamsCount: new Set(items.map((x) => x.team)).size };
  }
  function buildLeague(imp) {
    const teams = {}; imp.items.forEach((it) => { if (!it.id || it.dup || it.drop) return; (teams[it.team] = teams[it.team] || { name: it.team, owner: it.owner || "", players: [] }); if (!teams[it.team].players.includes(it.id)) teams[it.team].players.push(it.id); });
    return { name: "La mia lega", teams: Object.values(teams), my: 0, demo: false, updatedAt: new Date().toISOString() };
  }

  // ---------- UI helpers ----------
  const T = () => S.league.teams, my = () => T()[S.league.my], opp = () => (S.opp != null ? T()[S.opp] : null);
  const chip = (x, opts = {}) => { const st = x.d?.status || dayData(x.p, ui.matchday).status; const cls = st === "titolare" ? "" : st === "ballottaggio" ? "warn" : "out"; return `<button class="pch ${cls} ${opts.sel ? "sel" : ""}" data-pid="${x.p.id}" data-side="${opts.side || "me"}" title="${x.p.name} · ${st}"><span class="pr ${x.p.role}">${RS[x.p.role]}</span><b>${x.p.name}</b><small>${x.p.team}${opts.score ? ` · ${x.s.toFixed(1)}` : ""}</small>${st !== "titolare" ? `<i>${st === "ballottaggio" ? "ballottaggio" : st}</i>` : ""}</button>`; };
  function pitch(ps, side, selectable) {
    const rows = ROLES.map((r) => `<div class="prow">${ps.filter((x) => x.p.role === r).map((x) => chip(x, { side, sel: (side === "me" ? ui.swap : ui.swapOpp) === x.p.id, score: true })).join("")}</div>`).join("");
    return `<div class="pitch ${selectable ? "sel" : ""}">${rows}</div>`;
  }
  const dots = (n) => "●".repeat(n) + "○".repeat(5 - n);
  const badgeDemo = () => S && S.league && S.league.demo ? `<div class="sdemo"><span>Modalità Demo</span><a href="#" id="s-use-mine">Usa la mia lega</a></div>` : "";
  const header = (title, back) => `<div class="topbar"><span>${back ? `<a href="#" id="s-back" class="back" style="margin:0">‹ ${back}</a>` : ""}</span><span>Guida al Campionato</span></div>${badgeDemo()}<h2 style="margin:8px 0 4px">${title}</h2>`;

  // ---------- views ----------
  function viewStart() {
    return `${header("Come vuoi iniziare?", "Home")}
      <div class="modes">
        <button class="mode primary" id="s-demo"><span class="ico">▶</span><span><b>Prova la Demo</b><small>Vuoi vedere subito come funziona? Prova la Guida al Campionato con una lega di esempio, senza caricare nessun file.</small></span></button>
        <button class="mode" id="s-import"><span class="ico">⇪</span><span><b>Importa la tua lega</b><small>Scarica il modello Excel, compila le rose, carica e controlla.</small></span></button>
        <button class="mode" disabled style="opacity:.6"><span class="ico">⛓</span><span><b>Collega la tua lega <span class="gbadge" style="background:rgba(255,255,255,.15);color:var(--ink)">Prossimamente</span></b><small>Collegamento automatico alle piattaforme Fantacalcio.</small></span></button>
      </div>`;
  }
  function viewImport() {
    const imp = ui.imp;
    let body = `<div class="card"><div class="gb-h">Step 1 · Scarica il modello</div><p class="stxt">Compila il file con i dati della tua lega seguendo il formato predisposto dal Fantalgoritmo: riconosceremo automaticamente squadre, partecipanti e giocatori. Bastano tre colonne: <b>Fantasquadra · Partecipante · Giocatore</b>.</p><button class="secondary" id="s-tpl">Scarica il modello Excel della lega</button></div>
      <div class="card"><div class="gb-h">Step 2 · Compila</div><p class="stxt">Inserisci le rose della tua lega nel modello appena scaricato (puoi incollarle da altre fonti; il cognome basta).</p></div>
      <div class="card"><div class="gb-h">Step 3 · Carica</div><input type="file" id="s-file" accept=".xlsx,.xls,.csv" style="padding:10px"><div class="err" id="s-imp-err"></div></div>`;
    if (imp) {
      const ok = imp.items.filter((x) => x.id && !x.dup && !x.drop).length, unk = imp.items.filter((x) => !x.id && !x.drop);
      const errs = imp.errors.filter((e) => e.type !== "dup" || !e.items.every((x) => x.drop));
      body += `<div class="card" id="s-check"><div class="gb-h">Step 4 · Controlla la tua lega</div>
        <div class="grow"><span>Squadre riconosciute</span><b>${imp.teamsCount}</b></div><div class="grow"><span>Giocatori riconosciuti</span><b>${ok} / ${imp.items.filter((x) => !x.drop).length}</b></div><div class="grow"><span>Errori trovati</span><b class="${unk.length + errs.length ? "warn" : "ok"}">${unk.length + errs.length}</b></div>
        ${errs.filter((e) => e.type === "row").map((e) => `<div class="serr">⚠️ ${e.msg}<div class="srow"><button class="secondary" data-ignore="${e.line}">Ignora la riga</button></div></div>`).join("")}
        ${errs.filter((e) => e.type === "dup").map((e) => `<div class="serr">⚠️ ${e.msg}<div class="srow">${e.items.map((it) => `<button class="secondary" data-keep="${it.line}">Tieni in ${it.team}</button>`).join("")}</div></div>`).join("")}
        ${unk.map((it) => `<div class="serr">⚠️ “${it.raw}” (${it.team}) non riconosciuto.${it.options?.length ? `<div class="stxt">Possibile corrispondenza:</div><div class="srow">${it.options.map((id) => `<button class="secondary" data-fix="${it.line}" data-id="${id}">${FA.get(id).name} · ${FA.get(id).team} · ${RL[FA.get(id).role]}</button>`).join("")}</div>` : ""}<div class="srow"><input placeholder="Cerca un altro nome…" data-q="${it.line}" autocomplete="off"><button class="secondary" data-drop="${it.line}">Rimuovi riga</button></div><div data-qres="${it.line}"></div></div>`).join("")}
        ${!unk.length && !errs.length ? `<div class="gfeas ok"><b>✅ Lega importata correttamente</b><div>${imp.teamsCount} fantasquadre, ${ok} giocatori.</div></div><button class="green" id="s-imp-go">Continua</button>` : `<div class="gfeas warn"><b>Correggi gli errori per continuare</b><div>Puoi risolverli qui, senza ricaricare il file.</div></div>`}</div>`;
    }
    return header("Importa la tua lega", "Indietro") + body;
  }
  function viewLeague() {
    const L = S.league, m = my();
    const teams = L.teams.map((t, i) => `<div class="steam ${i === L.my ? "mine" : ""}" data-team="${i}"><b>${t.name}</b><small>${t.owner || ""} · ${t.players.length} giocatori</small>${i === L.my ? `<span class="gbadge">La tua squadra</span>` : `<button class="secondary" data-pick-team="${i}">${L.demo ? "Cambia: usa questa" : "È la mia"}</button>`}</div>`).join("");
    const roster = ui.teamView != null ? (() => { const t = L.teams[ui.teamView]; return `<div class="card"><div class="gb-h">Rosa · ${t.name}</div>${ROLES.map((r) => `<h4 style="margin:8px 0 2px;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em">${RL[r]}</h4>${t.players.map((id) => FA.get(id)).filter((p) => p && p.role === r).map((p) => `<div class="lrow"><span class="rl ${p.role}">${RS[p.role]}</span><span class="nm">${p.name}<small>${p.team}${p.fa?.fascia ? " · " + p.fa.fascia : ""}</small></span>${L.demo ? "" : `<a href="#" data-rm="${id}" data-t="${ui.teamView}" style="color:var(--red)">✕</a>`}</div>`).join("")}`).join("")}${L.demo ? "" : `<input placeholder="Aggiungi giocatore…" id="s-add-q" autocomplete="off"><div id="s-add-res"></div>`}<a href="#" id="s-close-team" class="muted" style="font-size:12px">chiudi</a></div>`; })() : "";
    return `${header(L.demo ? "La tua lega Demo è pronta" : "La tua lega", "Home")}
      <div class="card"><div class="grow"><span>Lega</span><b>${L.name}</b></div><div class="grow"><span>La tua fantasquadra</span><b>${m.name}</b></div><div class="grow"><span>Partecipanti</span><b>${L.teams.length}</b></div><div class="grow"><span>Rose</span><b>${L.demo ? "generate automaticamente" : "importate da Excel"}</b></div><div class="grow"><span>Ultimo aggiornamento</span><b>${new Date(L.updatedAt).toLocaleString("it-IT")}</b></div>
        <button class="green" id="s-prepare">Prepara la prossima giornata</button>
        <div class="row">${L.demo ? `<button class="secondary" id="s-regen">Genera un'altra lega Demo</button>` : `<button class="secondary" id="s-update">Aggiorna lega (Excel)</button>`}<button class="secondary" id="s-all">Vedi tutte le squadre</button></div></div>
      ${roster}
      <div class="card"><div class="gb-h">${L.demo ? "Questa è la tua squadra Demo" : "Qual è la tua squadra?"}</div><div class="steams">${teams}</div></div>`;
  }
  function viewMatch() {
    const L = S.league; const others = L.teams.map((t, i) => ({ t, i })).filter((x) => x.i !== L.my);
    return `${header("Contro chi giochi questa giornata?", "La tua lega")}
      <div class="card"><div class="grow"><span>La tua squadra</span><b>${my().name}</b></div><div class="grow"><span>Giornata</span><b>${ui.matchday}ª</b></div></div>
      <div class="steams">${others.map(({ t, i }) => `<div class="steam ${S.opp === i ? "mine" : ""}"><b>${t.name}</b><small>${t.owner || ""} · ${t.players.length} giocatori</small><button class="${S.opp === i ? "green" : "secondary"}" data-opp="${i}">${S.opp === i ? "Avversario scelto" : "Sfida"}</button></div>`).join("")}</div>
      ${S.opp != null ? `<h2 style="margin:14px 0 6px">Come vuoi preparare la partita?</h2><div class="muted" style="font-size:13px;margin-bottom:8px">Più informazioni inserisci, più precisa sarà l'analisi.</div>
      <div class="modes">
        <button class="mode primary" data-mode="1"><span class="ico">1</span><span><b>Consigliami la formazione</b><small>Non hai ancora scelto chi schierare? Il Fantalgoritmo analizza tutta la tua rosa e ti propone la formazione migliore per questa giornata.</small></span></button>
        <button class="mode" data-mode="2"><span class="ico">2</span><span><b>Controlla la mia formazione</b><small>Hai già deciso chi schierare? Inserisci la tua formazione e il Fantalgoritmo ti dice se cambierebbe qualcosa.</small></span></button>
        <button class="mode" data-mode="3"><span class="ico">3</span><span><b>Analizza la sfida</b><small>Conosci anche la formazione del tuo avversario? Inseriscila per ottenere l'analisi più precisa possibile.</small></span></button>
      </div>` : ""}`;
  }
  function viewAnalysis() {
    const md = ui.matchday, risk = S.risk || "eq", me = my(), ov = opp();
    if (!S.lineup || S.mode === 1) { const b = bestLineup(me.players, md, risk); S.lineup = b.xi.map((x) => x.p.id); }
    const ev = evalLineup(S.lineup, me.players, md, risk), sugg = suggestions(S.lineup, me.players, md, risk);
    const oppBest = bestLineup(ov.players, md, "eq"); const oppLineup = S.mode === 3 && S.lineupOpp ? S.lineupOpp : oppBest.xi.map((x) => x.p.id); const oppEv = evalLineup(oppLineup, ov.players, md, "eq");
    const oppConf = Math.round(100 * oppBest.xi.filter((x) => x.d.status === "titolare").length / 11);
    const vs = S.mode >= 2 ? (() => { const d = (ev.total - oppEv.total) / Math.max(1, ev.total + oppEv.total); return Math.round(Math.max(0, Math.min(100, ev.adequacy * 0.7 + 30 * (0.5 + d * 2)))); })() : ev.adequacy;
    const prim = sugg.filter((s) => s.cls === "change").slice(0, 3), evalS = sugg.filter((s) => s.cls === "eval"), keep = ev.ps.filter((x) => !sugg.some((s) => s.out.p.id === x.p.id)).slice(0, 3);
    const verdict = vs >= 85 ? "Formazione molto competitiva per questa giornata." : vs >= 70 ? "Formazione complessivamente buona." : vs >= 55 ? "Formazione migliorabile: vedi i cambi consigliati." : "Formazione debole per questa giornata.";
    const conf = S.mode === 3 ? "Alta" : ev.risky >= 2 ? "Media" : S.mode === 2 ? "Media" : "Alta";
    const doubt = evalS[0] ? `Il principale ballottaggio è ${evalS[0].out.p.name} vs ${evalS[0].in.p.name}.` : prim[0] ? `Il cambio più importante è ${prim[0].out.p.name} → ${prim[0].in.p.name}.` : "Nessun ballottaggio rilevante.";
    const same = ev.best && ev.best.xi.every((x) => S.lineup.includes(x.p.id));
    const dept = S.mode === 3 || S.mode === 2 ? ROLES.map((r) => { const a = deptDots(ev.ps, r), b = deptDots(oppEv.ps, r); return { r, a, b }; }) : null;
    const strong = dept ? dept.slice().sort((x, y) => (y.a - y.b) - (x.a - x.b))[0] : null, weak = dept ? dept.slice().sort((x, y) => (x.a - x.b) - (y.a - y.b))[0] : null;
    const cmpHtml = ui.cmp ? (() => { const c = compare(FA.get(ui.cmp[0]), FA.get(ui.cmp[1]), md, risk); return `<div class="card"><div class="gb-h">Confronto · ${c.A.p.name} o ${c.B.p.name}?</div><table class="cmp"><thead><tr><th>${c.A.p.name}</th><th></th><th>${c.B.p.name}</th></tr></thead><tbody>${c.rows.map(([l, f]) => `<tr><td>${f(c.A)}</td><th>${l}</th><td>${f(c.B)}</td></tr>`).join("")}</tbody></table><div class="verdict buy" style="margin-top:10px;font-size:20px">Consigliato: ${c.win.p.name} · confidenza ${c.conf}%</div><p class="gwhy">${c.why}</p><a href="#" id="s-cmp-close" class="muted" style="font-size:12px">chiudi</a></div>`; })() : "";
    const simHtml = ui.sim ? (() => { const [outId, inId] = ui.sim; const L2 = S.lineup.map((id) => (id === outId ? inId : id)); const e2 = evalLineup(L2, me.players, md, risk); const o = FA.get(outId), n = FA.get(inId); const so = score(o, md, risk), sn = score(n, md, risk); return `<div class="card" id="s-sim"><div class="gb-h">Simula cambio · ${o.name} → ${n.name}</div><div class="grow"><span>Adeguatezza</span><b>${ev.adequacy} → ${e2.adequacy}</b></div><div class="grow"><span>Score atteso formazione</span><b>${ev.total.toFixed(1)} → ${e2.total.toFixed(1)}</b></div><div class="grow"><span>Potenziale bonus</span><b>${sn.upside > so.upside + 0.05 ? "↑" : sn.upside < so.upside - 0.05 ? "↓" : "="}</b></div><div class="grow"><span>Rischio</span><b>${ev.riskLvl} → ${e2.riskLvl}</b></div><p class="gwhy">${e2.adequacy > ev.adequacy ? "Il cambio aumenta il potenziale della formazione" : e2.adequacy < ev.adequacy ? "Il cambio riduce il valore atteso della formazione" : "Il cambio è sostanzialmente neutro"}${e2.riskLvl !== ev.riskLvl ? (e2.riskLvl === "Alto" || (e2.riskLvl === "Medio" && ev.riskLvl === "Basso") ? ", ma introduce più rischio." : " e riduce il rischio.") : "."}</p><div class="row"><button class="green" id="s-sim-apply">Applica cambio</button><button class="secondary" id="s-sim-cancel">Annulla</button></div></div>`; })() : "";
    const swapHint = ui.swap ? `<div class="notice" style="margin:8px 0">Scegli dalla panchina chi entra al posto di <b>${FA.get(ui.swap).name}</b> (stesso ruolo).</div>` : "";
    const bench = me.players.filter((id) => !S.lineup.includes(id)).map((id) => FA.get(id)).filter(Boolean).map((p) => ({ p, ...score(p, md, risk) })).sort((a, b) => b.s - a.s);
    const benchHtml = `<div class="sbench">${bench.map((x, i) => `<button class="pch bench ${ui.swap && x.p.role === FA.get(ui.swap).role ? "cand" : ""} ${x.s === 0 ? "out" : ""}" data-bench="${x.p.id}"><span class="pr ${x.p.role}">${i + 1}</span><b>${x.p.name}</b><small>${x.p.team} · ${x.s.toFixed(1)}${x.d.status !== "titolare" ? " · " + x.d.status : ""}</small></button>`).join("")}</div>`;
    const modeLabel = { 1: "Consigliami la formazione", 2: "Controlla la mia formazione", 3: "Analizza la sfida" }[S.mode];
    const oppSection = S.mode === 2 ? `<details class="gdet"><summary><span>Probabile formazione avversaria · ${ov.name}</span><b>${oppConf}%</b></summary><div class="gdet-b"><div class="grow"><span>Modulo</span><b>${oppBest.module}</b></div><div class="grow"><span>Affidabilità previsione</span><b>${oppConf}%</b></div>${pitch(oppEv.ps, "opp", false)}${oppBest.xi.filter((x) => x.d.status === "ballottaggio").length ? `<div class="stxt">Alternative possibili: ${oppBest.bench.slice(0, 2).map((x) => x.p.name).join(", ")}</div>` : ""}</div></details>` : S.mode === 3 ? `<div class="card"><div class="gb-h">Formazione avversaria · ${ov.name} <a href="#" id="s-opp-reset" style="float:right;color:var(--muted);font-weight:600">proponi la probabile</a></div>${ui.swapOpp ? `<div class="notice" style="margin:6px 0">Scegli chi entra al posto di <b>${FA.get(ui.swapOpp).name}</b>.</div>` : ""}${pitch(oppEv.ps, "opp", true)}<div class="sbench">${ov.players.filter((id) => !oppLineup.includes(id)).map((id) => FA.get(id)).filter(Boolean).map((p) => ({ p, ...score(p, md, "eq") })).sort((a, b) => b.s - a.s).map((x) => `<button class="pch bench ${ui.swapOpp && x.p.role === FA.get(ui.swapOpp).role ? "cand" : ""}" data-benchopp="${x.p.id}"><span class="pr ${x.p.role}">${RS[x.p.role]}</span><b>${x.p.name}</b><small>${x.p.team}</small></button>`).join("")}</div></div>` : "";
    return `${header(modeLabel, "Scegli la sfida")}
      <div class="card" style="padding:12px 16px"><div class="gb-h">Come vuoi affrontare questa giornata?</div><div class="tabs small"><button class="${risk === "prud" ? "on" : ""}" data-risk="prud">Prudente</button><button class="${risk === "eq" ? "on" : ""}" data-risk="eq">Equilibrata</button><button class="${risk === "agg" ? "on" : ""}" data-risk="agg">Aggressiva</button></div><div class="muted" style="font-size:12px">${my().name} vs ${ov.name} · ${ui.matchday}ª giornata · ultimo aggiornamento ${dayData(FA.get(S.lineup[0]), md).updatedAt}</div></div>
      <div class="card"><div class="gb-h">${S.mode === 1 ? "Formazione consigliata" : "La tua formazione"} · ${ev.module}</div>
        <div class="stop"><div><span>Adeguatezza${S.mode >= 2 ? " vs avversario" : ""}</span><b class="${vs >= 70 ? "ok" : vs >= 55 ? "warn" : "bad"}">${vs}/100</b></div><div><span>Rischio</span><b>${ev.riskLvl}</b></div><div><span>Affidabilità analisi</span><b>${conf}</b></div></div>
        <p class="gwhy" style="text-align:center;margin:6px 0 10px"><b>${verdict}</b>${same && S.mode >= 2 ? " La tua formazione migliore è anche quella più adatta contro questo avversario." : ""}</p>
        ${swapHint}${pitch(ev.ps, "me", true)}
        <div class="gb-h" style="margin-top:10px">Panchina (ordine consigliato)</div>${benchHtml}
        ${S.mode === 1 ? `<p class="stxt">Tocca un titolare e poi un panchinaro per modificarla: l'analisi si aggiorna subito.</p>` : ""}</div>
      ${simHtml}${cmpHtml}
      <div class="card"><div class="gb-h">Cosa migliorerei</div>
        ${!sugg.length ? `<div class="gfeas ok"><b>✅ La formazione va già bene. Non effettuerei cambi.</b></div>` : ""}
        ${prim.length ? `<div class="sgrp bad">Da cambiare</div>${prim.map((s) => `<div class="ssug"><b>${s.out.p.name} → ${s.in.p.name}</b><div class="stxt">${s.why}</div><div class="srow"><button class="secondary" data-sim="${s.out.p.id};;${s.in.p.id}">Simula cambio</button><button class="secondary" data-cmp="${s.out.p.id};;${s.in.p.id}">Confronta</button></div></div>`).join("")}` : ""}
        ${evalS.length ? `<div class="sgrp warn">Da valutare</div>${evalS.slice(0, 3).map((s) => `<div class="ssug"><b>${s.out.p.name} vs ${s.in.p.name}</b><div class="stxt">${s.why}</div><div class="srow"><button class="secondary" data-sim="${s.out.p.id};;${s.in.p.id}">Simula cambio</button><button class="secondary" data-cmp="${s.out.p.id};;${s.in.p.id}">Confronta</button></div></div>`).join("")}` : ""}
        ${keep.length ? `<div class="sgrp ok">Lascerei così</div><div class="stxt">${keep.map((x) => x.p.name).join(", ")}${sugg.length ? " e gli altri titolari senza alternative migliori." : "."}</div>` : ""}
        <div class="grow" style="margin-top:8px"><span>Dubbio principale</span><b style="max-width:60%">${doubt}</b></div></div>
      ${oppSection}
      ${dept ? `<div class="card"><div class="gb-h">Confronto con l'avversario</div>${dept.map((x) => `<div class="sdept"><b>${RL[x.r]}</b><div><span>Tu</span><em>${dots(x.a)}</em></div><div><span>${ov.name}</span><em>${dots(x.b)}</em></div></div>`).join("")}<div class="grow"><span>Dove puoi fare la differenza</span><b class="ok">${RL[strong.r]}</b></div><div class="grow"><span>Dove sei più esposto</span><b class="bad">${RL[weak.r]}</b></div><p class="stxt">Punti di forza: il tuo ${RL[strong.r].toLowerCase()} ha un potenziale atteso superiore. Punti di rischio: l'avversario è più forte in ${RL[weak.r].toLowerCase()}. Valutazioni di adeguatezza, non probabilità di risultato.</p></div>` : ""}
      <details class="gdet"><summary><span>Vedi analisi completa</span></summary><div class="gdet-b">${ev.ps.slice().sort((a, b) => b.s - a.s).map((x) => `<div class="grow"><span>${x.p.name} <small class="muted">${x.p.team} · vs ${x.d.opp} ${x.d.home ? "casa" : "trasf."} · diff ${x.d.diff}/5 · ${x.d.status}</small></span><b>${x.s.toFixed(2)}</b></div>`).join("")}<p class="stxt" style="margin-top:8px">Score atteso = base Fantalgoritmo (fantamedia, indice) × titolarità × difficoltà partita e casa/trasferta + potenziale bonus (gol, assist, rigori, piazzati) pesato secondo l'approccio scelto. Dati di giornata dimostrativi: da collegare a probabili formazioni e infortuni live.</p></div></details>`;
  }

  // ---------- render & bind ----------
  function render() {
    const box = $("s-season"); if (!box) return;
    let html;
    if (ui.step === "import") html = viewImport();
    else if (!S || !S.league || ui.step === "start") html = viewStart();
    else if (ui.step === "league") html = viewLeague();
    else if (ui.step === "match") html = viewMatch();
    else html = viewAnalysis();
    box.innerHTML = html; bind(box);
  }
  function bind(box) {
    const on = (sel, fn) => box.querySelectorAll(sel).forEach((el) => el.onclick = (ev) => { ev.preventDefault(); fn(el, ev); });
    on("#s-back", () => { if (ui.step === "analysis") ui.step = "match"; else if (ui.step === "match") ui.step = "league"; else if (ui.step === "import") ui.step = S?.league ? "league" : "start"; else window.showHome(); render(); window.scrollTo(0, 0); });
    on("#s-demo", () => { S = { league: demoLeague(), opp: null, mode: null, risk: "eq", lineup: null }; save(); ui.step = "league"; render(); window.scrollTo(0, 0); });
    on("#s-regen", () => { S.league = demoLeague(); S.opp = null; S.lineup = null; save(); ui.teamView = null; render(); });
    on("#s-import", () => { ui.step = "import"; ui.imp = null; render(); });
    on("#s-update", () => { ui.step = "import"; ui.imp = null; render(); });
    on("#s-use-mine", () => { ui.step = "import"; ui.imp = null; render(); });
    on("#s-tpl", downloadTemplate);
    const f = $("s-file"); if (f) f.onchange = async () => { try { const r = await parseUpload(f.files[0]); if (r.fatal) { $("s-imp-err").textContent = r.fatal; return; } ui.imp = r; render(); $("s-check")?.scrollIntoView({ block: "start" }); } catch (e) { $("s-imp-err").textContent = "File non leggibile: usa il modello Excel."; } };
    on("[data-fix]", (el) => { const it = ui.imp.items.find((x) => x.line == el.dataset.fix); it.id = el.dataset.id; it.status = "ok"; recheckDups(); render(); });
    on("[data-ignore]", (el) => { ui.imp.errors = ui.imp.errors.filter((e) => !(e.type === "row" && e.line == el.dataset.ignore)); render(); });
    on("[data-drop]", (el) => { const it = ui.imp.items.find((x) => x.line == el.dataset.drop); it.drop = true; render(); });
    on("[data-keep]", (el) => { const e = ui.imp.errors.find((x) => x.type === "dup" && x.items.some((it) => it.line == el.dataset.keep)); e.items.forEach((it) => { it.drop = it.line != el.dataset.keep; it.dup = false; }); ui.imp.errors = ui.imp.errors.filter((x) => x !== e); render(); });
    box.querySelectorAll("[data-q]").forEach((inp) => inp.oninput = () => { const res = box.querySelector(`[data-qres="${inp.dataset.q}"]`); const rows = inp.value.length >= 2 ? FA.players().filter((p) => norm(p.name).includes(norm(inp.value))).slice(0, 5) : []; res.innerHTML = rows.map((p) => `<button class="secondary" data-fix="${inp.dataset.q}" data-id="${p.id}">${p.name} · ${p.team}</button>`).join(" "); res.querySelectorAll("[data-fix]").forEach((b) => b.onclick = () => { const it = ui.imp.items.find((x) => x.line == b.dataset.fix); it.id = b.dataset.id; it.status = "ok"; recheckDups(); render(); }); });
    on("#s-imp-go", () => { const L = buildLeague(ui.imp); if (S?.league && !S.league.demo) { L.name = S.league.name; const prev = S.league.teams[S.league.my]?.name; const idx = L.teams.findIndex((t) => t.name === prev); L.my = idx >= 0 ? idx : 0; } S = { league: L, opp: null, mode: null, risk: "eq", lineup: null }; save(); ui.step = "league"; ui.imp = null; render(); window.scrollTo(0, 0); });
    on("[data-pick-team]", (el) => { S.league.my = +el.dataset.pickTeam; S.opp = null; S.lineup = null; save(); render(); });
    on("#s-all", () => { ui.teamView = ui.teamView == null ? S.league.my : null; render(); });
    on(".steam b", (el) => { ui.teamView = +el.parentElement.dataset.team; render(); $("s-close-team")?.scrollIntoView({ block: "center" }); });
    on("#s-close-team", () => { ui.teamView = null; render(); });
    on("[data-rm]", (el) => { const t = S.league.teams[+el.dataset.t]; t.players = t.players.filter((id) => id !== el.dataset.rm); S.league.updatedAt = new Date().toISOString(); save(); render(); });
    const aq = $("s-add-q"); if (aq) aq.oninput = () => { const res = $("s-add-res"); const rows = aq.value.length >= 2 ? FA.players().filter((p) => norm(p.name).includes(norm(aq.value)) && !S.league.teams.some((t) => t.players.includes(p.id))).slice(0, 5) : []; res.innerHTML = rows.map((p) => `<div class="lrow" data-add="${p.id}" style="cursor:pointer"><span class="rl ${p.role}">${RS[p.role]}</span><span class="nm">${p.name}<small>${p.team}</small></span></div>`).join(""); res.querySelectorAll("[data-add]").forEach((r) => r.onclick = () => { S.league.teams[ui.teamView].players.push(r.dataset.add); S.league.updatedAt = new Date().toISOString(); save(); render(); }); };
    on("#s-prepare", () => { ui.step = "match"; render(); window.scrollTo(0, 0); });
    on("[data-opp]", (el) => { S.opp = +el.dataset.opp; S.lineup = null; S.lineupOpp = null; save(); render(); document.querySelector(".modes")?.scrollIntoView({ block: "start" }); });
    on("[data-mode]", (el) => { S.mode = +el.dataset.mode; if (S.mode === 1) S.lineup = null; else if (!S.lineup) S.lineup = bestLineup(my().players, ui.matchday, S.risk || "eq").xi.map((x) => x.p.id); save(); ui.step = "analysis"; ui.sim = ui.cmp = null; render(); window.scrollTo(0, 0); });
    on("[data-risk]", (el) => { S.risk = el.dataset.risk; if (S.mode === 1) S.lineup = null; save(); render(); });
    on(".pitch.sel .pch[data-side=me]", (el) => { ui.swap = ui.swap === el.dataset.pid ? null : el.dataset.pid; render(); });
    on(".pitch.sel .pch[data-side=opp]", (el) => { ui.swapOpp = ui.swapOpp === el.dataset.pid ? null : el.dataset.pid; render(); });
    on("[data-bench]", (el) => { if (!ui.swap) return; const o = FA.get(ui.swap), n = FA.get(el.dataset.bench); if (o.role !== n.role) return; if (S.mode === 1) S.mode = 2; S.lineup = S.lineup.map((id) => (id === o.id ? n.id : id)); ui.swap = null; save(); render(); });
    on("[data-benchopp]", (el) => { if (!ui.swapOpp) return; const o = FA.get(ui.swapOpp), n = FA.get(el.dataset.benchopp); if (o.role !== n.role) return; const cur = S.lineupOpp || bestLineup(opp().players, ui.matchday, "eq").xi.map((x) => x.p.id); S.lineupOpp = cur.map((id) => (id === o.id ? n.id : id)); ui.swapOpp = null; save(); render(); });
    on("#s-opp-reset", () => { S.lineupOpp = null; save(); render(); });
    on("[data-sim]", (el) => { ui.sim = el.dataset.sim.split(";;"); ui.cmp = null; render(); $("s-sim")?.scrollIntoView({ block: "center" }); });
    on("#s-sim-apply", () => { const [o, n] = ui.sim; if (S.mode === 1) S.mode = 2; S.lineup = S.lineup.map((id) => (id === o ? n : id)); ui.sim = null; save(); render(); });
    on("#s-sim-cancel", () => { ui.sim = null; render(); });
    on("[data-cmp]", (el) => { ui.cmp = el.dataset.cmp.split(";;"); ui.sim = null; render(); });
    on("#s-cmp-close", () => { ui.cmp = null; render(); });
  }
  function recheckDups() { const seen = {}; ui.imp.items.forEach((it) => { it.dup = false; if (it.id && !it.drop) (seen[it.id] = seen[it.id] || []).push(it); }); ui.imp.errors = ui.imp.errors.filter((e) => e.type !== "dup"); Object.values(seen).forEach((arr) => { if (arr.length > 1) { arr.slice(1).forEach((x) => (x.dup = true)); const teams = [...new Set(arr.map((x) => x.team))]; ui.imp.errors.push({ type: "dup", id: arr[0].id, msg: `${FA.get(arr[0].id).name} compare ${teams.length > 1 ? "in " + teams.length + " fantasquadre (" + teams.join(", ") + ")" : "due volte nella stessa squadra"}.`, items: arr }); } }); }

  // stile (riusa il design system: card, tabs, kicker, badge, colori ruolo)
  const st = document.createElement("style"); st.textContent = `
    #s-season .gb-h{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--green);font-weight:700;margin-bottom:6px}
    .stxt{font-size:13px;line-height:1.5;color:#dbe7df;margin:4px 0}
    .sdemo{display:flex;justify-content:space-between;align-items:center;background:rgba(224,166,58,.14);border:1px solid rgba(224,166,58,.45);border-radius:10px;padding:6px 12px;font-size:12px;margin:8px 0} .sdemo span{font-weight:800;color:#ffb54a} .sdemo a{color:var(--ink);font-weight:700}
    .steams{display:grid;gap:8px} .steam{display:grid;grid-template-columns:1fr auto;gap:2px 10px;align-items:center;background:rgba(0,0,0,.25);border:1px solid var(--line);border-radius:12px;padding:10px 12px} .steam b{cursor:pointer;font-family:var(--display);font-weight:400;font-size:20px;letter-spacing:.02em;text-transform:uppercase} .steam small{color:var(--muted);grid-column:1} .steam button,.steam .gbadge{grid-column:2;grid-row:1/3;margin:0;padding:8px 10px;font-size:13px} .steam.mine{border-color:var(--green)}
    .stop{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:6px 0} .stop div{background:rgba(0,0,0,.25);border:1px solid var(--line);border-radius:12px;padding:8px 6px;text-align:center} .stop span{display:block;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)} .stop b{display:block;font-family:var(--display);font-weight:400;font-size:24px;color:#fff;margin-top:2px}
    .pitch{background:linear-gradient(180deg,#0f4a2c,#0b3a22);border:2px solid rgba(255,255,255,.25);border-radius:12px;padding:10px 6px;display:grid;gap:8px;position:relative} .pitch::before{content:"";position:absolute;left:6px;right:6px;top:50%;border-top:2px solid rgba(255,255,255,.2)} .pitch::after{content:"";position:absolute;left:50%;top:50%;width:70px;height:70px;border:2px solid rgba(255,255,255,.2);border-radius:50%;transform:translate(-50%,-50%)}
    .prow{display:flex;justify-content:center;gap:6px;flex-wrap:wrap;position:relative;z-index:1}
    .pch{width:auto;margin:0;padding:6px 8px;border-radius:10px;background:rgba(6,23,15,.9);color:var(--ink);box-shadow:0 0 0 1px rgba(255,255,255,.25) inset;display:grid;grid-template-columns:auto 1fr;gap:0 6px;text-align:left;font-size:12px;min-width:92px;max-width:112px} .pch .pr{grid-row:1/3;width:20px;height:20px;border-radius:5px;font-size:10px;font-weight:800;color:#fff;display:grid;place-items:center;align-self:center} .pch b{font-size:12px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .pch small{color:var(--muted);font-size:10px;font-weight:600} .pch i{grid-column:1/-1;font-style:normal;font-size:10px;color:#ffb54a;font-weight:700} .pch.out{opacity:.55} .pch.out i{color:var(--red)} .pch.warn{box-shadow:0 0 0 1px #ffb54a inset} .pch.sel{box-shadow:0 0 0 2px var(--green) inset;background:rgba(52,209,127,.2)} .pch.cand{box-shadow:0 0 0 2px var(--green) inset}
    .sbench{display:flex;gap:6px;flex-wrap:wrap} .pch.bench{background:rgba(255,255,255,.05)}
    .sgrp{font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;margin:10px 0 4px} .sgrp.bad{color:var(--red)} .sgrp.warn{color:#ffb54a} .sgrp.ok{color:var(--green)}
    .ssug{padding:8px 0;border-bottom:1px solid var(--line)} .ssug b{font-size:15px} .srow{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px} .srow button{margin:0;padding:8px 10px;font-size:12px;width:auto} .srow input{padding:8px;font-size:14px;flex:1}
    .serr{background:rgba(224,166,58,.10);border:1px solid rgba(224,166,58,.4);border-radius:10px;padding:8px 12px;margin-top:8px;font-size:13px;line-height:1.5}
    .sdept{display:grid;grid-template-columns:110px 1fr 1fr;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px} .sdept b{font-family:var(--display);font-weight:400;letter-spacing:.02em;text-transform:uppercase;font-size:16px} .sdept span{display:block;font-size:10px;color:var(--muted);text-transform:uppercase} .sdept em{font-style:normal;color:var(--green);letter-spacing:2px}
    #s-season .grow{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px} #s-season .grow span{color:var(--muted)} #s-season .grow b{text-align:right;color:#fff;font-weight:700} #s-season .ok{color:var(--green)} #s-season .warn{color:#ffb54a} #s-season .bad{color:var(--red)}
    #s-season .gdet{background:var(--card);border:1px solid var(--line);border-radius:16px;margin-bottom:12px} #s-season .gdet summary{list-style:none;cursor:pointer;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--green);font-weight:700} #s-season .gdet summary::-webkit-details-marker{display:none} #s-season .gdet-b{padding:0 16px 14px}
    #s-season .gfeas{border-radius:12px;padding:10px 14px;margin-top:10px;font-size:14px;line-height:1.5;border:1px solid} #s-season .gfeas.ok{background:rgba(52,209,127,.12);border-color:rgba(52,209,127,.45)} #s-season .gfeas.warn{background:rgba(224,166,58,.12);border-color:rgba(224,166,58,.45)} #s-season .gfeas b{display:block}
    #s-season .gwhy{font-size:14px;line-height:1.5;color:#dbe7df;margin:8px 0 0} #s-season .gbadge{display:inline-block;font-size:11px;font-weight:800;padding:2px 8px;border-radius:6px;background:var(--green);color:#06170f}`;
  document.head.appendChild(st);

  window.showSeason = () => { FA.load().then(() => { ui.step = S?.league ? "league" : "start"; render(); }); };
  return { render, demoLeague, bestLineup, evalLineup, suggestions, compare, matchPlayer, get: () => S, set: (v) => { S = v; save(); }, ui };
})();

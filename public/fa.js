// Fantalgoritmo: base dati (public/data.json), riparametrazione e scheda giocatore.
// Le colonne economiche dell'Excel sono su 1000 FM: pma (P. Med. Aste), pstat (P. stat.), pgol (P. Gol M.) → × budget / 1000.
window.FA = (() => {
  const ROLE_LABEL = { POR: "Portieri", DIF: "Difensori", CEN: "Centrocampisti", ATT: "Attaccanti" };
  const ROLE_SHORT = { POR: "P", DIF: "D", CEN: "C", ATT: "A" };
  let data = null, byId = {}, ready = null;

  function load() {
    if (!ready) ready = fetch("/data.json").then((r) => r.json()).then((d) => { data = d; d.players.forEach((p) => (byId[p.id] = p)); return d; });
    return ready;
  }
  const players = () => (data ? data.players : []);
  const get = (id) => byId[id] || null;
  const scale = (v, budget) => (v == null ? null : Math.round((v * budget) / (data ? data.base : 1000)));
  // valore Fantalgoritmo riparametrato (P. Med. Aste); null se il giocatore non è nel file
  const value = (p, budget) => (p && p.fa && p.fa.pma != null ? Math.max(1, scale(p.fa.pma, budget)) : null);

  const fasciaClass = (f) => {
    const s = (f || "").toLowerCase();
    if (s.includes("top")) return "top"; if (s.includes("semi")) return "semi";
    if (s.includes("1°") || s.includes("terza") || s.includes("titolare")) return "mid";
    if (s.includes("scomm") || s.includes("jolly") || s === "r") return "low";
    return "";
  };
  const trend = (t) => (t == null ? "" : t > 0 ? "↑" : t < 0 ? "↓" : "→");
  const fmt = (v, d = 0) => (v == null ? "—" : Number(v).toFixed(d));
  const tag = (t) => (t ? `<span class="fatag">${t}</span>` : "");

  // Scheda informativa (usata in solitaria e nei "Consigli Fantalgoritmo" del multiplayer)
  function cardHtml(p, budget, opts = {}) {
    if (!p) return "";
    const f = p.fa;
    if (!f) return `<div class="fabox"><div class="fahead"><b>${p.name}</b> <span class="muted">${p.team} · ${ROLE_LABEL[p.role]}</span></div>
      <div class="muted" style="margin-top:6px">Nessuna valutazione Fantalgoritmo per questo giocatore${p.cost ? ` · quotazione listone ${p.cost}` : ""}.</div></div>`;
    const v = value(p, budget), ps = scale(f.pstat, budget), pg = scale(f.pgol, budget);
    const isGk = p.role === "POR";
    return `<div class="fabox">
      <div class="fahead"><b>${p.name}</b> <span class="muted">${p.team} · ${ROLE_LABEL[p.role]}${f.mantra ? ` · ${f.mantra}` : ""}${f.rank ? ` · #${f.rank} nel ruolo` : ""}</span></div>
      <div class="fagrid">
        <div class="fakpi big"><span>Valore Fantalgoritmo</span><b>${v != null ? v + " FM" : "—"}</b></div>
        <div class="fakpi"><span>Indice IA</span><b>${fmt(f.ia, 1)}</b></div>
        <div class="fakpi"><span>Prezzo statistico</span><b>${ps != null ? ps + " FM" : "—"}</b></div>
        <div class="fakpi"><span>Prezzo/gol</span><b>${pg != null ? pg + " FM" : "—"}</b></div>
        <div class="fakpi"><span>Quotazione</span><b>${fmt(f.qt)}${p.cost ? ` <small>· listone ${p.cost}</small>` : ""}</b></div>
        <div class="fakpi"><span>Affidabilità</span><b>${f.fv != null ? Math.round(f.fv * 100) + "%" : "—"}</b></div>
        <div class="fakpi"><span>Trend mercato / gol</span><b>${trend(f.trM)} <small>/</small> ${trend(f.trG)}</b></div>
      </div>
      <div class="fatags">${f.fascia ? `<span class="fatag fascia ${fasciaClass(f.fascia)}">${f.fascia}</span>` : ""}${tag(f.note)}${tag(f.sos)}</div>
      ${opts.compact ? "" : `<div class="fastats">
        <span>Stagione scorsa:</span>
        <b>${fmt(f.pg)}</b> pres · <b>${fmt(f.media, 2)}</b> mv · <b>${fmt(f.fmed, 2)}</b> fm${isGk ? ` · <b>${fmt(f.golSub)}</b> gol subiti` : ` · <b>${fmt(f.gol)}</b> gol · <b>${fmt(f.ass)}</b> ass · <b>${fmt(f.amm)}</b> amm`}
      </div>
      ${f.accoppiata ? `<div class="muted" style="font-size:12px;margin-top:6px">Abbinamento squadre consigliato: ${f.accoppiata}</div>` : ""}`}
    </div>`;
  }

  // ---------- Logica consigli (condivisa) ----------
  // inflazione prudente: peso n/(n+8), cap ±30%. sold = [{id, price}], budget, available = funzione id->bool
  function inflation(sold, budget) {
    const calc = (rows) => {
      let real = 0, exp = 0, n = 0;
      // esclude i giocatori da 1-2 FM: il rapporto sarebbe puro rumore
      const minV = Math.max(3, Math.round(budget * 0.006));
      rows.forEach((s) => { const p = get(s.id), v = value(p, budget); if (v && v >= minV) { real += s.price; exp += v; n++; } });
      if (!n || !exp) return { n, raw: 0, adj: 0 };
      const raw = Math.max(-0.5, Math.min(1, real / exp - 1)), w = n / (n + 8);
      return { n, raw, adj: Math.max(-0.3, Math.min(0.3, raw * w)) };
    };
    const all = calc(sold), byRole = {};
    ["POR", "DIF", "CEN", "ATT"].forEach((r) => { const rows = sold.filter((s) => get(s.id)?.role === r); byRole[r] = rows.length >= 5 ? calc(rows) : null; });
    return { all, byRole };
  }
  // valore corretto per l'inflazione osservata
  function adjValue(p, budget, infl) {
    const v = value(p, budget); if (v == null) return null;
    const k = (infl && (infl.byRole[p.role]?.adj ?? infl.all.adj)) || 0;
    return Math.max(1, Math.round(v * (1 + k)));
  }

  // distribuzione del budget residuo per ruolo, in proporzione al valore dei giocatori ancora disponibili
  // me = { budget (residuo), limits {POR..}, roster [{id, role, price}] }, isAvail(id)
  function plan(me, infl, isAvail) {
    const left = {}, total = Object.values(me.limits).reduce((a, b) => a + b, 0) - me.roster.length;
    ["POR", "DIF", "CEN", "ATT"].forEach((r) => (left[r] = Math.max(0, me.limits[r] - me.roster.filter((x) => x.role === r).length)));
    const exp = {}; let sumExp = 0;
    ["POR", "DIF", "CEN", "ATT"].forEach((r) => {
      if (!left[r]) { exp[r] = 0; return; }
      const vals = players().filter((p) => p.role === r && p.fa && isAvail(p.id)).map((p) => adjValue(p, me.budget + 0, infl) || 1).sort((a, b) => b - a);
      // fascia "ragionevole": dal k-esimo al 3k-esimo miglior disponibile
      const k = left[r], slice = vals.slice(k - 1, Math.max(k, 3 * k)); const avg = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 1;
      exp[r] = Math.max(k, avg * k); sumExp += exp[r];
    });
    const quota = {};
    ["POR", "DIF", "CEN", "ATT"].forEach((r) => (quota[r] = sumExp ? Math.round((exp[r] / sumExp) * me.budget) : 0));
    return { left, total, quota, exp };
  }

  // concorrenza sul giocatore: avversari che hanno ancora slot nel ruolo e budget per seguirti
  // rivals = [{ budget, maxBid, limits, roster:[{role}] }]
  function competition(p, rivals, v) {
    if (!rivals) return null;
    const need = rivals.filter((x) => x.roster.filter((y) => y.role === p.role).length < x.limits[p.role] && x.maxBid >= 1);
    const strong = v ? need.filter((x) => x.maxBid >= v) : need;
    const cap = need.length ? Math.max(...need.map((x) => x.maxBid)) + 1 : 1; // oltre questo nessuno può superarti
    const factor = need.length === 0 ? 0 : 1 + Math.min(0.1, 0.03 * strong.length);
    const level = need.length === 0 ? "nessuna" : strong.length >= 3 ? "alta" : strong.length >= 1 ? "media" : "bassa";
    return { need: need.length, strong: strong.length, cap, factor, level };
  }

  // limite consigliato per un giocatore data la situazione (rivals opzionale: modalità condivisa)
  function limitFor(p, me, infl, isAvail, rivals) {
    const pl = plan(me, infl, isAvail), r = p.role;
    if (!pl.left[r]) return { limit: 0, reason: `Hai già ${me.limits[r]} ${ROLE_LABEL[r].toLowerCase()}`, plan: pl };
    const hardCap = me.budget - (pl.total - 1); // 1 FM per ogni altro slot
    // per gli altri slot del ruolo tengo un prezzo "economico" (25° percentile dei disponibili)
    const cheap = players().filter((x) => x.role === r && x.fa && isAvail(x.id)).map((x) => adjValue(x, me.budget, infl) || 1).sort((a, b) => a - b);
    const floor = Math.max(1, cheap[Math.floor(cheap.length * 0.25)] || 1);
    const quotaCap = Math.max(1, pl.quota[r] - (pl.left[r] - 1) * floor);
    const v = adjValue(p, me.budget, infl);
    const comp = competition(p, rivals, v);
    if (v == null) {
      let lim = Math.max(0, Math.min(hardCap, quotaCap)); if (comp) lim = Math.min(lim, comp.cap);
      return { limit: lim, reason: "Nessun valore Fantalgoritmo: limite basato solo sul budget", plan: pl, value: null, hardCap, quotaCap, comp };
    }
    // se ho più budget del necessario nel ruolo posso spingere fino a +20%
    const slack = Math.max(0, Math.min(0.2, pl.quota[r] / Math.max(1, pl.exp[r]) - 1));
    let target = Math.round(v * (1 + slack)), reason;
    if (comp && comp.need === 0) target = 1; // nessun avversario può prenderlo: basta l'offerta base
    else if (comp && comp.factor > 1) target = Math.round(target * comp.factor);
    let limit = Math.max(0, Math.min(hardCap, quotaCap, target));
    if (comp && comp.need > 0 && comp.cap < limit) { limit = comp.cap; reason = `Nessun avversario può superare ${comp.cap - 1} FM: inutile spingere oltre`; }
    else if (comp && comp.need === 0) reason = `Nessun avversario ha ancora bisogno di un ${ROLE_LABEL[r].toLowerCase().replace(/i$/, "e")}: lo prendi all'offerta base`;
    else if (limit === hardCap) reason = `Devi tenere ${pl.total - 1} FM per gli altri ${pl.total - 1} giocatori`;
    else if (limit === quotaCap) reason = `Per i ${ROLE_LABEL[r].toLowerCase()} hai circa ${pl.quota[r]} FM: ne servono ${floor} per ciascuno degli altri ${pl.left[r] - 1}`;
    else if (comp && comp.factor > 1 && slack > 0) reason = `Valore ${v} FM, +${Math.round(slack * 100)}% budget in eccesso nel ruolo, +${Math.round((comp.factor - 1) * 100)}% per la concorrenza`;
    else if (comp && comp.factor > 1) reason = `Valore ${v} FM, +${Math.round((comp.factor - 1) * 100)}% perché ${comp.strong} avversar${comp.strong === 1 ? "io può" : "i possono"} seguirti fino al valore`;
    else if (slack > 0) reason = `Valore ${v} FM, +${Math.round(slack * 100)}% perché sei sotto budget nel ruolo`;
    else reason = `Pari al valore Fantalgoritmo corretto per l'asta`;
    return { limit, reason, plan: pl, value: v, hardCap, quotaCap, comp };
  }

  const verdict = (price, limit) => (limit <= 0 ? "no" : price <= limit * 0.9 ? "buy" : price <= limit ? "near" : "leave");
  const fairness = (price, v) => (v == null ? null : price <= v * 0.8 ? "affare" : price <= v * 1.05 ? "corretto" : price <= v * 1.25 ? "caro" : "sovraprezzato");

  return { load, players, get, scale, value, adjValue, inflation, plan, limitFor, competition, verdict, fairness, cardHtml, ROLE_LABEL, ROLE_SHORT, fasciaClass };
})();

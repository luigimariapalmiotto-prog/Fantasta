// Asta guidata: "con budget e rosa attuali, chi dovrei comprare adesso?"
// Ottimizzatore: parte dalla rosa più economica che completa tutti gli slot, poi applica upgrade
// (sostituzione di un giocatore con uno migliore nello stesso ruolo) scegliendo ogni volta quello con il
// miglior guadagno di qualità per FM, finché il budget lo consente. Ricalcolato da zero a ogni evento.
window.GUIDED = (() => {
  const $ = (id) => document.getElementById(id);
  const ROLES = ["POR", "DIF", "CEN", "ATT"], RL = FA.ROLE_LABEL, RS = FA.ROLE_SHORT;
  const RNAME = { POR: "Portieri", DIF: "Difesa", CEN: "Centrocampo", ATT: "Attacco" };
  const SLOTP = { POR: "P", DIF: "D", CEN: "C", ATT: "A" };
  let lastPlan = null, banner = null, pending = null, planOpen = null, focusId = null;

  // qualità di un giocatore: premia i top (convessa in IA), piccola penalità per scarsa affidabilità
  // pesi per ruolo: l'IA è normalizzato dentro ogni ruolo, ma un attaccante forte porta più bonus di un difensore forte
  const RW = { POR: 0.5, DIF: 0.75, CEN: 1.0, ATT: 1.9 }; window.GUIDED_EXP = 2.2;
  const quality = (p) => { const ia = p.fa?.ia || 40, fv = p.fa?.fv ?? 0.7; return (RW[p.role] || 1) * Math.pow(Math.max(0, ia - 35) / 10, GUIDED_EXP) * (0.85 + 0.15 * fv); };
  const tierOf = (p, cost, budget) => {
    const f = (p.fa?.fascia || "").toLowerCase();
    if (f.includes("semi")) return "SEMITOP"; if (f.includes("top")) return "TOP";
    const rel = cost / budget; return rel >= 0.14 ? "TOP" : rel >= 0.07 ? "SEMITOP" : rel >= 0.025 ? "TITOLARE" : "LOW COST";
  };

  // --- mercato: domanda residua, offerta disponibile, scarsità per ruolo ---
  // domanda = partecipanti × slot per ruolo − già venduti (a me o ad altri); offerta = disponibili con valutazione.
  function market(S, isAvail) {
    const N = S.participants || 8, m = {};
    const soldAll = S.roster.concat(S.sold);
    ROLES.forEach((r) => {
      const soldR = soldAll.filter((x) => FA.get(x.id)?.role === r).length;
      const demand = Math.max(0, N * S.limits[r] - soldR);
      // sul mercato restano disponibili anche i giocatori che ho escluso per me
      const avail = FA.players().filter((p) => p.role === r && p.fa && !S.roster.some((x) => x.id === p.id) && !S.sold.some((x) => x.id === p.id));
      const qs = avail.map((p) => quality(p)).sort((a, b) => b - a);
      const marginal = qs[Math.min(qs.length - 1, Math.max(0, demand - 1))] || 0; // qualità del giocatore "di soglia": chi sta sopra verrà comprato da qualcuno
      // usabili: titolari credibili (IA ≥ 60); tightness > 1 significa più domanda residua che giocatori usabili
      const usable = avail.filter((p) => (p.fa.ia || 0) >= 60).length;
      const tightness = demand ? Math.min(2.5, Math.max(0.3, demand / Math.max(1, usable))) : 0.3;
      // qualità media di ciò che resta per coprire la domanda: scende quando escono i top → scarsità in aumento
      const pool = qs.slice(0, Math.max(1, demand)); const qpool = pool.length ? pool.reduce((a, b) => a + b, 0) / pool.length : 0;
      m[r] = { demand, avail: avail.length, soldR, marginal, usable, tightness, qpool, N };
    });
    return m;
  }

  // --- ottimizzazione (consapevole della scarsità) ---
  function optimize(S, infl, isAvail, prevIds = null) {
    const R = S.budget - S.roster.reduce((a, x) => a + x.price, 0);
    const need = {}; ROLES.forEach((r) => (need[r] = Math.max(0, S.limits[r] - S.roster.filter((x) => FA.get(x.id)?.role === r).length)));
    const total = ROLES.reduce((a, r) => a + need[r], 0);
    const mk = market(S, isAvail);
    if (!total) return { slots: [], byRole: {}, total: 0, budget: R, spare: R, quality: 0, market: mk, need };
    const N = S.participants || 8;
    const cand = {};
    ROLES.forEach((r) => {
      // piccolo bonus di stabilità a chi era già nel piano: evita oscillazioni a parità di merito
      const base = FA.players().filter((p) => p.role === r && p.fa && isAvail(p.id)).map((p) => ({ p, q: quality(p) * (prevIds && prevIds.has(p.id) ? 1.03 : 1), v: Math.max(1, FA.adjValue(p, S.budget, infl) || 1) })).sort((a, b) => b.q - a.q);
      const D = Math.max(1, mk[r].demand);
      // prezzo atteso = valore × premio di scarsità: cresce per i giocatori in cima alla domanda residua, più forte se il mercato è stretto e con molti partecipanti
      base.forEach((c, rank) => { const f = Math.min(1, rank / D); c.premium = 1 + 0.18 * (N / 8) * Math.pow(1 - f, 2) * mk[r].tightness; c.cost = Math.max(1, Math.round(c.v * c.premium)); c.rank = rank; });
      cand[r] = base.sort((a, b) => a.cost - b.cost || b.q - a.q);
    });
    // rosa di partenza: per ogni slot il miglior giocatore tra i più economici (costo minimo del ruolo)
    const chosen = {}; let spent = 0; const used = new Set();
    ROLES.forEach((r) => {
      chosen[r] = [];
      const pool = cand[r].slice().sort((a, b) => a.cost - b.cost || b.q - a.q);
      for (let i = 0; i < need[r]; i++) { const c = pool.find((x) => !used.has(x.p.id)); if (!c) break; used.add(c.p.id); chosen[r].push(c); spent += c.cost; }
    });
    // upgrade marginali
    for (let iter = 0; iter < 400; iter++) {
      let best = null;
      ROLES.forEach((r) => {
        chosen[r].forEach((cur, si) => {
          for (const c of cand[r]) {
            if (used.has(c.p.id) || c.q <= cur.q || c.cost <= cur.cost) continue;
            const dc = c.cost - cur.cost; if (spent + dc > R) continue;
            const ratio = (c.q - cur.q) / dc;
            if (!best || ratio > best.ratio) best = { r, si, c, ratio, dc };
          }
        });
      });
      if (!best) break;
      used.delete(chosen[best.r][best.si].p.id); used.add(best.c.p.id); chosen[best.r][best.si] = best.c; spent += best.dc;
    }
    // slot ordinati per costo decrescente, con alternative dello stesso ruolo e fascia di costo
    const slots = [], byRole = {};
    ROLES.forEach((r) => {
      const list = chosen[r].slice().sort((a, b) => b.cost - a.cost);
      byRole[r] = { budget: list.reduce((a, x) => a + x.cost, 0), n: list.length };
      list.forEach((c, i) => {
        // copertura dello slot: disponibili di livello simile (≥80% qualità) rispetto alla domanda attesa degli avversari per quel livello
        // copertura: disponibili di livello simile (≥80% qualità) rispetto ai rivali che puntano a quel livello,
        // assumendo che ogni rivale voglia tanti giocatori di quel livello quanti ne prevede il mio piano
        const peers = cand[r].filter((x) => x.q >= 0.8 * c.q);
        const mySlotsAtLevel = list.filter((x) => x.q >= 0.8 * c.q).length;
        const othersDemand = (N - 1) * mySlotsAtLevel;
        const coverage = peers.length / Math.max(1, othersDemand + 1);
        const urgency = coverage < 1 ? "alta" : coverage < 1.6 ? "media" : "bassa";
        const nAlt = urgency === "alta" ? 3 : 2;
        const alts = cand[r].filter((x) => !used.has(x.p.id) && x.cost <= c.cost * 1.15 && x.cost >= c.cost * 0.6).sort((a, b) => b.q - a.q).slice(0, nAlt);
        const target = c.cost, limit = Math.max(target, Math.min(Math.round(target * (urgency === "alta" ? 1.22 : 1.15)), R - (total - 1)));
        slots.push({ id: `${SLOTP[r]}${i + 1}`, role: r, p: c.p, target, value: c.v, lo: Math.max(1, Math.round(target * 0.9)), hi: Math.round(target * 1.05), limit, tier: tierOf(c.p, target, S.budget), q: c.q, alts: alts.map((a) => a.p), coverage, urgency, peers: peers.length });
      });
    });
    const qAll = slots.reduce((a, s) => a + s.q, 0) + S.roster.reduce((a, x) => a + quality(FA.get(x.id) || {}), 0);
    const nAll = slots.length + S.roster.length;
    return { slots, byRole, total, budget: R, spare: R - spent, quality: nAll ? qAll / nAll : 0, need, market: mk };
  }
  // priorità: peso dell'investimento × urgenza (poca copertura = da prendere ora)
  const queue = (plan) => plan.slots.slice().sort((a, b) => b.target * (1 + (1 - Math.min(a.coverage ?? 2, 2) / 2)) - a.target * (1 + (1 - Math.min(b.coverage ?? 2, 2) / 2)) || b.target - a.target).sort((a, b) => (b.target * (b.urgency === "alta" ? 1.5 : b.urgency === "media" ? 1.15 : 1)) - (a.target * (a.urgency === "alta" ? 1.5 : a.urgency === "media" ? 1.15 : 1)));

  // --- confronto tra piani per la spiegazione ---
  function diffPlans(oldP, newP) {
    if (!oldP || !newP) return null;
    const roles = ROLES.filter((r) => (oldP.byRole[r]?.budget || 0) !== (newP.byRole[r]?.budget || 0)).map((r) => ({ r, from: oldP.byRole[r]?.budget || 0, to: newP.byRole[r]?.budget || 0 }));
    const slotsChanged = newP.slots.map((s) => { const o = oldP.slots.find((x) => x.id === s.id); return o && o.target !== s.target ? { id: s.id, from: o.target, to: s.target } : null; }).filter(Boolean).slice(0, 4);
    // cambio di strategia: solo se cambia il numero di TOP o SEMITOP in un reparto
    const shape = (P, r) => { const t = P.slots.filter((s) => s.role === r).map((s) => s.tier); return [t.filter((x) => x === "TOP").length, t.filter((x) => x === "SEMITOP").length]; };
    const strategy = ROLES.filter((r) => shape(oldP, r).join() !== shape(newP, r).join() && newP.slots.some((s) => s.role === r)).map((r) => { const [t, st] = shape(newP, r); const [t0, s0] = shape(oldP, r); return `${RNAME[r]}: ${t0} top + ${s0} semitop → <b>${t} top + ${st} semitop</b>`; });
    const strategyOut = strategy.length ? strategy : null;
    const scarcity = ROLES.filter((r) => oldP.market && newP.market && newP.need[r] > 0 && newP.market[r].qpool < oldP.market[r].qpool * 0.988).map((r) => ({ r, from: oldP.market[r].qpool, to: newP.market[r].qpool, drop: 1 - newP.market[r].qpool / oldP.market[r].qpool }));
    return { roles, slotsChanged, strategy: strategyOut, scarcity };
  }

  // --- azioni ---
  function commit(kind, id, price) {
    const S = SOLO.get(); const before = lastPlan;
    if (kind === "roster") { S.roster.push({ id, price, t: Date.now() }); S.history.push({ type: "roster", id }); if (window.fireworks) window.fireworks(1600); }
    else if (kind === "sold") { S.sold.push({ id, price: price || 0, t: Date.now() }); S.history.push({ type: "sold", id }); }
    else { S.excluded.push(id); S.history.push({ type: "excluded", id }); }
    SOLO.save(); pending = null; focusId = null;
    const p = FA.get(id), plan = compute(); const d = diffPlans(before, plan);
    const slot = before?.slots.find((s) => s.p.id === id);
    if (kind === "roster") banner = { kind, title: `ACQUISTATO ✓ ${p.name} — ${price} FM`, lines: [slot ? `${price - slot.target > 0 ? "+" : ""}${price - slot.target} FM rispetto al piano (target ${slot.target})` : "Fuori piano, integrato nella strategia"], d };
    else if (kind === "sold") banner = { kind, title: `${p.name} PERSO${price ? ` — venduto a ${price} FM` : ""}`, lines: [slot && price ? `${price - slot.target > 0 ? "+" : ""}${price - slot.target} FM rispetto al valore atteso` : "Escluso dalle possibilità future"], d };
    else banner = { kind, title: `${p.name} escluso dai suggerimenti`, lines: [], d };
    planOpen = false; SOLO.render();
  }
  function undo() {
    const before = lastPlan; const h = SOLO.undo(); if (!h) return;
    const plan = compute(); pending = null;
    banner = { kind: "undo", title: `↩ Annullato: ${FA.get(h.id)?.name}`, lines: [h.type === "roster" ? "rimosso dalla rosa, budget ripristinato" : h.type === "sold" ? "di nuovo disponibile" : "di nuovo tra i suggerimenti"], d: diffPlans(before, plan) };
    SOLO.render();
  }
  function compute() {
    const S = SOLO.get(); const prev = lastPlan ? new Set(lastPlan.slots.map((s) => s.p.id)) : null; const plan = optimize(S, SOLO.infl(), SOLO.isAvail, prev); lastPlan = plan; return plan;
  }

  // --- UI ---
  const tierClass = (t) => ({ TOP: "top", SEMITOP: "semi", TITOLARE: "mid", "LOW COST": "low" }[t] || "");
  const rowSlot = (s, showAlts = true) => `<div class="gslot" data-id="${s.p.id}">
      <div class="gslot-h"><span class="gid ${s.role}">${s.id}</span><span class="fatag fascia ${tierClass(s.tier)}">${s.tier}</span><span class="gtarget">target <b>${s.target}</b> · max ${s.limit}</span></div>
      <div class="gname">${s.p.name} <small>${s.p.team}</small></div>
      ${showAlts && s.alts.length ? `<div class="galts">alternative: ${s.alts.map((a) => `<span data-alt="${a.id}">${a.name}</span>`).join(" · ")}</div>` : ""}
    </div>`;

  // --- registra acquisto avversario (qualsiasi giocatore, anche fuori piano) ---
  let quick = { q: "", id: null };
  function quickHtml() {
    const S = SOLO.get(); const p = quick.id ? FA.get(quick.id) : null;
    const rows = !p && quick.q.length >= 2 ? SOLO.search(quick.q, "ALL").filter((x) => SOLO.isAvail(x.id)).slice(0, 6) : [];
    return `<div class="gquick"><div class="card">
      <div class="gb-h">Registra acquisto avversario</div>
      ${p ? `<div class="pick"><span class="rl ${p.role}">${RS[p.role]}</span><span>${p.name} <small class="muted">${p.team}</small></span><a href="#" id="gq-clear" class="muted" style="margin-left:auto;font-size:12px">cambia</a></div>
        <div class="row" style="align-items:center"><input id="gq-price" type="number" inputmode="numeric" placeholder="prezzo finale" style="font-size:22px;text-align:center;font-family:var(--display)"><button class="secondary" id="gq-other" style="flex:0 0 150px">Acquistato da altro</button></div>
        <a href="#" id="gq-mine" class="muted" style="font-size:12px;display:block;margin-top:6px">…in realtà l'ho comprato io</a>`
      : `<input id="gq-q" placeholder="Cerca il giocatore appena venduto…" autocomplete="off" value="${quick.q}">${rows.length ? `<div>${rows.map((x) => `<div class="lrow" data-gq="${x.id}" style="cursor:pointer"><span class="rl ${x.role}">${RS[x.role]}</span><span class="nm">${x.name}<small>${x.team}</small></span><span class="cost">${FA.value(x, S.budget) ?? "—"}</span></div>`).join("")}</div>` : ""}`}
    </div></div>`;
  }
  function render() {
    const S = SOLO.get(), box = $("so-guided"); if (!S) return;
    const plan = compute(), R = plan.budget, done = S.roster.length, tot = SOLO.total();
    if (planOpen === null) planOpen = done === 0 && !S.history.length;
    const q = queue(plan); let first = focusId ? q.find((s) => s.p.id === focusId) : null; first = first || q[0]; const after = q.filter((s) => s !== first).slice(0, 4);
    const tc = first ? (window.TEAM_COLORS?.[first.p.team] || ["#34d17f", "#0b2418", "#fff"]) : null;
    const slotsBox = ROLES.map((r) => `<span class="gslots"><b>${RS[r]}</b> ${"✓".repeat(S.limits[r] - plan.need[r])}${"□".repeat(plan.need[r])}</span>`).join("");
    const mk = plan.market, soldTot = S.sold.length + S.roster.length, availTot = ROLES.reduce((a, r) => a + mk[r].avail, 0), inf = SOLO.infl();
    const infTxt = inf.all.n ? `inflazione <b>${inf.all.adj > 0 ? "+" : ""}${Math.round(inf.all.adj * 100)}%</b>${ROLES.filter((r) => inf.byRole[r]).map((r) => ` · ${RS[r]} ${inf.byRole[r].adj > 0 ? "+" : ""}${Math.round(inf.byRole[r].adj * 100)}%`).join("")}` : "";
    const marketHtml = `<div class="gmarket"><span>${S.participants} squadre · venduti <b>${soldTot}</b> (${ROLES.map((r) => `${RS[r]} ${mk[r].soldR}`).join(" · ")}) · disponibili <b>${availTot}</b></span><span>${infTxt}</span></div>`;
    const why = first ? (() => { const n = plan.need[first.role], sameTier = plan.slots.filter((s) => s.role === first.role && s.tier === first.tier).length; return `Ti ${n === 1 ? "manca" : "mancano"} ${n} ${RL[first.role].toLowerCase()}${n === 1 ? "" : ""}: il piano prevede ${sameTier} ${first.tier.toLowerCase()} in ${RNAME[first.role].toLowerCase()} e il budget attuale (${R} FM per ${plan.total} giocatori) permette questo investimento.`; })() : "";

    const bannerHtml = banner ? `<div class="gbanner k-${banner.kind}"><div class="gb-t">${banner.title}</div>${banner.lines.map((l) => `<div class="gb-l">${l}</div>`).join("")}
      ${banner.d && (banner.d.strategy || banner.d.roles.length || banner.d.slotsChanged.length) ? `<div class="gb-plan"><div class="gb-h">PIANO AGGIORNATO</div>
        ${banner.d.scarcity && banner.d.scarcity.length ? banner.d.scarcity.map((x) => `<div class="gb-l scar">SCARSITÀ ${RNAME[x.r].toUpperCase()} ↑ <small>qualità disponibile per la domanda residua −${Math.round(x.drop * 100)}%</small></div>`).join("") : ""}
        ${banner.d.strategy ? `<div class="gb-l"><b>Cambio di strategia</b></div>${banner.d.strategy.map((x) => `<div class="gb-l">${x}</div>`).join("")}` : ""}
        ${banner.d.roles.map((x) => `<div class="gb-l">${RNAME[x.r]} ${x.from} → <b>${x.to}</b> FM <span class="${x.to > x.from ? "up" : "down"}">${x.to > x.from ? "+" : ""}${x.to - x.from}</span></div>`).join("")}
        ${banner.d.slotsChanged.map((x) => `<div class="gb-l">${x.id}: ${x.from} → <b>${x.to}</b> FM</div>`).join("")}</div>` : ""}
      <a href="#" id="gb-close">chiudi</a></div>` : "";

    const pendHtml = pending ? `<div class="gpend"><div class="muted" style="font-size:12px;letter-spacing:.06em;text-transform:uppercase">${pending.kind === "roster" ? "Prezzo pagato" : "Venduto a (opzionale)"}</div>
        <div class="row" style="align-items:center"><input id="g-price" type="number" inputmode="numeric" placeholder="${pending.kind === "roster" ? first?.target ?? "" : "prezzo"}" value="${pending.kind === "roster" && first ? first.target : ""}"><button class="green" id="g-confirm" style="margin:0;flex:0 0 140px">Conferma</button></div>
        <a href="#" id="g-cancel" class="muted" style="font-size:12px">annulla</a></div>` : "";

    box.innerHTML = `
      <div class="gstatus"><div><span>La tua asta</span><b>${done} / ${tot}</b></div><div><span>Residuo</span><b>${R}<small> FM</small></b></div><div><span>Qualità piano</span><b>${plan.quality.toFixed(1)}</b></div></div>
      <div class="gslotsrow">${slotsBox}</div>
      ${marketHtml}
      ${bannerHtml}
      ${quickHtml()}
      ${first ? `<div class="card player" style="--t1:${tc[0]};--t2:${tc[1]};--tink:${tc[2]};padding-top:20px;text-align:left">
        <div class="kicker" style="margin:0 0 6px">🎯 Prossimo obiettivo · slot ${first.id} ${first.tier}</div>
        <div style="margin:0 0 6px"><span class="gurg ${first.urgency}">${first.urgency === "alta" ? "Priorità alta: acquista ora" : first.urgency === "media" ? "Scarsità in aumento" : "Puoi aspettare: ci sono alternative"}</span> <span class="muted" style="font-size:12px">${first.peers} disponibili di questo livello · domanda residua ${RNAME[first.role].toLowerCase()} ${plan.market[first.role].demand}</span></div>
        <div class="name" style="text-align:left">${first.p.name}</div>
        <div class="meta" style="text-align:left"><span class="team">${first.p.team}</span> <span class="role ${first.role}">${RL[first.role]}</span></div>
        <div class="fagrid" style="margin-top:14px">
          <div class="fakpi"><span>Valore Fantalgoritmo</span><b>${FA.adjValue(first.p, S.budget, SOLO.infl())} FM</b></div>
          <div class="fakpi"><span>Prezzo target</span><b>${first.lo}–${first.hi} FM</b></div>
          <div class="fakpi big lim" style="grid-column:1/-1"><span>Tuo limite</span><b>${first.limit} FM</b><small>${why}</small></div>
        </div>
        ${pendHtml}
        ${pending ? "" : `<div class="gactions"><button class="green" id="g-buy">✓ L'ho comprato</button><button class="secondary" id="g-lost">✕ Acquistato da un altro</button><button class="secondary" id="g-skip">⏭ Non mi interessa</button></div>`}
        ${first.alts.length ? `<div class="galts" style="margin-top:10px">Se sfuma: ${first.alts.map((a) => `<span data-alt="${a.id}">${a.name} <small>${a.team}</small></span>`).join(" · ")}</div>` : ""}
        <a href="#" id="g-detail" class="muted" style="display:block;margin-top:8px;font-size:12px">apri la scheda completa nell'Assistente ›</a>
      </div>` : `<div class="card"><h3>Rosa completa</h3><div class="muted">Hai riempito tutti gli slot. Budget non speso: ${R} FM.</div></div>`}
      ${after.length ? `<div class="card tight"><div class="gb-h" style="padding:8px 0 2px">DOPO</div>${after.map((s, i) => `<div class="lrow gq" data-id="${s.p.id}" style="cursor:pointer"><span class="rl ${s.role}">${s.id}</span><span class="nm">${s.p.name}<small>${s.p.team} · ${s.tier.toLowerCase()}</small></span><span class="st">${s.lo}–${s.hi} FM</span><span class="cost">${s.target}</span></div>`).join("")}<div class="muted" style="font-size:11px;padding:6px 0">tocca un obiettivo per gestirlo subito</div></div>` : ""}
      <div class="card" id="g-plan"><h3 style="cursor:pointer" id="g-plan-toggle">Il tuo piano<span>${plan.slots.length} slot · ${planOpen ? "nascondi" : "mostra"}</span></h3>
        <div class="gbudget">${ROLES.filter((r) => plan.byRole[r]?.n).map((r) => `<div><span>${RNAME[r]}</span><b>${plan.byRole[r].budget}</b><small>${plan.byRole[r].n} slot</small></div>`).join("")}<div class="tot"><span>Totale previsto</span><b>${plan.slots.reduce((a, s) => a + s.target, 0)}</b><small>di ${R} FM${plan.spare > 0 ? ` · ${plan.spare} liberi` : ""}</small></div></div>
        ${planOpen ? ROLES.filter((r) => plan.byRole[r]?.n).map((r) => `<h4>${RNAME[r]} · ${plan.byRole[r].budget} FM</h4>${plan.slots.filter((s) => s.role === r).map((s) => rowSlot(s)).join("")}`).join("") : ""}
      </div>
      <div class="row"><button class="secondary" id="g-undo" ${S.history.length ? "" : "disabled"}>↩ Annulla ultima azione</button></div>`;

    // eventi
    const bind = (id, fn) => { const e = $(id); if (e) e.onclick = (ev) => { ev.preventDefault(); fn(); }; };
    bind("g-buy", () => { pending = { kind: "roster" }; SOLO.render(); setTimeout(() => $("g-price")?.focus(), 30); });
    bind("g-lost", () => { pending = { kind: "sold" }; SOLO.render(); setTimeout(() => $("g-price")?.focus(), 30); });
    bind("g-skip", () => commit("excluded", first.p.id));
    bind("g-cancel", () => { pending = null; SOLO.render(); });
    bind("g-confirm", () => { const v = parseInt($("g-price").value, 10); if (pending.kind === "roster" && (!v || v < 1)) { $("g-price").focus(); return; } commit(pending.kind, first.p.id, v || 0); });
    const gp = $("g-price"); if (gp) gp.onkeydown = (e) => { if (e.key === "Enter") $("g-confirm").click(); };
    bind("g-undo", undo); bind("gb-close", () => { banner = null; SOLO.render(); });
    const gq = $("gq-q"); if (gq) { gq.oninput = () => { quick.q = gq.value; const pos = gq.selectionStart; SOLO.render(); const e2 = $("gq-q"); if (e2) { e2.focus(); try { e2.setSelectionRange(pos, pos); } catch {} } }; }
    box.querySelectorAll("[data-gq]").forEach((el) => el.onclick = () => { quick = { q: "", id: el.dataset.gq }; SOLO.render(); setTimeout(() => $("gq-price")?.focus(), 30); });
    bind("gq-clear", () => { quick = { q: "", id: null }; SOLO.render(); });
    const doQuick = (kind) => { const v = parseInt($("gq-price").value, 10); if (kind === "roster" && (!v || v < 1)) { $("gq-price").focus(); return; } const id = quick.id; quick = { q: "", id: null }; commit(kind, id, v || 0); };
    bind("gq-other", () => doQuick("sold")); bind("gq-mine", () => doQuick("roster"));
    const gqp = $("gq-price"); if (gqp) gqp.onkeydown = (e) => { if (e.key === "Enter") doQuick("sold"); };
    bind("g-plan-toggle", () => { planOpen = !planOpen; SOLO.render(); });
    bind("g-detail", () => SOLO.openPlayer(first.p.id));
    box.querySelectorAll(".gq, .gslot").forEach((el) => el.onclick = (ev) => { if (ev.target.dataset.alt) return; focusId = el.dataset.id; pending = null; SOLO.render(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    box.querySelectorAll("[data-alt]").forEach((el) => el.onclick = (ev) => { ev.stopPropagation(); SOLO.openPlayer(el.dataset.alt); });
  }

  // stile
  const st = document.createElement("style"); st.textContent = `
    .gstatus{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px}
    .gstatus div{background:rgba(0,0,0,.25);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
    .gstatus span{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
    .gstatus b{display:block;font-family:var(--display);font-weight:400;font-size:24px;color:#fff;line-height:1.1;margin-top:2px;white-space:nowrap}
    .gstatus b small{font-size:11px;color:var(--muted);font-family:"Plus Jakarta Sans",sans-serif;font-weight:600}
    .gslotsrow{display:flex;gap:12px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin:0 2px 12px;letter-spacing:.05em}
    .gslotsrow b{color:#fff}
    .gactions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}
    .gactions button{margin:0;padding:13px 8px;font-size:14px}
    .gactions button:first-child{grid-column:1/-1;font-size:17px;padding:16px}
    .gpend{margin-top:14px;padding:12px;border-radius:12px;background:rgba(0,0,0,.3);border:1px solid rgba(52,209,127,.4)}
    .gpend input{font-size:26px;text-align:center;font-family:var(--display)}
    .gbanner{background:rgba(52,209,127,.12);border:1px solid rgba(52,209,127,.45);border-radius:14px;padding:12px 14px;margin-bottom:12px}
    .gbanner.k-sold{background:rgba(255,93,93,.10);border-color:rgba(255,93,93,.45)}
    .gbanner.k-undo,.gbanner.k-excluded{background:rgba(255,255,255,.06);border-color:var(--line)}
    .gb-t{font-family:var(--display);font-size:20px;letter-spacing:.02em;text-transform:uppercase}
    .gb-l{font-size:13px;color:#dbe7df;margin-top:3px}
    .gb-l .up{color:var(--green);font-weight:700}.gb-l .down{color:var(--red);font-weight:700}
    .gb-l.scar{font-family:var(--display);font-size:17px;letter-spacing:.03em;color:#ffb54a;margin-top:6px} .gb-l.scar small{font-family:"Plus Jakarta Sans",sans-serif;font-size:11px;color:var(--muted);display:block;letter-spacing:0}
    .gurg{display:inline-block;font-size:11px;font-weight:800;padding:3px 8px;border-radius:6px;letter-spacing:.06em;text-transform:uppercase}
    .gurg.alta{background:#ff5d5d;color:#fff}.gurg.media{background:#e0a63a;color:#111}.gurg.bassa{background:rgba(255,255,255,.12);color:var(--ink)}
    .gmarket{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--muted);margin:-4px 2px 12px;flex-wrap:wrap}
    .gmarket b{color:#fff}
    .gquick{margin-bottom:12px}
    .gquick .card{padding:12px 14px}
    .gquick input{margin-bottom:6px}
    .gquick .pick{display:flex;align-items:center;gap:8px;font-weight:800;margin:4px 0 8px}
    .gquick .pick .rl{width:26px;height:26px;border-radius:7px;font-size:12px;font-weight:800;color:#fff;display:grid;place-items:center}
    .gquick .row button{margin:0}
    .gb-plan{margin-top:8px;padding-top:8px;border-top:1px solid var(--line)}
    .gb-h{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--green);font-weight:700}
    .gbanner a{display:block;text-align:right;font-size:12px;color:var(--muted);margin-top:6px}
    .gbudget{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:6px 0 4px}
    .gbudget div{background:rgba(255,255,255,.05);border-radius:10px;padding:8px 10px}
    .gbudget span{display:block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
    .gbudget b{font-family:var(--display);font-weight:400;font-size:22px;color:#fff}
    .gbudget small{display:block;font-size:11px;color:var(--muted)}
    .gbudget .tot{grid-column:1/-1;border:1px solid rgba(52,209,127,.4)} .gbudget .tot b{color:var(--green)}
    .gslot{padding:9px 0;border-bottom:1px solid var(--line);cursor:pointer}
    .gslot-h{display:flex;align-items:center;gap:8px;font-size:12px}
    .gid{font-family:var(--display);font-size:14px;color:#fff;padding:1px 7px;border-radius:6px}
    .gtarget{margin-left:auto;color:var(--muted)} .gtarget b{color:#fff}
    .gname{font-weight:800;margin-top:4px} .gname small{color:var(--muted);font-weight:600}
    .galts{font-size:12px;color:var(--muted);margin-top:3px} .galts span{color:var(--ink);text-decoration:underline dotted;cursor:pointer} .galts small{color:var(--muted)}
    .gq .rl{width:32px;flex-basis:32px;font-size:11px}`;
  document.head.appendChild(st);

  return { RW, render, optimize, compute, commit, undo, quality, market, getPlan: () => lastPlan, openPlan: (v) => { planOpen = v; }, setFocus: (id) => { focusId = id; }, setQuick: (id) => { quick = { q: "", id }; }, reset: () => { lastPlan = null; banner = null; pending = null; planOpen = null; focusId = null; quick = { q: "", id: null }; } };
})();

// Asta guidata (In solitaria): strategia → piano (rosa ideale dinamica) → tattica (giocatore chiamato).
// Ottimizzatore: rosa più economica completabile + upgrade con miglior qualità/FM, con quote di budget per reparto,
// premio di scarsità legato ai partecipanti, giocatori prioritari forzati/bonus e blocchi portieri.
window.GUIDED = (() => {
  const $ = (id) => document.getElementById(id);
  const ROLES = ["POR", "DIF", "CEN", "ATT"], RL = FA.ROLE_LABEL, RS = FA.ROLE_SHORT;
  const RN = { POR: "Portieri", DIF: "Difesa", CEN: "Centrocampo", ATT: "Attacco" };
  const SLOTP = { POR: "P", DIF: "D", CEN: "C", ATT: "A" };
  let lastPlan = null, banner = null, called = { q: "", id: null, price: "", who: "" }, ui = { strat: false, going: false, review: false, why: false, prioQ: "" };

  // ---------- strategie ----------
  const STRATS = {
    fa:   { name: "Consigliata dal Fantalgoritmo", badge: "Consigliata", desc: "Strategia equilibrata elaborata sulle caratteristiche della tua lega: budget distribuito tra i reparti per una rosa competitiva, completa e sostenibile.", rw: { POR: 0.5, DIF: 0.75, CEN: 1.0, ATT: 1.9 }, exp: 2.2, share: null, risk: "Medio", focus: "Attacco e centrocampo", type: "Rosa profonda con 1–2 investimenti importanti", strengths: ["Miglior rapporto qualità/prezzo su tutta la rosa", "Usa i valori Fantalgoritmo e la scarsità del tuo mercato"], weak: ["Meno fuoriclasse assoluti: vince con la profondità"] },
    cust: { name: "Personalizzata", desc: "Decidi tu su quali giocatori puntare e come dividere il budget: il Fantalgoritmo costruisce la rosa dentro i tuoi vincoli e ti avvisa se non sono sostenibili.", rw: { POR: 0.5, DIF: 0.75, CEN: 1.0, ATT: 1.9 }, exp: 2.2, share: { POR: 8, DIF: 17, CEN: 27, ATT: 48 }, risk: "Variabile", focus: "A tua scelta", type: "Costruita intorno ai tuoi obiettivi", strengths: ["Massimo controllo su priorità e budget"], weak: ["Ripartizioni estreme riducono le alternative disponibili"] },
    agg:  { name: "Aggressiva", desc: "Orientata ai top player e a un attacco molto competitivo: una parte significativa del budget va agli attaccanti, accettando più esposizione negli altri reparti.", rw: { POR: 0.35, DIF: 0.55, CEN: 0.9, ATT: 2.6 }, exp: 3.0, share: { POR: 6, DIF: 14, CEN: 27, ATT: 53 }, risk: "Alto", focus: "Attacco", type: "1–2 top in attacco, value altrove", strengths: ["Potenziale offensivo molto elevato", "Attaccanti di prima fascia come obiettivo prioritario"], weak: ["Dipendenza da pochi giocatori", "Panchina meno profonda", "Difficoltà se i top superano il prezzo previsto", "Serve trovare occasioni negli altri reparti"] },
    conv: { name: "Convenzionale", desc: "Distribuzione tradizionale e progressiva: portieri < difensori < centrocampisti < attaccanti. Più prudente dell'aggressiva, con una rosa equilibrata e coperta in ogni ruolo.", rw: { POR: 0.6, DIF: 0.9, CEN: 1.0, ATT: 1.5 }, exp: 1.8, share: { POR: 8, DIF: 22, CEN: 31, ATT: 39 }, risk: "Basso", focus: "Equilibrio tra i reparti", type: "Titolari affidabili, almeno un giocatore importante per reparto", strengths: ["Copertura di tutti i ruoli", "Rischio distribuito", "Panchina profonda"], weak: ["Difficile avere il singolo fuoriclasse che decide le giornate"] },
  };
  const RW = { ...STRATS.fa.rw }; let EXP = 2.2, SHARE = null, PRIO = {};
  function applyStrategy(S) {
    const key = S.strategy?.key || "fa", st = STRATS[key] || STRATS.fa;
    Object.assign(RW, st.rw); EXP = st.exp;
    if (S.config?.modDif) RW.DIF *= 1.15;
    SHARE = key === "cust" ? (S.strategy?.share || STRATS.cust.share) : st.share;
    PRIO = {}; (S.strategy?.priorities || []).forEach((p) => (PRIO[p.id] = p));
  }
  const quality = (p) => { const ia = p.fa?.ia || 40, fv = p.fa?.fv ?? 0.7; return (RW[p.role] || 1) * Math.pow(Math.max(0, ia - 35) / 10, EXP) * (0.85 + 0.15 * fv); };
  const isReserveGK = (p) => p.role === "POR" && /^r$/i.test((p.fa?.fascia || "").trim());
  const tierOf = (p, cost, budget) => {
    if (isReserveGK(p)) return "RISERVA";
    const f = (p.fa?.fascia || "").toLowerCase();
    if (f.includes("semi")) return "SEMITOP"; if (f.includes("top")) return "TOP";
    const rel = cost / budget; return rel >= 0.14 ? "TOP" : rel >= 0.07 ? "SEMITOP" : rel >= 0.025 ? "TITOLARE" : "LOW COST";
  };

  // ---------- mercato ----------
  function market(S) {
    const N = S.participants || 8, m = {}, soldAll = S.roster.concat(S.sold);
    ROLES.forEach((r) => {
      const soldR = soldAll.filter((x) => FA.get(x.id)?.role === r).length, demand = Math.max(0, N * S.limits[r] - soldR);
      const avail = FA.players().filter((p) => p.role === r && p.fa && !S.roster.some((x) => x.id === p.id) && !S.sold.some((x) => x.id === p.id));
      const qs = avail.map(quality).sort((a, b) => b - a), usable = avail.filter((p) => (p.fa.ia || 0) >= 60).length;
      const tightness = demand ? Math.min(2.5, Math.max(0.3, demand / Math.max(1, usable))) : 0.3;
      const pool = qs.slice(0, Math.max(1, demand)), qpool = pool.length ? pool.reduce((a, b) => a + b, 0) / pool.length : 0;
      m[r] = { demand, avail: avail.length, soldR, usable, tightness, qpool, N };
    });
    return m;
  }

  // ---------- ottimizzatore ----------
  function optimize(S, infl, isAvail, prevIds = null) {
    const R = S.budget - S.roster.reduce((a, x) => a + x.price, 0);
    const need = {}; ROLES.forEach((r) => (need[r] = Math.max(0, S.limits[r] - S.roster.filter((x) => FA.get(x.id)?.role === r).length)));
    const total = ROLES.reduce((a, r) => a + need[r], 0), mk = market(S), N = S.participants || 8;
    if (!total) return { slots: [], byRole: {}, total: 0, budget: R, spare: R, quality: 0, market: mk, need };
    const cand = {};
    ROLES.forEach((r) => {
      const base = FA.players().filter((p) => p.role === r && p.fa && isAvail(p.id)).map((p) => { const pr = PRIO[p.id]; const bonus = pr ? (pr.level === "must" ? 5 : pr.level === "high" ? 1.35 : 1.12) : 1; return { p, q: quality(p) * bonus * (prevIds && prevIds.has(p.id) ? 1.03 : 1), v: isReserveGK(p) ? 1 : Math.max(1, FA.adjValue(p, S.budget, infl) || 1) }; }).sort((a, b) => b.q - a.q);
      const D = Math.max(1, mk[r].demand);
      base.forEach((c, rank) => { const f = Math.min(1, rank / D); c.cost = isReserveGK(c.p) ? 1 : Math.max(1, Math.round(c.v * (1 + 0.18 * (N / 8) * Math.pow(1 - f, 2) * mk[r].tightness))); });
      cand[r] = base.sort((a, b) => a.cost - b.cost || b.q - a.q);
    });
    const chosen = {}, used = new Set(); let spent = 0;
    const roleSpentOwn = (r) => S.roster.filter((x) => FA.get(x.id)?.role === r).reduce((a, x) => a + x.price, 0);
    ROLES.forEach((r) => { chosen[r] = []; cand[r].filter((c) => PRIO[c.p.id]?.level === "must").forEach((c) => { if (chosen[r].length < need[r] && spent + c.cost <= R - (total - chosen[r].length - 1)) { chosen[r].push(c); used.add(c.p.id); spent += c.cost; } }); });
    ROLES.forEach((r) => { const pool = cand[r].slice().sort((a, b) => a.cost - b.cost || b.q - a.q); while (chosen[r].length < need[r]) { const c = pool.find((x) => !used.has(x.p.id)); if (!c) break; used.add(c.p.id); chosen[r].push(c); spent += c.cost; } });
    for (let iter = 0; iter < 500; iter++) {
      let best = null;
      ROLES.forEach((r) => chosen[r].forEach((cur, si) => {
        if (PRIO[cur.p.id]?.level === "must") return;
        for (const c of cand[r]) {
          if (used.has(c.p.id) || c.q <= cur.q || c.cost <= cur.cost) continue;
          const dc = c.cost - cur.cost; if (spent + dc > R) continue;
          if (SHARE && SHARE[r]) { const rs = chosen[r].reduce((a, x) => a + x.cost, 0) + roleSpentOwn(r); if (rs + dc > (SHARE[r] / 100) * S.budget * 1.1) continue; }
          const ratio = (c.q - cur.q) / dc; if (!best || ratio > best.ratio) best = { r, si, c, ratio, dc };
        }
      }));
      if (!best) break;
      used.delete(chosen[best.r][best.si].p.id); used.add(best.c.p.id); chosen[best.r][best.si] = best.c; spent += best.dc;
    }
    // blocco portieri: riserve della squadra del titolare quando disponibili
    if (chosen.POR.length > 1) {
      const own = S.roster.map((x) => FA.get(x.id)).filter((p) => p && p.role === "POR" && !isReserveGK(p));
      const main = own[0] || chosen.POR.slice().sort((a, b) => b.cost - a.cost)[0]?.p;
      if (main) { const mates = cand.POR.filter((c) => c.p.team === main.team && c.p.id !== main.id && !used.has(c.p.id)).sort((a, b) => a.cost - b.cost);
        chosen.POR.forEach((cur, i) => { if (cur.p.id !== main.id && cur.p.team !== main.team && mates.length && cur.cost <= 3) { const m = mates.shift(); used.delete(cur.p.id); used.add(m.p.id); spent += m.cost - cur.cost; chosen.POR[i] = m; } }); }
    }
    const slots = [], byRole = {};
    ROLES.forEach((r) => {
      const list = chosen[r].slice().sort((a, b) => b.cost - a.cost);
      byRole[r] = { budget: list.reduce((a, x) => a + x.cost, 0), n: list.length };
      list.forEach((c, i) => {
        const peers = cand[r].filter((x) => x.q >= 0.8 * c.q), mySlotsAtLevel = list.filter((x) => x.q >= 0.8 * c.q).length;
        const coverage = peers.length / Math.max(1, (N - 1) * mySlotsAtLevel + 1);
        const urgency = c.cost < S.budget * 0.04 ? "bassa" : coverage < 1 ? "alta" : coverage < 1.6 ? "media" : "bassa";
        const same = cand[r].filter((x) => !used.has(x.p.id) && x.cost <= c.cost * 1.15 && x.cost >= c.cost * 0.7).sort((a, b) => b.q - a.q).slice(0, 2);
        const cheaper = cand[r].filter((x) => !used.has(x.p.id) && x.cost < c.cost * 0.7 && x.cost >= c.cost * 0.35).sort((a, b) => b.q - a.q).slice(0, 2);
        const target = c.cost, limit = Math.max(target, Math.min(Math.round(target * (urgency === "alta" ? 1.22 : 1.15)), R - (total - 1)));
        const tier = tierOf(c.p, target, S.budget);
        const why = PRIO[c.p.id] ? "Tuo giocatore prioritario." : tier === "RISERVA" ? `Riserva del blocco ${c.p.team}: completa il reparto a 1 FM.` : urgency === "alta" ? "Pochi disponibili di questo livello rispetto alla concorrenza: da prendere presto." : tier === "TOP" || tier === "SEMITOP" ? `Miglior qualità per FM tra i ${RL[r].toLowerCase()} di fascia alta ancora disponibili.` : "Buon rapporto qualità/prezzo: copre lo slot senza pesare sul budget.";
        slots.push({ id: `${SLOTP[r]}${i + 1}`, role: r, p: c.p, target, value: c.v, ideal: Math.max(1, Math.round(target * 0.9)), fair: Math.round(target * 1.05), limit, tier, q: c.q, alts: same.map((a) => a.p), cheaper: cheaper.map((a) => a.p), coverage, urgency, peers: peers.length, prio: PRIO[c.p.id]?.level || null, why });
      });
    });
    const qAll = slots.reduce((a, s) => a + s.q, 0) + S.roster.reduce((a, x) => a + quality(FA.get(x.id) || {}), 0), nAll = slots.length + S.roster.length;
    return { slots, byRole, total, budget: R, spare: R - spent, quality: nAll ? qAll / nAll : 0, need, market: mk };
  }
  const queue = (plan) => plan.slots.slice().sort((a, b) => (b.prio === "must" ? 1e6 : 0) + b.target * (b.urgency === "alta" ? 1.5 : b.urgency === "media" ? 1.15 : 1) - ((a.prio === "must" ? 1e6 : 0) + a.target * (a.urgency === "alta" ? 1.5 : a.urgency === "media" ? 1.15 : 1)));
  function compute() { const S = SOLO.get(); applyStrategy(S); const prev = lastPlan ? new Set(lastPlan.slots.map((s) => s.p.id)) : null; lastPlan = optimize(S, SOLO.infl(), SOLO.isAvail, prev); return lastPlan; }
  const planFor = (S, key, share, prios) => { const S2 = { ...S, strategy: { key, share, priorities: prios || [] } }; applyStrategy(S2); const P = optimize(S2, SOLO.infl(), SOLO.isAvail); applyStrategy(S); return P; };

  // ---------- coerenza ----------
  function coherence(S, plan) {
    let pen = 0; const notes = [];
    (S.history || []).forEach((h) => { if (h.type === "roster" && h.fit != null) { pen += (1 - h.fit / 100) * 12; if ((h.price || 0) > (h.limit || 0)) pen += ((h.price - h.limit) / S.budget) * 150; } });
    const p0 = S.strategy?.plan0 || {};
    ROLES.forEach((r) => { const spent = S.roster.filter((x) => FA.get(x.id)?.role === r).reduce((a, x) => a + x.price, 0); const upd = spent + (plan.byRole[r]?.budget || 0); const pl = p0[r] ?? upd; if (pl && upd > pl * 1.15) { pen += Math.min(10, ((upd - pl) / pl) * 40); notes.push(`Stai spendendo più del previsto in ${RN[r].toLowerCase()} (+${upd - pl} FM).`); } });
    if (plan.spare < 0 || plan.slots.length < plan.total) { pen += 30; notes.push("La strategia iniziale non è più realizzabile: è stata predisposta una nuova configurazione sostenibile."); }
    const score = Math.max(0, Math.min(100, Math.round(100 - pen)));
    const cls = score >= 85 ? ["Strategia pienamente coerente", "ok"] : score >= 70 ? ["Strategia coerente", "ok"] : score >= 50 ? ["Strategia da riequilibrare", "warn"] : score >= 30 ? ["Strategia a rischio", "bad"] : ["Strategia compromessa", "bad"];
    if (!notes.length) notes.push(score >= 85 ? "La tua asta è pienamente coerente con la strategia scelta." : "Hai acquistato giocatori validi, ma alcuni acquisti si sono discostati dal piano.");
    return { score, cls, notes };
  }

  // ---------- tattica ----------
  function evaluate(p, plan, price) {
    const S = SOLO.get(), infl = SOLO.infl(), st = SOLO.statusOf(p.id);
    if (st) return { status: st }; if ((S.excluded || []).includes(p.id)) return { status: "escluso" }; if (!p.fa) return { nodata: true };
    const need = plan.need[p.role], spendable = plan.budget - (plan.total - 1);
    if (!need) return { fit: 0, cls: "no", label: "Non acquistare", why: `Hai già ${S.limits[p.role]} ${RL[p.role].toLowerCase()}: non ti serve.`, limit: 0, ideal: 0, fair: 0, spendable, value: FA.adjValue(p, S.budget, infl), conf: "Alta", reasons: [] };
    const slot = plan.slots.find((s) => s.p.id === p.id), value = isReserveGK(p) ? 1 : Math.max(1, FA.adjValue(p, S.budget, infl) || 1), q0 = plan.quality;
    const sim = (pr) => { const P2 = optimize({ ...S, roster: S.roster.concat([{ id: p.id, price: pr }]) }, infl, (id) => id !== p.id && SOLO.isAvail(id), new Set(plan.slots.map((s) => s.p.id))); return P2.total === plan.total - 1 && P2.spare >= 0 && P2.slots.length === P2.total ? P2 : null; };
    let fit, limit, displaced = null;
    if (slot) { fit = 100; limit = Math.min(slot.limit, spendable); }
    else {
      const P2 = sim(value); const drop = P2 ? 1 - P2.quality / Math.max(1e-6, q0) : 1; fit = Math.max(0, Math.min(100, Math.round(100 * (1 - drop / 0.08))));
      limit = 0; for (const m of [1.5, 1.35, 1.2, 1.1, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5]) { const pr = Math.max(1, Math.round(value * m)); if (pr <= spendable) { const P3 = sim(pr); if (P3 && P3.quality >= q0 * 0.985) { limit = pr; break; } } }
      displaced = plan.slots.filter((s) => s.role === p.role).sort((a, b) => Math.abs(a.target - value) - Math.abs(b.target - value))[0] || null;
    }
    const base = slot ? slot.target : value, ideal = Math.max(1, Math.round(base * 0.9)), fair = Math.round(base * 1.05);
    limit = Math.min(limit, spendable);
    const pr = price || 0, disc = pr ? Math.max(0, (value - pr) / value) : 0;
    const occasion = !!(pr && disc >= 0.22 && fit >= 55 && pr <= spendable); if (occasion) limit = Math.min(spendable, Math.max(limit, Math.round(value * 0.85)));
    const opportunity = pr ? Math.round(Math.min(100, 100 * (0.65 * Math.min(1, disc / 0.35) + 0.35 * fit / 100))) : null;
    const top = queue(plan).find((s) => s.p.id !== p.id);
    let cls, label, why;
    if (!limit) { cls = "no"; label = "Non acquistare"; why = `A qualunque prezzo ragionevole peggiora la rosa costruibile: esistono alternative compatibili (${displaced ? displaced.p.name : "gli obiettivi del piano"}) a un prezzo inferiore.`; }
    else if (pr && pr > limit) { cls = "no"; label = slot ? "Non acquistare oltre il limite" : "Non coerente a questo prezzo"; why = slot ? `È nel tuo piano, ma sopra ${limit} FM riduce il budget necessario per gli altri obiettivi: lascialo agli altri.` : `Sopra ${limit} FM costringerebbe a rivedere il budget del reparto e a sacrificare ${displaced ? displaced.p.name : "un obiettivo"}.`; }
    else if (pr && occasion) { cls = "strong"; label = "Acquisto fortemente consigliato"; why = `Non era ${slot ? "il tuo primo obiettivo" : "nella rosa ideale"}, ma a ${pr} FM (−${Math.round(disc * 100)}% sul valore) è un'opportunità: migliora la rosa senza compromettere gli altri obiettivi.`; }
    else if (pr && slot && pr <= ideal) { cls = "strong"; label = "Acquisto fortemente consigliato"; why = `Compralo: è il tuo ${slot.id} e a questo prezzo migliora la rosa senza toccare gli altri obiettivi.`; }
    else if (pr && pr <= fair && fit >= 70) { cls = "yes"; label = "Acquisto consigliato"; why = slot ? `Prezzo nella fascia prevista per il tuo ${slot.id}.` : `Coerente con la strategia: al posto di ${displaced?.p.name || "uno slot"} senza perdere qualità.`; }
    else if (pr && fit >= 70) { cls = "cap"; label = `Acquisto possibile fino a ${limit}`; why = `È coerente con la strategia, ma il prezzo attuale riduce il budget per ${top ? top.p.name : "il tuo obiettivo principale"}: non superare ${limit} FM.`; }
    else if (pr && fit >= 40) { cls = "risk"; label = "Acquisto rischioso"; why = `Possibile fino a ${limit} FM, ma richiederà una revisione del budget di ${RN[p.role].toLowerCase()} e sacrifica ${displaced?.p.name || "un obiettivo"}.`; }
    else if (pr) { cls = "no"; label = "Acquisto non coerente"; why = `Forte ma sbagliato per la tua asta: coerenza ${fit}/100 con strategia e budget.`; }
    else { cls = slot ? "yes" : fit >= 70 ? "cap" : fit >= 40 ? "risk" : "no"; label = slot ? `Nel piano: compra fino a ${limit}` : fit >= 70 ? `Possibile fino a ${limit}` : fit >= 40 ? `Rischioso, max ${limit}` : "Non coerente"; why = slot ? slot.why : displaced ? `Prenderebbe il posto di ${displaced.p.name} (${displaced.id}).` : "Non è nella rosa ideale."; }
    const nRole = S.sold.concat(S.roster).filter((x) => FA.get(x.id)?.role === p.role).length, peers = slot?.peers ?? (displaced?.peers ?? 3);
    const conf = nRole >= 5 && peers >= 3 ? "Alta" : nRole >= 2 || peers >= 2 ? "Media" : "Bassa";
    const impact = pr ? (() => { const P2 = sim(pr); if (!P2) return { ok: false }; const lost = queue(plan).filter((s) => s.p.id !== p.id).slice(0, 3).map((s) => ({ name: s.p.name, ok: P2.slots.some((x) => x.p.id === s.p.id), limit: P2.slots.find((x) => x.p.id === s.p.id)?.limit })); return { ok: true, roleBudget: P2.byRole[p.role]?.budget ?? 0, residuo: plan.budget - pr, lost, coh: coherence({ ...S, history: S.history.concat([{ type: "roster", fit, price: pr, limit }]) }, P2).score }; })() : null;
    let gk = null; if (p.role === "POR") { const mates = FA.players().filter((x) => x.role === "POR" && x.team === p.team && x.id !== p.id && x.fa); gk = { reserve: isReserveGK(p), mates: mates.map((m) => ({ p: m, avail: SOLO.isAvail(m.id), reserve: isReserveGK(m) })), blockCost: (isReserveGK(p) ? 1 : base) + mates.filter((m) => SOLO.isAvail(m.id)).length }; }
    return { fit, cls, label, why, limit, ideal, fair, spendable, value, slot, displaced, occasion, opportunity, conf, impact, gk, reasons: [`Hai ancora ${plan.total} slot: devi tenere almeno ${plan.total - 1} FM per gli altri.`, top ? `Il tuo obiettivo principale (${top.p.name}) richiede circa ${top.target} FM.` : "Nessun altro obiettivo prioritario da proteggere.", `${peers} alternative di livello simile ancora disponibili nel ruolo.`, fit >= 90 ? "È centrale per la tua strategia." : "Non è indispensabile per la strategia."] };
  }

  // ---------- azioni ----------
  function commit(kind, id, price, who) {
    const S = SOLO.get(), before = lastPlan, p = FA.get(id);
    const ev = kind === "roster" && before ? evaluate(p, before, price) : null;
    if (kind === "roster") { S.roster.push({ id, price, t: Date.now() }); S.history.push({ type: "roster", id, price, fit: ev?.fit ?? 100, limit: ev?.limit ?? price }); if (window.fireworks) window.fireworks(1600); }
    else if (kind === "sold") { S.sold.push({ id, price: price || 0, who: who || "", t: Date.now() }); S.history.push({ type: "sold", id }); }
    else { S.excluded.push(id); S.history.push({ type: "excluded", id }); }
    SOLO.save(); called = { q: "", id: null, price: "", who: "" }; ui.why = false;
    const plan = compute(), changes = diffRoles(before, plan), slot = before?.slots.find((s) => s.p.id === id);
    if (kind === "roster") { const over = ev?.limit ? price - ev.limit : 0, tgt = slot?.target; banner = { kind, title: `Preso ${p.name} — ${price} FM`, lines: [tgt != null ? (price > tgt ? `Hai speso ${price - tgt} FM più del previsto (target ${tgt}).` : price < tgt ? `Hai risparmiato ${tgt - price} FM rispetto al target (${tgt}).` : "Prezzo in linea con il target.") : "Non era nella rosa ideale: la strategia è stata adattata.", over > 0 ? `Attenzione: ${over} FM oltre il limite consigliato (${ev.limit}).` : coherence(S, plan).score >= 70 ? "La strategia resta sostenibile." : "La strategia va riequilibrata: vedi il pannello."], changes }; }
    else if (kind === "sold") banner = { kind, title: `${p.name} preso da ${who || "un avversario"}${price ? ` a ${price} FM` : ""}`, lines: [slot ? `Era il tuo ${slot.id}: individuata la migliore alternativa.` : "Fuori dal mercato: stime aggiornate."], changes };
    else banner = { kind, title: `${p.name} escluso dai suggerimenti`, lines: [], changes };
    SOLO.render();
  }
  function diffRoles(oldP, newP) { if (!oldP || !newP) return []; return ROLES.filter((r) => (oldP.byRole[r]?.budget || 0) !== (newP.byRole[r]?.budget || 0)).map((r) => ({ r, from: oldP.byRole[r]?.budget || 0, to: newP.byRole[r]?.budget || 0 })); }
  function undo() { const before = lastPlan; const h = SOLO.undo(); if (!h) return; const plan = compute(); banner = { kind: "undo", title: `Annullato: ${FA.get(h.id)?.name}`, lines: [h.type === "roster" ? "rimosso dalla rosa, budget ripristinato" : h.type === "sold" ? "di nuovo disponibile" : "di nuovo tra i suggerimenti"], changes: diffRoles(before, plan) }; SOLO.render(); }

  // ---------- avvisi, rischio, fattibilità ----------
  function warnings(S, plan, coh) {
    const out = [], p0 = S.strategy?.plan0 || {}, spentTot = S.budget - plan.budget, N = S.participants || 8;
    ROLES.forEach((r) => { const spent = S.roster.filter((x) => FA.get(x.id)?.role === r).reduce((a, x) => a + x.price, 0); const pl = p0[r]; if (pl && plan.need[r] === 0 && spent > pl * 1.15) out.push([3, `Hai superato del ${Math.round((spent / pl - 1) * 100)}% il budget previsto per ${RN[r].toLowerCase()}.`]); });
    const starters = plan.slots.filter((s) => s.tier !== "LOW COST" && s.tier !== "RISERVA").length; if (spentTot / S.budget > 0.7 && starters >= 3) out.push([3, `Ti mancano ancora ${starters} titolari e hai utilizzato il ${Math.round(spentTot / S.budget * 100)}% del budget.`]);
    ROLES.forEach((r) => { const top = plan.slots.filter((s) => s.role === r && (s.tier === "TOP" || s.tier === "SEMITOP")); if (top.length && top[0].peers <= 2) out.push([3, `Sono rimasti soltanto ${top[0].peers} ${RL[r].toLowerCase()} compatibili con la tua strategia.`]); });
    const q = queue(plan)[0], st0 = S.strategy?.limit0?.[q?.p.id]; if (q && st0 && q.limit < st0 - 3) out.push([2, `${q.p.name} è ancora acquistabile, ma il prezzo massimo sostenibile è sceso da ${st0} a ${q.limit}.`]);
    ROLES.forEach((r) => { const m = plan.market[r]; if (plan.need[r] > 0 && m.demand <= (N - 1) * 0.5 * S.limits[r]) out.push([1, `La maggior parte degli avversari ha già completato ${RN[r].toLowerCase()}: la concorrenza dovrebbe diminuire.`]); });
    const all = S.roster.map((x) => FA.get(x.id)).filter(Boolean).concat(plan.slots.map((s) => s.p)), byTeam = {}; all.filter((p) => p.role !== "POR").forEach((p) => (byTeam[p.team] = (byTeam[p.team] || 0) + 1)); Object.entries(byTeam).forEach(([t, n]) => { if (n >= 4) out.push([1, `Hai molti giocatori della stessa squadra (${t}: ${n}).`]); });
    const lowFv = S.roster.map((x) => FA.get(x.id)).filter((p) => p && (p.fa?.fv ?? 1) < 0.6).length; if (lowFv >= 3) out.push([2, "La rosa è troppo dipendente da giocatori soggetti a ballottaggio."]);
    if (coh.score >= 70 && S.roster.map((x) => FA.get(x.id)).filter((p) => p && /scomm|jolly/i.test(p.fa?.fascia || "")).length >= 3) out.push([1, "Stai rispettando la distribuzione del budget, ma la rosa ha un rischio superiore al previsto (molte scommesse)."]);
    return out.sort((a, b) => b[0] - a[0]).slice(0, 3).map((x) => x[1]);
  }
  const riskLevel = (S, plan) => { const lowFv = S.roster.concat(plan.slots.map((s) => ({ id: s.p.id }))).map((x) => FA.get(x.id)).filter((p) => p && (p.fa?.fv ?? 1) < 0.6).length, big = S.roster.filter((x) => x.price > S.budget * 0.3).length, n = (lowFv >= 4 ? 1 : 0) + (big ? 1 : 0) + (S.strategy?.key === "agg" ? 1 : 0); return n >= 2 ? "Alto" : n === 1 ? "Medio" : "Basso"; };
  function feasibility(S, key, share, prios) {
    const P = planFor(S, key, share, prios), must = (prios || []).filter((x) => x.level === "must"), missing = must.filter((m) => !P.slots.some((s) => s.p.id === m.id) && !S.roster.some((x) => x.id === m.id));
    const roleOver = ROLES.filter((r) => share && (P.byRole[r]?.budget || 0) > (share[r] / 100) * S.budget * 1.1);
    let level, msg;
    if (P.slots.length < P.total || P.spare < 0) { level = ["Strategia incompatibile con il budget", "bad"]; msg = "Con questa ripartizione la rosa non si completa."; }
    else if (missing.length) { const m = FA.get(missing[0].id), r = m.role, needShare = Math.ceil(((P.byRole[r]?.budget || 0) + (FA.adjValue(m, S.budget, SOLO.infl()) || 0)) / S.budget * 100); level = ["Strategia difficilmente realizzabile", "bad"]; msg = `Con il budget assegnato a ${RN[r].toLowerCase()} non è possibile inserire ${m.name}. Porta il reparto dal ${share ? share[r] : "—"}% al ${needShare}% oppure trasformalo in alternativa.`; }
    else if (P.spare > S.budget * 0.15) { level = ["Strategia sostenibile", "ok"]; msg = `Restano ${P.spare} FM non allocati: puoi alzare il livello in un reparto.`; }
    else if (roleOver.length || P.slots.filter((s) => s.tier === "LOW COST" || s.tier === "RISERVA").length > P.total * 0.6) { level = ["Strategia sostenibile ma rischiosa", "warn"]; msg = roleOver.length ? `Il budget di ${roleOver.map((r) => RN[r].toLowerCase()).join(", ")} è al limite.` : "Molti slot coperti da low cost: panchina fragile."; }
    else { level = ["Strategia sostenibile", "ok"]; msg = "Rosa completa entro il budget con la ripartizione scelta."; }
    return { P, level, msg, missing };
  }

  // ---------- UI helpers ----------
  const tierClass = (t) => ({ TOP: "top", SEMITOP: "semi", TITOLARE: "mid", "LOW COST": "low", RISERVA: "low" }[t] || "");
  const bar = (pct, cls = "") => `<div class="gbar ${cls}"><div style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
  const tip = (t) => `<span class="gtip" title="${t}">?</span>`;
  const details = (id, title, body, open = false, extra = "") => `<details class="gdet" id="${id}" ${open ? "open" : ""}><summary><span>${title}</span>${extra}</summary><div class="gdet-b">${body}</div></details>`;

  // ---------- UI: strategia ----------
  function strategyView(S) {
    const cur = S.draft || { key: "fa", share: { ...STRATS.cust.share }, priorities: [] };
    const cards = Object.entries(STRATS).map(([key, st]) => {
      const share = key === "cust" ? cur.share : null, P = planFor(S, key, share, key === "cust" ? cur.priorities : []), tot = Math.max(1, ROLES.reduce((a, r) => a + (P.byRole[r]?.budget || 0), 0));
      const dist = ROLES.map((r) => { const b = P.byRole[r]?.budget || 0, pct = Math.round(100 * b / tot), tops = P.slots.filter((s) => s.role === r && (s.tier === "TOP" || s.tier === "SEMITOP")).length; return `<div class="gdist"><span class="gdist-l">${RN[r]}</span>${bar(pct)}<span class="gdist-v"><b>${pct}%</b> · ${b} FM${tops ? ` · ${tops} di fascia alta` : ""}</span></div>`; }).join("");
      const on = key === cur.key;
      return `<div class="gcard ${on ? "on" : ""}" data-strat="${key}">
        <div class="gcard-h"><div><b>${st.name}</b>${st.badge ? `<span class="gbadge">${st.badge}</span>` : ""}</div><span class="grisk r-${st.risk}">Rischio ${st.risk}</span></div>
        <p class="gdesc">${st.desc}</p>
        <div class="grow"><span>Reparto centrale</span><b>${st.focus}</b></div><div class="grow"><span>Tipo di rosa</span><b>${st.type}</b></div>
        ${dist}
        <div class="gpm"><span class="ok">Punti di forza</span><ul>${st.strengths.map((x) => `<li>${x}</li>`).join("")}</ul><span class="warn">Criticità</span><ul>${st.weak.map((x) => `<li>${x}</li>`).join("")}</ul></div>
        ${on && key === "cust" ? customEditor(S, cur) : ""}
        ${on ? `<div class="gsel">✓ Selezionata</div>` : `<button class="secondary" data-pick="${key}">Seleziona</button>`}
      </div>`;
    }).join("");
    const share = cur.key === "cust" ? cur.share : null, prios = cur.key === "cust" ? cur.priorities : [];
    const P = planFor(S, cur.key, share, prios), fe = feasibility(S, cur.key, share, prios), st = STRATS[cur.key], tot = Math.max(1, ROLES.reduce((a, r) => a + (P.byRole[r]?.budget || 0), 0));
    const summary = `<div class="card gsum"><div class="gb-h">Riepilogo prima di generare</div>
      <div class="grow"><span>Strategia</span><b>${st.name}</b></div>
      <div class="grow"><span>Distribuzione</span><b>${ROLES.map((r) => `${RS[r]} ${Math.round(100 * (P.byRole[r]?.budget || 0) / tot)}% (${P.byRole[r]?.budget || 0})`).join(" · ")}</b></div>
      <div class="grow"><span>Rischio</span><b>${st.risk}</b></div>
      ${prios.length ? `<div class="grow"><span>Giocatori prioritari</span><b>${prios.map((x) => FA.get(x.id)?.name).join(", ")}</b></div>` : ""}
      <div class="grow"><span>Rosa prevista</span><b>${P.slots.filter((s) => s.tier === "TOP").length} top · ${P.slots.filter((s) => s.tier === "SEMITOP").length} semitop · ${P.slots.filter((s) => s.tier === "TITOLARE").length} titolari · ${P.slots.filter((s) => s.tier === "LOW COST" || s.tier === "RISERVA").length} low cost/riserve</b></div>
      <div class="gfeas ${fe.level[1]}"><b>${fe.level[0]}</b><div>${fe.msg}</div></div>
      <button class="green" id="g-generate">Genera la mia rosa ideale</button></div>`;
    return `<div class="kicker">Prima dell'asta</div><h2 style="margin:6px 0 4px">Scegli la tua strategia d'asta</h2><p class="muted" style="font-size:13px;margin:0 0 12px">Anteprime calcolate su ${S.budget} FM, ${S.participants} squadre, ${ROLES.map((r) => S.limits[r]).join("-")}${S.config?.modDif ? ", modificatore difesa" : ""}. Confronta le card e seleziona.</p>${cards}${summary}`;
  }
  function customEditor(S, cur) {
    const sliders = ROLES.map((r) => { const pct = cur.share[r], cred = Math.round(S.budget * pct / 100), avg = S.limits[r] ? Math.round(cred / S.limits[r]) : 0, fascia = avg >= S.budget * 0.14 ? "top" : avg >= S.budget * 0.07 ? "semitop" : avg >= S.budget * 0.025 ? "titolari" : "low cost"; return `<div class="gslider"><div class="gslider-h"><b>${RN[r]} · ${pct}% · ${cred} FM</b><span>${S.limits[r]} giocatori · circa ${avg} FM a slot · fascia media: ${fascia}</span></div><input type="range" min="0" max="80" value="${pct}" data-share="${r}"></div>`; }).join("");
    const rows = (cur.priorities || []).map((x, i) => { const p = FA.get(x.id); return `<div class="gprio-row"><span class="rl ${p.role}">${RS[p.role]}</span><b>${p.name}</b><small>${p.team}</small><select data-plev="${i}"><option value="must" ${x.level === "must" ? "selected" : ""}>Indispensabile</option><option value="high" ${x.level === "high" ? "selected" : ""}>Alta priorità</option><option value="opp" ${x.level === "opp" ? "selected" : ""}>Opportunità</option></select><input type="number" data-pmax="${i}" placeholder="max FM" value="${x.max || ""}"><a href="#" data-pdel="${i}">✕</a></div>`; }).join("");
    const res = ui.prioQ.length >= 2 ? SOLO.search(ui.prioQ, "ALL").filter((p) => p.fa && !(cur.priorities || []).some((x) => x.id === p.id)).slice(0, 5) : [];
    const conflicts = ROLES.map((r) => { const ps = (cur.priorities || []).map((x) => FA.get(x.id)).filter((p) => p.role === r); if (ps.length < 2) return null; const est = ps.reduce((a, p) => a + (FA.adjValue(p, S.budget, SOLO.infl()) || 0), 0), b = Math.round(S.budget * cur.share[r] / 100); return est > b ? `I ${ps.length} ${RL[r].toLowerCase()} selezionati richiederebbero circa ${est} FM, oltre i ${b} FM assegnati al reparto. Aumenta il budget di ${RN[r].toLowerCase()} oppure trasforma uno degli obiettivi in alternativa.` : null; }).filter(Boolean);
    return `<div class="gcust">
      <div class="gb-h">Su quali giocatori vuoi puntare?</div><p class="muted" style="font-size:12px;margin:2px 0 6px">Fino a 5 giocatori: la rosa ideale e la distribuzione del budget si adattano alle tue preferenze.</p>
      ${rows}
      ${(cur.priorities || []).length < 5 ? `<input id="g-prio-q" placeholder="Cerca un giocatore…" autocomplete="off" value="${ui.prioQ}">${res.map((p) => `<div class="lrow" data-padd="${p.id}" style="cursor:pointer"><span class="rl ${p.role}">${RS[p.role]}</span><span class="nm">${p.name}<small>${p.team}</small></span><span class="cost">${FA.value(p, S.budget)}</span></div>`).join("")}` : ""}
      ${conflicts.map((c) => `<div class="gfeas warn" style="margin-top:8px"><b>Priorità poco compatibili</b><div>${c}</div></div>`).join("")}
      <div class="gb-h" style="margin-top:12px">Budget per reparto <small class="muted">(somma sempre 100%)</small></div>${sliders}
    </div>`;
  }

  // ---------- UI: asta ----------
  function calledView(plan, S) {
    const p = called.id ? FA.get(called.id) : null;
    if (!p) { const rows = called.q.length >= 2 ? SOLO.search(called.q, "ALL").slice(0, 6) : []; return `<div class="card garea"><div class="gb-h">1 · Giocatore chiamato</div><input id="gc-q" placeholder="Scrivi il nome del giocatore all'asta…" autocomplete="off" value="${called.q}">${rows.map((x) => { const inPlan = plan.slots.find((s) => s.p.id === x.id), st = SOLO.statusOf(x.id); return `<div class="lrow" data-gc="${x.id}" style="cursor:pointer"><span class="rl ${x.role}">${RS[x.role]}</span><span class="nm">${x.name}<small>${x.team}${inPlan ? ` · nel piano (${inPlan.id})` : ""}${st ? " · " + st : ""}</small></span><span class="cost">${FA.value(x, S.budget) ?? "—"}</span></div>`; }).join("")}</div>`; }
    const pr = parseInt(called.price, 10) || 0, ev = evaluate(p, plan, pr), tc = window.TEAM_COLORS?.[p.team] || ["#34d17f", "#0b2418", "#fff"];
    const head = `<div class="card garea"><div class="gb-h">1 · Giocatore chiamato <a href="#" id="gc-clear" style="float:right;color:var(--muted);font-weight:600">cambia</a></div>
      <div class="gplayer" style="--t1:${tc[0]};--t2:${tc[1]}"><div class="gp-name">${p.name}</div><div class="gp-meta"><span class="team" style="background:${tc[0]};color:${tc[2]}">${p.team}</span> <span class="role ${p.role}">${RL[p.role]}</span>${p.fa?.fascia ? ` <span class="fatag fascia ${FA.fasciaClass(p.fa.fascia)}">${p.fa.fascia}</span>` : ""}</div></div>`;
    if (ev.status) return head + `<div class="notice">${ev.status === "mio" ? "È già nella tua rosa." : ev.status === "venduto" ? "Già preso da un avversario in questa asta." : "Lo avevi escluso."}</div></div>`;
    if (ev.nodata) return head + `<div class="notice">Nessuna valutazione Fantalgoritmo per questo giocatore.</div>${actions(S)}</div>`;
    const cohCls = ev.fit >= 70 ? "ok" : ev.fit >= 40 ? "warn" : "bad";
    const idealC = Math.min(ev.ideal, ev.limit), accHi = Math.min(Math.max(ev.fair, idealC), ev.limit), accTxt = accHi > idealC ? `${idealC + 1}–${accHi}` : "—";
    return head + `</div><div class="card garea" id="g-eval"><div class="gb-h">2 · Valutazione in tempo reale</div>
      <div class="grow"><span>Coerenza con la strategia ${tip("Quanto l'acquisto al prezzo atteso mantiene la qualità della miglior rosa costruibile")}</span><b class="${cohCls}">${ev.fit}/100</b></div>${bar(ev.fit, cohCls)}
      <div class="grow"><span>Ruolo nella rosa ideale</span><b>${ev.slot ? `${ev.slot.id} · ${ev.slot.tier.toLowerCase()} · priorità ${queue(plan).indexOf(ev.slot) + 1}` : ev.displaced ? `non previsto (prenderebbe il posto di ${ev.displaced.p.name})` : "non previsto"}</b></div>
      <div class="grow"><span>Valore Fantalgoritmo</span><b>${ev.value} FM</b></div>
      <div class="gthr"><div class="ok"><span>Prezzo ideale</span><b>${idealC ? `fino a ${idealC}` : "—"}</b></div><div class="warn"><span>Accettabile</span><b>${accTxt}</b></div><div class="bad"><span>Limite massimo</span><b>${ev.limit}</b></div></div>
      <div class="grow"><span>Spendibile ora ${tip("Residuo meno 1 FM per ogni altro slot da completare")}</span><b>${ev.spendable} FM</b></div>
      ${ev.gk ? `<div class="ggk"><div class="gb-h">Blocco portieri ${p.team}</div><div class="grow"><span>Questo portiere</span><b>${ev.gk.reserve ? "riserva (1 FM)" : "titolare"}</b></div><div class="grow"><span>Riserve collegate</span><b>${ev.gk.mates.length ? ev.gk.mates.map((m) => `${m.p.name}${m.avail ? "" : " (non disponibile)"}`).join(", ") : "nessuna nel database"}</b></div><div class="grow"><span>Costo previsto del blocco</span><b>${ev.gk.blockCost} FM</b></div></div>` : ""}
      <div class="pricebox" style="margin-top:12px"><input id="gc-price" type="number" inputmode="numeric" placeholder="Prezzo attuale" value="${called.price}"><div class="quick">${[1, 5, 10].map((n) => `<button data-d="${n}">+${n}</button>`).join("")}</div></div>
      ${pr && ev.occasion ? `<div class="gocc">🔥 Occasione</div>` : ""}
      <div class="gverdict v-${ev.cls}">${ev.label}</div>
      <p class="gwhy">${ev.why}</p>
      ${pr && ev.opportunity != null ? `<div class="grow"><span>Indice di opportunità a ${pr} FM</span><b>${ev.opportunity}/100</b></div>` : ""}
      ${pr && ev.impact ? (ev.impact.ok ? `<div class="gimp"><div class="gb-h">Se lo compri a ${pr}</div><div class="grow"><span>Budget residuo</span><b>${plan.budget} → ${ev.impact.residuo}</b></div><div class="grow"><span>Budget ${RN[p.role].toLowerCase()} restante</span><b>${ev.impact.roleBudget} FM</b></div><div class="grow"><span>Coerenza</span><b>${coherence(S, plan).score} → ${ev.impact.coh}</b></div>${ev.impact.lost.map((l) => `<div class="grow"><span>${l.name}</span><b class="${l.ok ? "ok" : "bad"}">${l.ok ? `ancora acquistabile fino a ${l.limit}` : "da sacrificare"}</b></div>`).join("")}</div>` : `<div class="gfeas bad"><b>A ${pr} FM la rosa non si completa</b></div>`) : ""}
      <div class="grow"><span>Affidabilità del consiglio</span><b>${ev.conf}</b></div>
      <a href="#" id="gc-why" class="glink">${ui.why ? "Nascondi spiegazione" : "Perché?"}</a>${ui.why ? `<ol class="glist">${ev.reasons.map((x) => `<li>${x}</li>`).join("")}</ol>` : ""}
      ${actions(S)}</div>`;
  }
  const actions = (S) => `<div class="gactions"><button class="green" id="gc-mine">✓ L'ho comprato</button><button class="secondary" id="gc-other">✕ Preso da un avversario</button><button class="secondary" id="gc-skip">⏭ Non mi interessa</button></div>
    ${(S.config?.names || []).length > 1 ? `<div class="grow" style="margin-top:6px"><span>Chi lo ha preso (facoltativo)</span><select id="gc-who"><option value="">—</option>${S.config.names.slice(1).map((n) => `<option ${called.who === n ? "selected" : ""}>${n}</option>`).join("")}</select></div>` : ""}<div class="muted" style="font-size:11px;text-align:center;margin-top:4px">il prezzo scritto sopra viene registrato</div>`;

  function idealView(plan, S) {
    const q = queue(plan), p0 = S.strategy?.plan0 || {};
    const body = ROLES.map((r) => { const own = S.roster.filter((x) => FA.get(x.id)?.role === r).map((x) => ({ x, p: FA.get(x.id) })), slots = plan.slots.filter((s) => s.role === r), spent = own.reduce((a, o) => a + o.x.price, 0), b = plan.byRole[r]?.budget || 0; if (!own.length && !slots.length) return "";
      return `<div class="grole"><div class="grole-h"><b>${RN[r]}</b><span>iniziale ${p0[r] ?? "—"} · attuale ${spent + b} · speso ${spent}</span></div>
        ${own.map((o) => `<div class="gslot mine"><div class="gslot-h"><span class="gid ${r}">✓</span><b>${o.p?.name || o.x.id}</b><small>${o.p?.team || ""}</small><span class="gtarget">pagato ${o.x.price}</span></div></div>`).join("")}
        ${slots.map((s) => `<div class="gslot" data-id="${s.p.id}"><div class="gslot-h"><span class="gid ${r}">${s.id}</span><b>${s.p.name}</b><small>${s.p.team}</small><span class="gtarget">obiettivo ${s.target} · max ${s.limit}</span></div>
          <div class="gslot-m"><span class="gprio">priorità ${q.indexOf(s) + 1}</span><span class="fatag fascia ${tierClass(s.tier)}">${s.tier}</span>${s.prio ? `<span class="gbadge">${s.prio === "must" ? "indispensabile" : s.prio === "high" ? "alta priorità" : "opportunità"}</span>` : ""}${s.urgency === "alta" ? `<span class="gurg alta">prendi presto</span>` : ""}</div>
          <div class="gslot-w">${s.why}</div>
          ${s.alts.length ? `<div class="galts">Stesso livello: ${s.alts.map((a) => `<span data-alt="${a.id}">${a.name}</span>`).join(" · ")}</div>` : ""}${s.cheaper.length ? `<div class="galts">Più economici: ${s.cheaper.map((a) => `<span data-alt="${a.id}">${a.name}</span>`).join(" · ")}</div>` : ""}</div>`).join("")}</div>`; }).join("");
    return `<div class="card garea" id="g-plan"><div class="gb-h">3 · Rosa ideale aggiornata</div><p class="muted" style="font-size:12px;margin:2px 0 8px">La rosa ideale è il piano attualmente più coerente con la tua strategia. Cambia durante l'asta in base ai prezzi e ai giocatori ancora disponibili.</p>${body}</div>`;
  }

  function strategyPanel(plan, S, coh) {
    const st = STRATS[S.strategy.key], p0 = S.strategy.plan0 || {}, R = plan.budget;
    const rows = ROLES.map((r) => { const spent = S.roster.filter((x) => FA.get(x.id)?.role === r).reduce((a, x) => a + x.price, 0), upd = spent + (plan.byRole[r]?.budget || 0), pl = p0[r] ?? upd, d = upd - pl, cls = Math.abs(d) <= Math.max(3, pl * 0.07) ? "ok" : d > 0 ? "bad" : "good", why = cls === "ok" ? "in linea" : d > 0 ? `+${d}: spesa superiore al previsto nel reparto` : `${d}: budget spostato per spese superiori altrove`; return `<div class="gsrow"><b>${RN[r]}</b><span>iniziale <b>${pl}</b></span><span>aggiornato <b class="${cls}">${upd}</b></span><span>speso <b>${spent}</b></span><small class="${cls}">${why}</small></div>`; }).join("");
    const q = queue(plan), goals = q.slice(0, 3).map((s) => `${s.p.name} (${s.target})`).join(", ");
    const objectives = [q.some((s) => s.role === "ATT" && s.tier === "TOP") || S.roster.some((x) => FA.get(x.id)?.role === "ATT" && x.price >= S.budget * 0.14) ? "1 top in attacco" : "attacco di fascia media", `${plan.slots.filter((s) => s.role === "CEN" && s.tier !== "LOW COST").length + S.roster.filter((x) => FA.get(x.id)?.role === "CEN" && x.price >= S.budget * 0.02).length} centrocampisti da titolare`, "blocco portieri coerente"];
    const dev = ROLES.filter((r) => { const spent = S.roster.filter((x) => FA.get(x.id)?.role === r).reduce((a, x) => a + x.price, 0), upd = spent + (plan.byRole[r]?.budget || 0); return p0[r] && Math.abs(upd - p0[r]) > Math.max(3, p0[r] * 0.07); }).map((r) => RN[r]);
    const body = `<div class="grow"><span>Strategia</span><b>${st.name}</b></div><div class="grow"><span>Rischio</span><b>${riskLevel(S, plan)}</b></div>
      <div class="grow"><span>Budget residuo</span><b>${R} FM · ${Math.round(100 * R / S.budget)}%</b></div>${bar(100 * R / S.budget)}
      <div class="grow"><span>Slot da completare</span><b>${plan.total}</b></div>
      <div class="grow"><span>Coerenza strategica</span><b class="${coh.cls[1]}">${coh.score}/100 · ${coh.cls[0]}</b></div>${bar(coh.score, coh.cls[1])}<div class="gslot-w">${coh.notes[0]}</div>
      <div class="gb-h" style="margin-top:10px">Budget per reparto · iniziale vs aggiornato</div>${rows}
      <div class="grow" style="margin-top:8px"><span>Giocatori prioritari</span><b>${goals || "—"}</b></div><div class="grow"><span>Obiettivi principali</span><b>${objectives.join(" · ")}</b></div>
      <div class="grow"><span>Deviazioni dal piano iniziale</span><b>${dev.length ? dev.join(", ") : "nessuna"}</b></div>
      <div class="row" style="margin-top:10px"><button class="secondary" id="g-review">Rivedi strategia</button></div>`;
    return details("g-strat", "4 · La tua strategia", body, ui.strat, `<b class="${coh.cls[1]}">${coh.score}</b>`);
  }
  function goingView(plan, S, coh) {
    const p0 = S.strategy.plan0 || {}, r0 = S.strategy.risk0 || riskLevel(S, plan);
    const rows = ROLES.map((r) => { const spent = S.roster.filter((x) => FA.get(x.id)?.role === r).reduce((a, x) => a + x.price, 0), upd = spent + (plan.byRole[r]?.budget || 0), pl = p0[r] ?? upd, done = plan.need[r] === 0, d = upd - pl; return `<div class="grow"><span>${RN[r]}</span><b class="${Math.abs(d) <= Math.max(3, pl * 0.07) ? "ok" : d > 0 ? "bad" : "good"}">${done ? (spent <= pl ? "completato sotto/in budget" : `completato: +${spent - pl} sul previsto`) : Math.abs(d) <= Math.max(3, pl * 0.07) ? "in linea con il piano" : d > 0 ? `spesi ${d} FM più del previsto` : `budget residuo inferiore di ${Math.round(100 * -d / Math.max(1, pl))}%`}</b></div>`; }).join("");
    const ideal0 = S.strategy.ideal0 || [], kept = ideal0.filter((id) => S.roster.some((x) => x.id === id)).length;
    const hist = (S.strategy.history || []).map((h) => `<div class="gslot-w">${new Date(h.t).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })} · ${h.from} → ${h.to}${h.why ? ` · ${h.why}` : ""}</div>`).join("");
    const body = `${rows}<div class="grow"><span>Rosa ideale iniziale → attuale</span><b>${kept} dei ${ideal0.length} obiettivi iniziali presi · ${S.roster.length}/${SOLO.total()} acquistati</b></div><div class="grow"><span>Rischio</span><b>${r0} → ${riskLevel(S, plan)}</b></div><div class="grow"><span>Coerenza</span><b>100 → ${coh.score}</b></div><div class="grow"><span>Strategia</span><b>${STRATS[S.strategy.key0 || S.strategy.key].name} → ${STRATS[S.strategy.key].name}</b></div>${hist ? `<div class="gb-h" style="margin-top:8px">Storico modifiche</div>${hist}` : ""}`;
    return details("g-going", "Come sta andando la tua asta", body, ui.going);
  }
  function reviewView(plan, S) {
    if (!ui.review) return "";
    const cur = S.strategy.key, opts = Object.keys(STRATS).filter((k) => k !== cur && k !== "cust");
    const cards = opts.map((k) => { const P = planFor(S, k, STRATS[k].share, S.strategy.priorities || []), diff = ROLES.map((r) => `${RS[r]} ${plan.byRole[r]?.budget || 0} → ${P.byRole[r]?.budget || 0}`).join(" · "), newP = queue(P).slice(0, 3).map((s) => s.p.name).join(", "), lostT = queue(plan).slice(0, 3).filter((s) => !P.slots.some((x) => x.p.id === s.p.id)).map((s) => s.p.name); return `<div class="gcard"><div class="gcard-h"><b>${STRATS[k].name}</b><span class="grisk r-${STRATS[k].risk}">Rischio ${STRATS[k].risk}</span></div><div class="grow"><span>Budget reparti</span><b>${diff}</b></div><div class="grow"><span>Diventano prioritari</span><b>${newP}</b></div><div class="grow"><span>Obiettivi che escono</span><b>${lostT.length ? lostT.join(", ") : "nessuno"}</b></div><button class="secondary" data-apply="${k}">Applica ${STRATS[k].name.toLowerCase()}</button></div>`; }).join("");
    return `<div class="card garea" id="g-reviewbox"><div class="gb-h">Rivedi strategia <a href="#" id="g-review-close" style="float:right;color:var(--muted);font-weight:600">chiudi</a></div><p class="muted" style="font-size:12px">Strategia attuale: <b>${STRATS[cur].name}</b>. La nuova parte dalla situazione reale: acquisti e budget speso restano.</p>${cards}</div>`;
  }

  // ---------- render ----------
  function render() {
    const S = SOLO.get(), box = $("so-guided"); if (!S) return;
    if (!S.strategy) { applyStrategy(S); box.innerHTML = strategyView(S); bindStrategy(box, S); return; }
    const plan = compute();
    if (!S.strategy.plan0) { S.strategy.plan0 = Object.fromEntries(ROLES.map((r) => [r, plan.byRole[r]?.budget || 0])); S.strategy.ideal0 = plan.slots.map((s) => s.p.id); S.strategy.limit0 = Object.fromEntries(plan.slots.map((s) => [s.p.id, s.limit])); S.strategy.risk0 = riskLevel(S, plan); S.strategy.key0 = S.strategy.key; SOLO.save(); }
    const coh = coherence(S, plan), warn = warnings(S, plan, coh), q = queue(plan), first = q[0];
    const bannerHtml = banner ? `<div class="gbanner k-${banner.kind}"><b>${banner.title}</b>${banner.lines.map((l) => `<div>${l}</div>`).join("")}${banner.changes?.length ? `<div class="gb-h" style="margin-top:6px">Budget aggiornato</div>${banner.changes.map((x) => `<div>${RN[x.r]}: ${x.from} → <b>${x.to}</b> FM</div>`).join("")}` : ""}<a href="#" id="gb-close">chiudi</a></div>` : "";
    box.innerHTML = `
      <div class="gtop"><div><span>Residuo</span><b>${plan.budget}</b></div><div><span>Presi</span><b>${S.roster.length}/${SOLO.total()}</b></div><div><span>Coerenza</span><b class="${coh.cls[1]}">${coh.score}</b></div><div><span>Rischio</span><b>${riskLevel(S, plan)}</b></div></div>
      ${first ? `<div class="gnext"><span>Prossimo obiettivo</span><b>${first.p.name}</b><small>${first.id} · ${first.tier.toLowerCase()} · obiettivo ${first.target} FM · massimo ${first.limit} FM${first.urgency === "alta" ? " · prendi presto" : ""}</small></div>` : `<div class="gnext"><b>Rosa completa</b></div>`}
      ${warn.length ? `<div class="gwarnbox">${warn.map((w) => `<div>⚠ ${w}</div>`).join("")}</div>` : ""}
      ${calledView(plan, S)}
      ${bannerHtml}
      ${idealView(plan, S)}
      ${strategyPanel(plan, S, coh)}
      ${goingView(plan, S, coh)}
      ${reviewView(plan, S)}
      <div class="row"><button class="secondary" id="g-undo" ${S.history.length ? "" : "disabled"}>↩ Annulla ultima azione</button></div>`;
    const bind = (id, fn) => { const e = $(id); if (e) e.onclick = (ev) => { ev.preventDefault(); fn(); }; };
    const gq = $("gc-q"); if (gq) gq.oninput = () => { called.q = gq.value; const pos = gq.selectionStart; SOLO.render(); const e2 = $("gc-q"); if (e2) { e2.focus(); try { e2.setSelectionRange(pos, pos); } catch {} } };
    box.querySelectorAll("[data-gc]").forEach((el) => el.onclick = () => { called = { q: "", id: el.dataset.gc, price: "", who: "" }; ui.why = false; SOLO.render(); window.scrollTo(0, 0); });
    bind("gc-clear", () => { called = { q: "", id: null, price: "", who: "" }; SOLO.render(); setTimeout(() => $("gc-q")?.focus(), 30); });
    const gp = $("gc-price"); if (gp) { gp.oninput = () => { called.price = gp.value; SOLO.render(); $("gc-price")?.focus(); }; gp.onkeydown = (e) => { if (e.key === "Enter") $("gc-mine")?.click(); }; }
    box.querySelectorAll(".quick button").forEach((b) => b.onclick = () => { called.price = String((parseInt(called.price, 10) || 0) + Number(b.dataset.d)); SOLO.render(); });
    const who = $("gc-who"); if (who) who.onchange = () => (called.who = who.value);
    bind("gc-mine", () => { let v = parseInt(called.price, 10); if (!v || v < 1) { v = parseInt(prompt("Prezzo pagato (FM)", ""), 10); if (!v) return; } commit("roster", called.id, v); });
    bind("gc-other", () => commit("sold", called.id, parseInt(called.price, 10) || 0, called.who));
    bind("gc-skip", () => commit("excluded", called.id));
    bind("gc-why", () => { ui.why = !ui.why; SOLO.render(); });
    bind("g-undo", undo); bind("gb-close", () => { banner = null; SOLO.render(); });
    bind("g-review", () => { ui.review = true; SOLO.render(); $("g-reviewbox")?.scrollIntoView({ block: "start" }); }); bind("g-review-close", () => { ui.review = false; SOLO.render(); });
    box.querySelectorAll("[data-apply]").forEach((b) => b.onclick = () => { const k = b.dataset.apply; S.strategy.history = S.strategy.history || []; S.strategy.history.push({ t: Date.now(), from: STRATS[S.strategy.key].name, to: STRATS[k].name, why: "revisione durante l'asta" }); S.strategy.key = k; S.strategy.share = STRATS[k].share; SOLO.save(); ui.review = false; lastPlan = null; banner = { kind: "undo", title: `Strategia aggiornata: ${STRATS[k].name}`, lines: ["Gli acquisti restano; il piano riparte dalla situazione reale."], changes: [] }; SOLO.render(); window.scrollTo(0, 0); });
    const ds = $("g-strat"); if (ds) ds.ontoggle = () => (ui.strat = ds.open); const dg = $("g-going"); if (dg) dg.ontoggle = () => (ui.going = dg.open);
    box.querySelectorAll(".gslot[data-id]").forEach((el) => el.onclick = (ev) => { if (ev.target.dataset.alt) return; called = { q: "", id: el.dataset.id, price: "", who: "" }; SOLO.render(); window.scrollTo(0, 0); });
    box.querySelectorAll("[data-alt]").forEach((el) => el.onclick = (ev) => { ev.stopPropagation(); called = { q: "", id: el.dataset.alt, price: "", who: "" }; SOLO.render(); window.scrollTo(0, 0); });
  }
  function bindStrategy(box, S) {
    S.draft = S.draft || { key: "fa", share: { ...STRATS.cust.share }, priorities: [] };
    box.querySelectorAll("[data-pick]").forEach((b) => b.onclick = () => { S.draft.key = b.dataset.pick; SOLO.render(); });
    box.querySelectorAll("[data-share]").forEach((inp) => inp.oninput = () => { const r = inp.dataset.share; S.draft.share[r] = parseInt(inp.value, 10); const others = ROLES.filter((x) => x !== r), rest = 100 - S.draft.share[r], sumO = others.reduce((a, x) => a + S.draft.share[x], 0) || 1; others.forEach((x) => (S.draft.share[x] = Math.max(0, Math.round(rest * S.draft.share[x] / sumO)))); const fix = 100 - ROLES.reduce((a, x) => a + S.draft.share[x], 0); S.draft.share[others[others.length - 1]] += fix; SOLO.render(); });
    const pq = $("g-prio-q"); if (pq) pq.oninput = () => { ui.prioQ = pq.value; const pos = pq.selectionStart; SOLO.render(); const e2 = $("g-prio-q"); if (e2) { e2.focus(); try { e2.setSelectionRange(pos, pos); } catch {} } };
    box.querySelectorAll("[data-padd]").forEach((el) => el.onclick = () => { S.draft.priorities.push({ id: el.dataset.padd, level: "high", max: null }); ui.prioQ = ""; SOLO.render(); });
    box.querySelectorAll("[data-plev]").forEach((el) => el.onchange = () => { S.draft.priorities[el.dataset.plev].level = el.value; SOLO.render(); });
    box.querySelectorAll("[data-pmax]").forEach((el) => el.onchange = () => { S.draft.priorities[el.dataset.pmax].max = parseInt(el.value, 10) || null; });
    box.querySelectorAll("[data-pdel]").forEach((el) => el.onclick = (ev) => { ev.preventDefault(); S.draft.priorities.splice(el.dataset.pdel, 1); SOLO.render(); });
    const gen = $("g-generate"); if (gen) gen.onclick = () => { const d = S.draft; S.strategy = { key: d.key, share: d.key === "cust" ? { ...d.share } : STRATS[d.key].share, priorities: d.key === "cust" ? d.priorities : [] }; delete S.draft; SOLO.save(); lastPlan = null; SOLO.render(); window.scrollTo(0, 0); };
  }

  // ---------- stile ----------
  const st = document.createElement("style"); st.textContent = `
    #so-guided .gb-h{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--green);font-weight:700;margin-bottom:6px}
    .garea{padding:14px 16px}
    .gtop{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}
    .gtop div{background:rgba(0,0,0,.25);border:1px solid var(--line);border-radius:12px;padding:10px 6px;text-align:center}
    .gtop span{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
    .gtop b{display:block;font-family:var(--display);font-weight:400;font-size:24px;color:#fff;margin-top:2px}
    .gnext{background:rgba(52,209,127,.10);border:1px solid rgba(52,209,127,.4);border-radius:12px;padding:10px 14px;margin-bottom:10px;font-size:16px}
    .gnext span{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--green)} .gnext small{display:block;color:var(--muted);font-size:13px;margin-top:2px}
    .gwarnbox{background:rgba(224,166,58,.12);border:1px solid rgba(224,166,58,.45);border-radius:12px;padding:10px 14px;margin-bottom:10px;font-size:14px;line-height:1.5}
    .gplayer{padding:14px;border-radius:12px;background:linear-gradient(135deg,color-mix(in srgb,var(--t1) 30%,#08170f),color-mix(in srgb,var(--t2) 30%,#08170f));margin-top:6px}
    .gp-name{font-family:var(--display);font-size:40px;line-height:1;text-transform:uppercase} .gp-meta{margin-top:6px}
    .grow{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}
    .grow span{color:var(--muted)} .grow b{text-align:right;color:#fff;font-weight:700}
    #so-guided .ok{color:var(--green)} #so-guided .warn{color:#ffb54a} #so-guided .bad{color:var(--red)} #so-guided .good{color:var(--green)}
    .gbar{height:8px;background:rgba(255,255,255,.1);border-radius:4px;margin:6px 0 4px;overflow:hidden} .gbar div{height:100%;background:var(--green)} .gbar.warn div{background:#ffb54a} .gbar.bad div{background:var(--red)}
    .gthr{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:12px 0 4px}
    .gthr div{border-radius:12px;padding:10px 6px;text-align:center;border:1px solid var(--line)} .gthr span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)} .gthr b{display:block;font-family:var(--display);font-size:22px;margin-top:4px}
    .gthr .ok b{color:var(--green)} .gthr .warn b{color:#ffb54a} .gthr .bad b{color:var(--red)}
    .gverdict{margin-top:12px;padding:14px;border-radius:12px;font-family:var(--display);font-size:22px;letter-spacing:.03em;text-align:center;text-transform:uppercase}
    .v-strong{background:var(--green);color:#06170f} .v-yes{background:#2ea56a;color:#fff} .v-cap{background:#e0a63a;color:#111} .v-risk{background:#c9762c;color:#fff} .v-no{background:var(--red);color:#fff}
    .gwhy{font-size:14px;line-height:1.5;color:#dbe7df;margin:10px 0 0}
    .gocc{font-family:var(--display);font-size:22px;color:#ffb54a;text-align:center;margin-top:10px;letter-spacing:.05em}
    .gimp,.ggk{margin-top:10px;background:rgba(0,0,0,.25);border-radius:12px;padding:8px 12px}
    .glink{display:inline-block;margin-top:10px;color:var(--green);font-weight:700;font-size:14px} .glist{margin:8px 0 0;padding-left:20px;font-size:14px;line-height:1.5;color:#dbe7df}
    .gactions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px} .gactions button{margin:0;padding:14px 8px;font-size:15px} .gactions button:first-child{grid-column:1/-1;font-size:18px;padding:16px}
    .gbanner{border-radius:14px;padding:12px 16px;margin-bottom:12px;font-size:14px;line-height:1.5;background:rgba(52,209,127,.12);border:1px solid rgba(52,209,127,.45)} .gbanner.k-sold{background:rgba(255,93,93,.10);border-color:rgba(255,93,93,.45)} .gbanner.k-undo,.gbanner.k-excluded{background:rgba(255,255,255,.06);border-color:var(--line)}
    .gbanner>b{display:block;font-family:var(--display);font-weight:400;font-size:22px;letter-spacing:.02em;text-transform:uppercase;margin-bottom:4px} .gbanner a{display:block;text-align:right;color:var(--muted);font-size:12px;margin-top:6px}
    .grole{margin-top:10px} .grole-h{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid var(--line);padding-bottom:4px;margin-bottom:4px} .grole-h b{font-family:var(--display);font-weight:400;font-size:20px;letter-spacing:.02em;text-transform:uppercase} .grole-h span{font-size:12px;color:var(--muted)}
    .gslot{padding:10px 0;border-bottom:1px solid var(--line);cursor:pointer} .gslot.mine{opacity:.85}
    .gslot-h{display:flex;align-items:center;gap:8px;font-size:15px} .gslot-h small{color:var(--muted)} .gid{font-family:var(--display);font-size:14px;color:#fff;padding:1px 7px;border-radius:6px} .gtarget{margin-left:auto;font-size:13px;color:var(--muted)}
    .gslot-m{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center} .gprio{font-size:11px;font-weight:800;padding:2px 7px;border-radius:5px;background:rgba(255,255,255,.12)}
    .gslot-w{font-size:13px;color:#b9cbc0;margin-top:5px;line-height:1.45} .galts{font-size:13px;color:var(--muted);margin-top:4px} .galts span{color:var(--ink);text-decoration:underline dotted;cursor:pointer}
    .gurg{font-size:11px;font-weight:800;padding:2px 7px;border-radius:5px} .gurg.alta{background:var(--red);color:#fff}
    .gdet{background:var(--card);border:1px solid var(--line);border-radius:16px;margin-bottom:12px} .gdet summary{list-style:none;cursor:pointer;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--green);font-weight:700} .gdet summary::-webkit-details-marker{display:none} .gdet summary::after{content:"▾";margin-left:8px;color:var(--muted)} .gdet[open] summary::after{content:"▴"} .gdet summary b{font-family:var(--display);font-size:20px;font-weight:400;letter-spacing:0} .gdet-b{padding:0 16px 14px}
    .gsrow{display:grid;grid-template-columns:1.2fr 1fr 1fr 1fr;gap:6px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px} .gsrow span{color:var(--muted)} .gsrow span b{color:#fff;font-weight:700} .gsrow small{grid-column:1/-1;font-size:12px}
    .gcard{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px;margin-bottom:12px} .gcard.on{border-color:var(--green);box-shadow:0 0 0 1px var(--green) inset}
    .gcard-h{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap} .gcard-h b{font-family:var(--display);font-weight:400;font-size:24px;letter-spacing:.02em;text-transform:uppercase}
    .gbadge{display:inline-block;margin-left:8px;font-size:11px;font-weight:800;padding:2px 8px;border-radius:6px;background:var(--green);color:#06170f;vertical-align:middle}
    .grisk{font-size:12px;font-weight:800;padding:3px 9px;border-radius:6px;background:rgba(255,255,255,.1)} .grisk.r-Alto{background:var(--red);color:#fff} .grisk.r-Basso{background:var(--green);color:#06170f} .grisk.r-Medio{background:#e0a63a;color:#111}
    .gdesc{font-size:14px;line-height:1.5;color:#dbe7df;margin:8px 0}
    .gdist{display:grid;grid-template-columns:110px 1fr;gap:2px 10px;align-items:center;margin-top:6px;font-size:13px} .gdist .gbar{margin:0} .gdist-l{color:var(--muted)} .gdist-v{grid-column:2;color:#dbe7df} .gdist-v b{color:#fff}
    .gpm{margin-top:10px;font-size:13px} .gpm span{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;margin-top:6px} .gpm ul{margin:4px 0;padding-left:18px;color:#dbe7df;line-height:1.5}
    .gsel{margin-top:10px;text-align:center;color:var(--green);font-weight:800}
    .gcust{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
    .gprio-row{display:grid;grid-template-columns:auto 1fr auto 120px 64px auto;gap:6px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px} .gprio-row .rl{width:24px;height:24px;border-radius:6px;font-size:11px;font-weight:800;color:#fff;display:grid;place-items:center} .gprio-row small{color:var(--muted)} .gprio-row select,.gprio-row input{padding:8px 6px;font-size:13px} .gprio-row a{color:var(--red)}
    .gslider{margin-top:12px} .gslider-h{display:flex;flex-direction:column;font-size:13px;color:var(--muted)} .gslider-h b{color:#fff;font-size:15px} .gslider input[type=range]{width:100%;padding:0;accent-color:var(--green);height:28px}
    .gfeas{border-radius:12px;padding:10px 14px;margin-top:10px;font-size:14px;line-height:1.5;border:1px solid} .gfeas.ok{background:rgba(52,209,127,.12);border-color:rgba(52,209,127,.45)} .gfeas.warn{background:rgba(224,166,58,.12);border-color:rgba(224,166,58,.45)} .gfeas.bad{background:rgba(255,93,93,.12);border-color:rgba(255,93,93,.45)} .gfeas b{display:block}
    .gsum .grow b{max-width:65%}
    .gtip{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,.15);font-size:10px;font-weight:800;color:var(--ink);cursor:help;margin-left:4px}
    #gc-who{width:auto;max-width:55%;padding:8px}`;
  document.head.appendChild(st);

  return { STRATS, render, optimize, compute, commit, undo, quality, market, evaluate, coherence, getPlan: () => lastPlan,
    setCalled: (id, price, who) => { called = { q: "", id, price: price || "", who: who || "" }; ui.why = false; }, setUI: (o) => Object.assign(ui, o),
    reset: () => { lastPlan = null; banner = null; called = { q: "", id: null, price: "", who: "" }; ui = { strat: false, going: false, review: false, why: false, prioQ: "" }; } };
})();

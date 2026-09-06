// Asta guidata: "con budget e rosa attuali, chi dovrei comprare adesso?"
// Ottimizzatore: parte dalla rosa più economica che completa tutti gli slot, poi applica upgrade
// (sostituzione di un giocatore con uno migliore nello stesso ruolo) scegliendo ogni volta quello con il
// miglior guadagno di qualità per FM, finché il budget lo consente. Ricalcolato da zero a ogni evento.
window.GUIDED = (() => {
  const $ = (id) => document.getElementById(id);
  const ROLES = ["POR", "DIF", "CEN", "ATT"], RL = FA.ROLE_LABEL, RS = FA.ROLE_SHORT;
  const RNAME = { POR: "Portieri", DIF: "Difesa", CEN: "Centrocampo", ATT: "Attacco" };
  const SLOTP = { POR: "P", DIF: "D", CEN: "C", ATT: "A" };
  let lastPlan = null, banner = null;

  // qualità di un giocatore: premia i top (convessa in IA), piccola penalità per scarsa affidabilità
  // pesi per ruolo: l'IA è normalizzato dentro ogni ruolo, ma un attaccante forte porta più bonus di un difensore forte
  const RW = { POR: 0.5, DIF: 0.75, CEN: 1.0, ATT: 1.9 }; window.GUIDED_EXP = 2.2;
  // --- strategie: pesi per ruolo, convessità (peso dei top) e quota massima di budget per reparto ---
  const STRATS = {
    fa:   { name: "Consigliata dal Fantalgoritmo", rw: { POR: 0.5, DIF: 0.75, CEN: 1.0, ATT: 1.9 }, exp: 2.2, share: null, risk: "Medio", strength: "Miglior rapporto qualità/prezzo su tutta la rosa: usa i valori e la scarsità del tuo mercato.", weak: "Meno top assoluti: vince con la profondità, non con i fuoriclasse." },
    agg:  { name: "Aggressiva", rw: { POR: 0.35, DIF: 0.55, CEN: 0.9, ATT: 2.6 }, exp: 3.0, share: { POR: 0.07, DIF: 0.15, CEN: 0.25, ATT: 0.53 }, risk: "Alto", strength: "Potenziale offensivo molto elevato: 1 top assoluto e un medio-alto in attacco.", weak: "Forte dipendenza dai top acquistati; difesa e portieri quasi solo value." },
    conv: { name: "Convenzionale", rw: { POR: 0.6, DIF: 0.9, CEN: 1.0, ATT: 1.5 }, exp: 1.8, share: { POR: 0.08, DIF: 0.22, CEN: 0.32, ATT: 0.38 }, risk: "Basso", strength: "Rosa equilibrata e profonda, poche scommesse, tanti titolari sicuri.", weak: "Difficile avere il singolo fuoriclasse che decide le giornate." },
    cust: { name: "Personalizzata", rw: { POR: 0.5, DIF: 0.75, CEN: 1.0, ATT: 1.9 }, exp: 2.2, share: { POR: 0.06, DIF: 0.18, CEN: 0.30, ATT: 0.46 }, risk: "—", strength: "Decidi tu la ripartizione del budget: Fantalgoritmo ottimizza dentro i tuoi vincoli.", weak: "Ripartizioni estreme riducono le opzioni disponibili." },
  };
  let SHARE = null;
  function applyStrategy(S) {
    const key = S.strategy?.key || "fa", st = STRATS[key] || STRATS.fa;
    Object.assign(RW, st.rw); window.GUIDED_EXP = st.exp;
    SHARE = key === "cust" && S.strategy?.share ? S.strategy.share : st.share;
  }
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
            if (SHARE && SHARE[r]) { const roleSpent = chosen[r].reduce((a, x) => a + x.cost, 0) + S.roster.filter((x) => FA.get(x.id)?.role === r).reduce((a, x) => a + x.price, 0); if (roleSpent + dc > SHARE[r] * S.budget * 1.12) continue; }
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
        // l'urgenza ha senso solo per gli investimenti veri (≥ 4% del budget): i low cost si trovano sempre
        const urgency = c.cost < S.budget * 0.04 ? "bassa" : coverage < 1 ? "alta" : coverage < 1.6 ? "media" : "bassa";
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

  // --- valutazione del giocatore chiamato ---
  // in piano → coerenza 100%. Altrimenti: simulo di prenderlo al prezzo atteso e misuro quanto peggiora (o migliora) la miglior rosa ancora costruibile.
  function evaluateCalled(p, plan) {
    const S = SOLO.get(); const infl = SOLO.infl();
    const st = SOLO.statusOf(p.id); if (st) return { status: st };
    if ((S.excluded || []).includes(p.id)) return { status: "escluso" };
    if (!p.fa) return { nodata: true, need: plan.need[p.role] };
    const need = plan.need[p.role];
    if (!need) return { fit: 0, verdict: "leave", why: `Hai già ${S.limits[p.role]} ${RL[p.role].toLowerCase()}: non ti serve.`, limit: 0, target: 0, need };
    const slot = plan.slots.find((s) => s.p.id === p.id);
    const value = Math.max(1, FA.adjValue(p, S.budget, infl) || 1);
    const hardCap = plan.budget - (plan.total - 1);
    if (slot) return { fit: 100, verdict: "take", slot, target: slot.target, lo: slot.lo, hi: slot.hi, limit: Math.min(slot.limit, hardCap), value, why: `È il tuo obiettivo ${slot.id} (${slot.tier.toLowerCase()}): ${slot.urgency === "alta" ? "priorità alta, pochi disponibili di questo livello" : slot.urgency === "media" ? "scarsità in aumento" : "ci sono alternative, ma è la prima scelta"}.`, need };
    // simulazione: quanto vale la rosa se lo prendo al prezzo atteso, e fino a che prezzo resta conveniente
    const q0 = plan.quality;
    const sim = (price) => { const S2 = { ...S, roster: S.roster.concat([{ id: p.id, price }]) }; const P2 = optimize(S2, infl, (id) => id !== p.id && SOLO.isAvail(id)); return P2.total === plan.total - 1 && P2.spare >= 0 ? P2.quality : 0; };
    // coerenza: quanto peggiora la miglior rosa costruibile se lo prendo al prezzo atteso (−8% di qualità media = 0%)
    const qAt = sim(value); const drop = 1 - qAt / Math.max(1e-6, q0); const fit = Math.max(0, Math.min(100, Math.round(100 * (1 - drop / 0.08))));
    // fino a quanto conviene: il prezzo più alto a cui la rosa costruibile resta (quasi) altrettanto buona
    let limit = 0;
    for (const m of [1.6, 1.45, 1.3, 1.2, 1.1, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) { const pr = Math.max(1, Math.round(value * m)); if (pr <= hardCap && sim(pr) >= q0 * 0.985) { limit = pr; break; } }
    limit = Math.min(limit, hardCap);
    const displaced = plan.slots.filter((s) => s.role === p.role).sort((a, b) => Math.abs(a.target - value) - Math.abs(b.target - value))[0];
    const verdict = limit >= value && fit >= 85 ? "take" : limit > 0 ? "maybe" : "leave";
    const why = verdict === "take" ? `Non era nel piano ma ci sta: prenderebbe il posto di ${displaced?.p.name || "uno slot"} (${displaced?.id || ""}) senza perdere qualità.`
      : verdict === "maybe" ? `Al prezzo atteso (${value}) la rosa peggiora; conviene solo fino a ${limit} FM, al posto di ${displaced?.p.name || "un obiettivo"} (${displaced?.id || ""}).`
      : `A qualunque prezzo ragionevole peggiora la rosa costruibile: meglio aspettare ${displaced?.p.name || "il tuo obiettivo"}.`;
    return { fit, verdict, limit, target: value, lo: Math.round(value * 0.9), hi: Math.round(value * 1.05), value, why, displaced, need, peers: plan.slots.find((s) => s.role === p.role)?.peers };
  }
  // arricchimento tattico: fasce di prezzo, opportunità, affidabilità, spiegazione, occasione, spendibile
  function enrich(ev, p, plan, price) {
    const S = SOLO.get(); if (!ev || ev.status || ev.nodata) return ev;
    const v = ev.value, inf = SOLO.infl(), nRole = S.sold.concat(S.roster).filter((x) => FA.get(x.id)?.role === p.role).length;
    ev.bands = { ideal: Math.round(v * 0.9), fairLo: Math.round(v * 0.9) + 1, fairHi: Math.round(v * 1.1), max: ev.limit };
    ev.spendable = plan.budget - (plan.total - 1);
    // opportunità: sconto sul valore + compatibilità con la rosa
    if (price) { const disc = Math.max(0, (v - price) / v); ev.opportunity = Math.round(Math.min(100, 100 * (0.65 * Math.min(1, disc / 0.35) + 0.35 * ev.fit / 100))); ev.occasion = disc >= 0.22 && ev.fit >= 55 && price <= ev.spendable; if (ev.occasion) { ev.limit = Math.min(ev.spendable, Math.max(ev.limit, Math.round(v * 0.85))); ev.bands.max = ev.limit; } }
    // affidabilità: quante vendite osservate nel ruolo e quanto è ampia la scelta di livello simile
    ev.confidence = nRole >= 5 && (ev.peers ?? 3) >= 3 ? "Alta" : nRole >= 2 || (ev.peers ?? 0) >= 2 ? "Media" : "Bassa";
    ev.confWhy = ev.confidence === "Alta" ? `${nRole} vendite osservate nel ruolo: i prezzi del tuo mercato sono già leggibili.` : ev.confidence === "Media" ? `Poche vendite nel ruolo (${nRole}): il limite dipende da come verranno pagati i prossimi ${RL[p.role].toLowerCase()}.` : `Nessuna vendita osservata nel ruolo: il limite si basa solo sui valori Fantalgoritmo e sulla scarsità teorica.`;
    const top = queue(plan).find((s) => s.p.id !== p.id);
    ev.reasons = [`Hai ancora ${plan.total} slot da completare: devi tenere almeno ${plan.total - 1} FM per gli altri.`,
      top ? `Il tuo obiettivo principale (${top.p.name}) richiede circa ${top.target} FM.` : "Non hai altri obiettivi prioritari da proteggere.",
      `Disponibili ${ev.peers ?? "alcune"} alternative di livello simile nel ruolo.`,
      ev.fit >= 90 ? "È centrale per la tua strategia." : ev.fit >= 60 ? "Non è indispensabile: sostituibile senza perdere molto." : "Non è indispensabile per la strategia."];
    ev.strongWrong = (p.fa.ia || 0) >= 80 && ev.fit < 60; // forte ma sbagliato per la tua asta
    return ev;
  }
  // scenario B: come cambia la rosa se perdo i due obiettivi principali
  function planB(plan) {
    const S = SOLO.get(); const tops = queue(plan).slice(0, 2).map((s) => s.p.id); if (!tops.length) return null;
    const P = optimize(S, SOLO.infl(), (id) => !tops.includes(id) && SOLO.isAvail(id), new Set(plan.slots.map((s) => s.p.id)));
    return { lost: tops, plan: P, slots: queue(P).slice(0, 5) };
  }
  // simulazione acquisto
  function simulate(p, price, plan) {
    const S = SOLO.get(); const S2 = { ...S, roster: S.roster.concat([{ id: p.id, price }]) };
    const P2 = optimize(S2, SOLO.infl(), (id) => id !== p.id && SOLO.isAvail(id), new Set(plan.slots.map((s) => s.p.id)));
    const targets = queue(plan).filter((s) => s.p.id !== p.id).slice(0, 3).map((s) => { const s2 = P2.slots.find((x) => x.p.id === s.p.id); return { name: s.p.name, ok: !!s2, limit: s2?.limit }; });
    const ok = P2.total === plan.total - 1 && P2.spare >= 0 && P2.slots.length === P2.total;
    const coh = coherence(S), coh2 = Math.max(0, coh - Math.round((1 - (evaluateCalled(p, plan).fit || 0) / 100) * 12) - Math.max(0, price - (evaluateCalled(p, plan).limit || 0)) * 1.2);
    return { P2, targets, ok, residuo: [plan.budget, plan.budget - price], coh: [coh, coh2], roleBudget: P2.byRole[p.role]?.budget ?? 0, verdict: ok && coh2 >= coh - 6 ? "Acquisto sostenibile" : ok ? "Sostenibile, ma pesa sulla strategia" : "Non sostenibile: la rosa non si completa" };
  }
  // coerenza strategica: parte da 100 e scende con acquisti poco coerenti o pagati oltre il limite
  function coherence(S) {
    let pen = 0; (S.history || []).forEach((h) => { if (h.type === "roster" && h.fit != null) pen += (1 - h.fit / 100) * 12 + Math.max(0, (h.price || 0) - (h.limit || 0)) / S.budget * 150; });
    return Math.max(0, Math.min(100, Math.round(100 - pen)));
  }
  const phaseOf = (S, mk) => { const N = S.participants || 8, tot = N * Object.values(S.limits).reduce((a, b) => a + b, 0), sold = S.sold.length + S.roster.length; const f = sold / Math.max(1, tot); return f < 0.25 ? { k: "iniziale", f, msg: "fase iniziale: disciplina sui prezzi, non inseguire" } : f < 0.75 ? { k: "centrale", f, msg: "fase centrale: attenzione alla scarsità dei livelli che ti servono" } : { k: "finale", f, msg: "fase finale: contano slot mancanti, budget degli altri e occasioni residue" }; };
  // pressione competitiva per ruolo (dagli avversari in aggregato: budget medio e slot residui)
  function pressure(S, plan) {
    const N = S.participants || 8, out = {};
    ROLES.forEach((r) => { const mk = plan.market[r]; const othersSlots = Math.max(0, mk.demand - plan.need[r]); const per = othersSlots / Math.max(1, N - 1); const lvl = plan.need[r] === 0 ? "—" : mk.tightness > 0.9 || per >= 3 && mk.qpool > 0 ? "ALTA" : mk.tightness > 0.5 ? "MEDIA" : "BASSA"; out[r] = { lvl, othersSlots, per, msg: plan.need[r] === 0 ? "reparto completato" : lvl === "ALTA" ? `${N - 1} squadre devono ancora comprare in media ${per.toFixed(1)} ${RL[r].toLowerCase()}: non aspettare troppo sui livelli alti` : lvl === "MEDIA" ? `concorrenza normale (${othersSlots} slot avversari ancora aperti)` : `concorrenza residua bassa (${othersSlots} slot avversari): puoi aspettare` }; });
    return out;
  }
  // rischi di struttura della rosa (presi + obiettivi)
  function risks(S, plan) {
    const all = S.roster.map((x) => FA.get(x.id)).filter(Boolean).concat(plan.slots.map((s) => s.p)); const out = [];
    const byTeam = {}; all.filter((p) => p.role !== "POR").forEach((p) => (byTeam[p.team] = (byTeam[p.team] || 0) + 1)); Object.entries(byTeam).forEach(([t, n]) => { if (n >= 4) out.push(`Concentrazione: ${n} giocatori del ${t}. Valuta più diversificazione.`); });
    const lowFv = all.filter((p) => (p.fa?.fv ?? 1) < 0.6).length; if (lowFv >= 4) out.push(`${lowFv} giocatori con bassa affidabilità (ballottaggi/rotazione).`);
    const big = S.roster.filter((x) => x.price > S.budget * 0.3); if (big.length) out.push(`Budget concentrato: ${FA.get(big[0].id)?.name} vale ${Math.round(big[0].price / S.budget * 100)}% del budget.`);
    const bets = all.filter((p) => /scomm|jolly/i.test(p.fa?.fascia || "")).length; if (bets >= 5) out.push(`${bets} scommesse in rosa: panchina fragile.`);
    return out;
  }
  // blocco portieri: titolare + riserve della stessa squadra, valutati insieme
  function gkBlock(plan) {
    const S = SOLO.get(); const gk = plan.slots.filter((s) => s.role === "POR"); if (!gk.length) return null;
    const main = gk[0].p, team = main.team; const mates = FA.players().filter((p) => p.role === "POR" && p.team === team && p.id !== main.id && p.fa && SOLO.isAvail(p.id)).slice(0, 2);
    const cost = gk[0].target + mates.length; const fv = Math.round(((main.fa.fv ?? 0.7) * 0.7 + 0.3 * (mates.length ? 0.9 : 0.6)) * 100);
    const alt = plan.slots.filter((s) => s.role === "POR")[0]?.alts?.[0];
    return { team, main, mates, cost, fv, max: gk[0].limit, alt };
  }
  // priorità dinamica di uno slot
  const prio = (s, i) => (i === 0 || s.urgency === "alta") && s.target >= 0.05 * SOLO.get().budget ? [1, "obiettivo principale"] : s.target >= 0.05 * SOLO.get().budget ? [2, "alternativa equivalente"] : s.target >= 0.02 * SOLO.get().budget ? [3, "value"] : s.target > 1 ? [4, "copertura"] : [5, "emergenza"];
  const nextMove = (plan, S, pr) => { const q = queue(plan); const f = q[0]; if (!f) return { cerca: "Rosa completa", budget: "", evita: "" }; const cenOpen = plan.need.CEN > 0, attTops = plan.slots.filter((s) => s.role === "ATT" && s.tier !== "LOW COST" && s.tier !== "TITOLARE").length; const done = ROLES.filter((r) => plan.need[r] === 0 && pr[r]); return { cerca: `${RL[f.role].toLowerCase()} ${f.tier.toLowerCase()} (${f.p.name} o equivalente)`, budget: `massimo ${f.limit} FM`, evita: attTops >= 2 && cenOpen && f.role !== "CEN" ? "un secondo top in attacco prima di completare il centrocampo" : done.length ? `di forzare in ${done.map((r) => RNAME[r].toLowerCase()).join(", ")}: già completi` : "di superare il limite: ci sono alternative" }; };

  // --- azioni ---
  let called = { q: "", id: null, price: "" };
  function commit(kind, id, price) {
    const S = SOLO.get(); const before = lastPlan;
    const evb = kind === "roster" && before ? evaluateCalled(FA.get(id), before) : null;
    if (kind === "roster") { S.roster.push({ id, price, t: Date.now() }); S.history.push({ type: "roster", id, price, fit: evb?.fit ?? 100, limit: evb?.limit ?? price }); if (window.fireworks) window.fireworks(1600); }
    else if (kind === "sold") { S.sold.push({ id, price: price || 0, t: Date.now() }); S.history.push({ type: "sold", id }); }
    else { S.excluded.push(id); S.history.push({ type: "excluded", id }); }
    SOLO.save(); called = { q: "", id: null, price: "" };
    const p = FA.get(id), plan = compute(); const d = diffPlans(before, plan);
    const slot = before?.slots.find((s) => s.p.id === id);
    if (kind === "roster" && evb && evb.limit && price > evb.limit) { const over = price - evb.limit; const q = queue(plan); banner = { kind, title: `PRESO ✓ ${p.name} — ${price} FM`, lines: [`Hai pagato ${over} FM oltre il limite consigliato (${evb.limit}).`, `Impatto: budget ${RNAME[p.role].toLowerCase()} −${over}; coerenza ${coherence(S)}/100.`], d, recovery: [q[0] ? `mantieni ${q[0].p.name} come obiettivo principale (${q[0].target} FM)` : null, q[1] ? `per lo slot ${q[1].id} passa a un profilo di fascia inferiore (target ${q[1].target})` : null, `risparmia almeno ${Math.min(over, 8)} FM sul prossimo ${RL[q[0]?.role || p.role].toLowerCase().replace(/i$/, "e")}`].filter(Boolean) }; }
    else if (kind === "roster") banner = { kind, title: `PRESO ✓ ${p.name} — ${price} FM`, lines: [slot ? `${price - slot.target > 0 ? "+" : ""}${price - slot.target} FM rispetto al target (${slot.target})` : "Non era nel piano: la rosa ideale si riorganizza attorno a lui"], d };
    else if (kind === "sold") banner = { kind, title: `${p.name} → PRESO DA ALTRI${price ? ` a ${price} FM` : ""}`, lines: [slot ? `Era il tuo ${slot.id}: sostituito nella rosa ideale` : "Fuori dal mercato"], d };
    else banner = { kind, title: `${p.name} escluso dai suggerimenti`, lines: [], d };
    SOLO.render();
  }
  function undo() {
    const before = lastPlan; const h = SOLO.undo(); if (!h) return;
    const plan = compute(); called = { q: "", id: null, price: "" };
    banner = { kind: "undo", title: `↩ Annullato: ${FA.get(h.id)?.name}`, lines: [h.type === "roster" ? "rimosso dalla rosa, budget ripristinato" : h.type === "sold" ? "di nuovo disponibile" : "di nuovo tra i suggerimenti"], d: diffPlans(before, plan) };
    SOLO.render();
  }
  function compute() {
    const S = SOLO.get(); applyStrategy(S); const prev = lastPlan ? new Set(lastPlan.slots.map((s) => s.p.id)) : null; const plan = optimize(S, SOLO.infl(), SOLO.isAvail, prev); lastPlan = plan; return plan;
  }

  // --- UI ---
  const tierClass = (t) => ({ TOP: "top", SEMITOP: "semi", TITOLARE: "mid", "LOW COST": "low" }[t] || "");
  const VLAB = { take: ["COMPRA", "buy"], maybe: ["VALUTA", "near"], leave: ["LASCIALO", "leave"] };
  let showWhy = false, showSim = false, showB = false, planOpen = true;

  // scelta strategia (prima dell'asta): anteprima concreta calcolata sul tuo mercato
  function strategyHtml(S) {
    const cards = Object.entries(STRATS).map(([key, st]) => {
      const prev = { key }; const S2 = { ...S, strategy: prev }; applyStrategy(S2); const P = optimize(S2, SOLO.infl(), SOLO.isAvail);
      const tot = Math.max(1, ROLES.reduce((a, r) => a + (P.byRole[r]?.budget || 0), 0));
      const pct = ROLES.map((r) => `${RNAME[r]} ${Math.round(100 * (P.byRole[r]?.budget || 0) / tot)}%`).join(" · ");
      const att = P.slots.filter((s) => s.role === "ATT"); const prof = [`${att.filter((s) => s.tier === "TOP").length} top e ${att.filter((s) => s.tier === "SEMITOP").length} semitop in attacco`, `centrocampo ${P.slots.filter((s) => s.role === "CEN" && (s.tier === "TOP" || s.tier === "SEMITOP")).length} di fascia alta`, `difesa ${P.slots.filter((s) => s.role === "DIF" && s.tier === "LOW COST").length}/${P.slots.filter((s) => s.role === "DIF").length} value`, `portieri ${P.byRole.POR?.budget || 0} FM`];
      return `<div class="gstrat ${key === (S.strategy?.key || "fa") ? "on" : ""}" data-strat="${key}"><div class="gstrat-h"><b>${st.name}</b><span class="grisk r-${st.risk}">Rischio ${st.risk}</span></div>
        <div class="gstrat-pct">${pct}</div><ul>${prof.map((x) => `<li>${x}</li>`).join("")}</ul>
        <div class="gstrat-l"><span>Punto di forza</span>${st.strength}</div><div class="gstrat-l"><span>Criticità</span>${st.weak}</div>
        ${key === "cust" ? `<div class="row gshare">${ROLES.map((r) => `<div><label>${RS[r]} %</label><input type="number" min="0" max="90" data-share="${r}" value="${Math.round(100 * ((S.strategy?.share || STRATS.cust.share)[r]))}"></div>`).join("")}</div>` : ""}
        <button class="${key === "fa" ? "green" : "secondary"}" data-pick="${key}">Scegli ${st.name.toLowerCase()}</button></div>`;
    }).join("");
    applyStrategy(S);
    return `<div class="kicker">Prima dell'asta</div><h2 style="margin:6px 0 4px">Scegli la tua strategia d'asta</h2><div class="muted" style="font-size:13px;margin-bottom:10px">La strategia cambia raramente; il piano si aggiorna a ogni chiamata. Anteprime calcolate su ${S.budget} FM, ${S.participants} squadre, ${ROLES.map((r) => S.limits[r]).join("-")}.</div>${cards}`;
  }

  function calledHtml(plan) {
    const S = SOLO.get(); const p = called.id ? FA.get(called.id) : null;
    if (!p) {
      const rows = called.q.length >= 2 ? SOLO.search(called.q, "ALL").slice(0, 6) : [];
      return `<div class="card gcalled"><div class="gb-h">Tattica · giocatore chiamato adesso</div>
        <input id="gc-q" placeholder="Scrivi il nome del giocatore appena uscito…" autocomplete="off" value="${called.q}">
        ${rows.length ? rows.map((x) => { const st = SOLO.statusOf(x.id), inPlan = plan.slots.some((s) => s.p.id === x.id); return `<div class="lrow" data-gc="${x.id}" style="cursor:pointer"><span class="rl ${x.role}">${RS[x.role]}</span><span class="nm">${x.name}<small>${x.team}${inPlan ? " · nel piano" : ""}${st ? " · " + st : ""}</small></span><span class="cost">${FA.value(x, S.budget) ?? "—"}</span></div>`; }).join("") : `<div class="muted" style="font-size:13px;margin-top:6px">Fantalgoritmo ti dice se prenderlo, fino a quanto, perché, e cosa cambia se lo compri o lo perdi.</div>`}
      </div>`;
    }
    const pr = parseInt(called.price, 10) || 0;
    const ev = enrich(evaluateCalled(p, plan), p, plan, pr), tc = window.TEAM_COLORS?.[p.team] || ["#34d17f", "#0b2418", "#fff"];
    const head = `<a href="#" class="back" id="gc-clear">‹ altro giocatore</a><div class="card player gcalled" style="--t1:${tc[0]};--t2:${tc[1]};--tink:${tc[2]};padding-top:20px;text-align:left">
      <div class="name" style="text-align:left">${p.name}</div><div class="meta" style="text-align:left"><span class="team">${p.team}</span> <span class="role ${p.role}">${RL[p.role]}</span>${p.fa?.fascia ? ` <span class="fatag fascia ${FA.fasciaClass(p.fa.fascia)}">${p.fa.fascia}</span>` : ""}</div>`;
    if (ev.status) return head + `<div class="notice" style="margin-top:12px">${ev.status === "mio" ? "È già nella tua rosa" : ev.status === "venduto" ? "Già preso da altri in questa asta" : "Lo avevi escluso"}</div></div>`;
    if (ev.nodata) return head + `<div class="notice" style="margin-top:12px">Nessuna valutazione Fantalgoritmo per questo giocatore${ev.need ? "" : " e non ti serve nel ruolo"}.</div>${actionsHtml()}</div>`;
    let v = ev.verdict; if (pr && v !== "leave") v = pr <= ev.limit ? (pr <= ev.bands.fairHi ? "take" : "maybe") : "leave"; if (pr && ev.occasion) v = "take";
    const motiv = pr ? (ev.occasion ? `Prezzo circa ${Math.round(100 * (ev.value - pr) / ev.value)}% sotto il valore previsto: anche se non era nel Piano A, migliora il valore complessivo della rosa.` : pr <= ev.bands.ideal ? `Sotto il valore previsto (${ev.value}): rafforza il reparto senza toccare gli obiettivi principali.` : pr <= ev.limit ? `Prezzo nella fascia sostenibile: ${ev.why}` : ev.limit ? `Oltre ${ev.limit} FM ${ev.fit >= 90 ? "smette di convenire anche se è un tuo obiettivo: lascialo agli altri." : "peggiora la rosa costruibile: meglio il tuo obiettivo."}` : ev.why) : ev.why;
    const sim = showSim && pr ? simulate(p, pr, plan) : null;
    return head + `
      <div class="gfit"><div class="gfitbar"><div style="width:${ev.fit}%"></div></div><div class="gfitlab"><span>Coerenza strategica</span><b>${ev.fit}/100</b></div></div>
      ${pr ? `<div class="gfit"><div class="gfitbar opp"><div style="width:${ev.opportunity}%"></div></div><div class="gfitlab"><span>Indice di opportunità a ${pr} FM</span><b>${ev.opportunity}/100</b></div></div>` : ""}
      ${ev.strongWrong ? `<div class="gwarn">Forte, ma sbagliato per la tua asta: ottimo giocatore, coerenza bassa con strategia e budget.</div>` : ""}
      <div class="gbands"><div><span>Valore FA</span><b>${ev.value}</b></div><div><span>Ideale</span><b>≤ ${ev.bands.ideal}</b></div><div><span>Corretto</span><b>${ev.bands.fairLo}–${ev.bands.fairHi}</b></div><div class="mx"><span>Max strategico</span><b>${ev.bands.max}</b></div><div><span>Spendibile ora</span><b>${ev.spendable}</b></div></div>
      <div class="pricebox" style="margin-top:12px"><input id="gc-price" type="number" inputmode="numeric" placeholder="Prezzo attuale / finale" value="${called.price}"><div class="quick">${[1, 5, 10].map((n) => `<button data-d="${n}">+${n}</button>`).join("")}</div></div>
      ${ev.occasion && pr ? `<div class="gocc">🔥 OCCASIONE</div>` : ""}
      <div class="verdict ${VLAB[v][1]}" style="font-size:22px">${VLAB[v][0]}${pr && v !== "leave" ? ` FINO A ${ev.limit}` : ev.limit && !pr && v !== "leave" ? ` FINO A ${ev.limit}` : ""}</div>
      <div class="gmotiv">${motiv}</div>
      <div class="gconf">Affidabilità del consiglio: <b>${ev.confidence}</b> <small>${ev.confWhy}</small></div>
      <div class="glinks"><a href="#" id="gc-why">Perché${ev.limit ? ` non superare ${ev.limit}` : ""}?</a> · <a href="#" id="gc-sim">Simula acquisto${pr ? ` a ${pr}` : ""}</a></div>
      ${showWhy ? `<ol class="gwhy">${ev.reasons.map((x) => `<li>${x}</li>`).join("")}</ol>` : ""}
      ${sim ? `<div class="gsim"><div class="gb-h">Se lo compri a ${pr}</div>
        <div class="gsimrow"><span>Budget residuo</span><b>${sim.residuo[0]} → ${sim.residuo[1]}</b></div><div class="gsimrow"><span>Coerenza</span><b>${sim.coh[0]} → ${sim.coh[1]}</b></div><div class="gsimrow"><span>${RNAME[p.role]}: budget restante</span><b>${sim.roleBudget} FM</b></div><div class="gsimrow"><span>Piano A</span><b>${sim.ok ? "ancora realizzabile" : "non completabile"}</b></div>
        ${sim.targets.map((t) => `<div class="gsimrow"><span>${t.name}</span><b class="${t.ok ? "" : "bad"}">${t.ok ? `ancora acquistabile fino a ${t.limit}` : "diventa incompatibile"}</b></div>`).join("")}
        <div class="gsimv ${sim.ok && sim.coh[1] >= sim.coh[0] - 6 ? "ok" : "warn"}">${sim.verdict}</div></div>` : showSim && !pr ? `<div class="muted" style="font-size:12px;margin-top:6px">Scrivi un prezzo per simulare.</div>` : ""}
      ${actionsHtml()}</div>`;
  }
  const actionsHtml = () => `<div class="gactions" style="grid-template-columns:1fr 1fr"><button class="green" id="gc-mine">✓ L'ho preso io</button><button class="secondary" id="gc-other">✕ Preso da altri</button><button class="secondary" id="gc-skip" style="grid-column:1/-1">⏭ Non mi interessa (non è uscito / lo salto)</button></div><div class="muted" style="font-size:11px;text-align:center;margin-top:6px">il prezzo scritto sopra viene registrato</div>`;

  function strategyPanel(S, plan) {
    const st = STRATS[S.strategy?.key || "fa"], coh = coherence(S), p0 = S.strategy?.plan0 || {};
    const rows = ROLES.map((r) => { const own = S.roster.filter((x) => FA.get(x.id)?.role === r); const spent = own.reduce((a, x) => a + x.price, 0); const upd = spent + (plan.byRole[r]?.budget || 0); const pl = p0[r] ?? upd; const d = upd - pl; return { r, pl, upd, spent, d, done: plan.need[r] === 0 }; });
    const status = rows.map((x) => x.done ? (x.spent <= x.pl ? `✓ ${RNAME[x.r]} completato ${x.spent < x.pl ? "sotto budget" : "in budget"}` : `⚠ ${RNAME[x.r]} completato sopra budget (+${x.spent - x.pl})`) : Math.abs(x.d) <= Math.max(3, x.pl * 0.07) ? `✓ ${RNAME[x.r]} in linea` : x.d > 0 ? `⚠ ${RNAME[x.r]} sopra il piano (+${x.d})` : `✓ ${RNAME[x.r]} sotto il piano (${x.d}): budget liberato`);
    const q = queue(plan); const top = q[0]; if (top) status.push(top.limit >= top.target ? `✓ Budget sufficiente per ${top.p.name} (${top.target})` : `⚠ Budget corto per ${top.p.name}: max ${top.limit} contro target ${top.target}`);
    const goals = [plan.slots.some((s) => s.role === "ATT" && s.tier === "TOP") || S.roster.some((x) => FA.get(x.id)?.role === "ATT" && x.price >= S.budget * 0.14) ? "1 top in attacco" : "attacco di fascia media", `${plan.slots.filter((s) => s.role === "CEN" && s.tier !== "LOW COST").length + S.roster.filter((x) => FA.get(x.id)?.role === "CEN" && x.price >= S.budget * 0.02).length} centrocampisti da titolare`, (plan.byRole.POR?.budget || 0) + S.roster.filter((x) => FA.get(x.id)?.role === "POR").reduce((a, x) => a + x.price, 0) <= S.budget * 0.06 ? "blocco portieri economico" : "portiere di livello"];
    return `<div class="card gpanel"><h3>La tua strategia<span>${st.name}</span></h3>
      <div class="gcoh"><span>Coerenza</span><b>${coh}/100</b><div class="gfitbar"><div style="width:${coh}%"></div></div></div>
      <table class="gbt"><thead><tr><th>Reparto</th><th>Previsto</th><th>Aggiornato</th><th>Speso</th></tr></thead><tbody>${rows.map((x) => `<tr><td>${RNAME[x.r]}</td><td>${x.pl}</td><td class="${x.d > 3 ? "bad" : x.d < -3 ? "good" : ""}">${x.upd}</td><td>${x.spent}</td></tr>`).join("")}</tbody></table>
      <div class="gb-h" style="margin-top:8px">Obiettivi principali</div><div class="gtxt">${goals.join(" · ")}</div>
      <div class="gb-h" style="margin-top:8px">Stato</div>${status.map((x) => `<div class="gtxt">${x}</div>`).join("")}
      <a href="#" id="g-restrat" class="muted" style="font-size:12px;display:block;margin-top:8px">cambia strategia</a></div>`;
  }

  function planHtml(plan, S) {
    const q = queue(plan); const blk = gkBlock(plan); const B = showB ? planB(plan) : null;
    return `<div class="card" id="g-plan"><h3 style="cursor:pointer" id="g-plan-toggle">Piano A · rosa ideale<span>${planOpen ? "nascondi" : "mostra"}</span></h3>
      <div class="gbudget">${ROLES.map((r) => { const own = S.roster.filter((x) => FA.get(x.id)?.role === r); const spent = own.reduce((a, x) => a + x.price, 0); const b = plan.byRole[r]?.budget || 0; return `<div><span>${RNAME[r]}</span><b>${spent + b}</b><small>${spent} spesi + ${b} previsti</small></div>`; }).join("")}
        <div class="tot"><span>Totale</span><b>${S.budget - plan.spare}</b><small>di ${S.budget} FM · minimo per completare ${Math.max(0, plan.total)} FM${plan.spare > 0 ? ` · ${plan.spare} liberi` : ""}</small></div></div>
      ${planOpen ? ROLES.map((r) => { const own = S.roster.filter((x) => FA.get(x.id)?.role === r).map((x) => ({ x, p: FA.get(x.id) })); const slots = plan.slots.filter((s) => s.role === r); if (!own.length && !slots.length) return ""; return `<h4>${RNAME[r]} · ${own.length}/${S.limits[r]} presi</h4>
        ${own.map((o) => `<div class="gslot mine"><div class="gslot-h"><span class="gid ${r}">✓</span><span class="gname" style="margin:0">${o.p?.name || o.x.id} <small>${o.p?.team || ""}</small></span><span class="gtarget">pagato <b>${o.x.price}</b></span></div></div>`).join("")}
        ${slots.map((s) => { const pi = q.indexOf(s); const [pn, pl] = prio(s, pi); return `<div class="gslot" data-id="${s.p.id}"><div class="gslot-h"><span class="gid ${r}">${s.id}</span><span class="gprio p${pn}">P${pn} · ${pl}</span><span class="fatag fascia ${tierClass(s.tier)}">${s.tier}</span><span class="gtarget">target <b>${s.target}</b> · max ${s.limit}</span></div><div class="gname">${s.p.name} <small>${s.p.team}</small>${s.urgency === "alta" ? ` <span class="gurg alta">ora</span>` : ""}</div>${s.alts.length ? `<div class="galts">alternative: ${s.alts.map((a) => `<span data-alt="${a.id}">${a.name}</span>`).join(" · ")}</div>` : ""}</div>`; }).join("")}`; }).join("") : ""}
      ${planOpen && blk ? `<div class="gblock"><div class="gb-h">Blocco portieri · ${blk.team}</div><div class="gtxt">${blk.main.name} max ${blk.max}${blk.mates.map((m) => ` · ${m.name} 1`).join("")} · costo previsto <b>${blk.cost}</b> · affidabilità <b>${blk.fv}/100</b>${blk.alt ? ` · alternativa: blocco ${blk.alt.team} (${blk.alt.name})` : ""}</div><div class="muted" style="font-size:11px">se una riserva va ad altri, il titolare resta: si ricalcola l'affidabilità del blocco</div></div>` : ""}
      <a href="#" id="g-planb" class="muted" style="font-size:12px;display:block;margin-top:10px">${showB ? "nascondi" : "mostra"} Piano B (se perdi gli obiettivi principali) e Piano C</a>
      ${B ? `<div class="gscen"><div class="gb-h">Piano B · senza ${B.lost.map((id) => FA.get(id)?.name).join(" e ")}</div>${B.slots.map((s) => `<div class="gtxt">${s.id} ${s.p.name} <small>${s.p.team}</small> — ${s.target} FM</div>`).join("")}<div class="gtxt muted" style="margin-top:4px">budget: ${ROLES.map((r) => `${RS[r]} ${B.plan.byRole[r]?.budget || 0}`).join(" · ")}</div>
        <div class="gb-h" style="margin-top:8px">Piano C · opportunistico</div><div class="gtxt">Se un top resta ≥ 22% sotto il valore previsto, compralo (compare 🔥 OCCASIONE nella tattica) e ridistribuisci il budget: il piano si ricalcola da solo.</div></div>` : ""}
    </div>`;
  }

  function render() {
    const S = SOLO.get(), box = $("so-guided"); if (!S) return;
    if (!S.strategy) { applyStrategy(S); box.innerHTML = strategyHtml(S); bindStrategy(box, S); return; }
    const plan = compute(), R = plan.budget, done = S.roster.length, tot = SOLO.total();
    if (!S.strategy.plan0) { S.strategy.plan0 = Object.fromEntries(ROLES.map((r) => [r, plan.byRole[r]?.budget || 0])); S.strategy.q0 = plan.quality; SOLO.save(); }
    const mk = plan.market, soldTot = S.sold.length + S.roster.length, availTot = ROLES.reduce((a, r) => a + mk[r].avail, 0), inf = SOLO.infl();
    const coh = coherence(S), qual = Math.min(100, Math.round(100 * plan.quality / Math.max(1e-6, S.strategy.q0 || plan.quality))); const rk = risks(S, plan); const ph = phaseOf(S, mk); const pr = pressure(S, plan); const nm = nextMove(plan, S, pr); const q = queue(plan);
    const infTxt = inf.all.n ? ROLES.map((r) => `${RS[r]} ${inf.byRole[r] ? `${inf.byRole[r].adj > 0 ? "+" : ""}${Math.round(inf.byRole[r].adj * 100)}%` : "n.d."}`).join(" · ") : "ancora nessuna vendita osservata";
    const bannerHtml = banner ? `<div class="gbanner k-${banner.kind}"><div class="gb-t">${banner.title}</div>${banner.lines.map((l) => `<div class="gb-l">${l}</div>`).join("")}
      ${banner.recovery ? `<div class="gb-plan"><div class="gb-h">Piano di recupero</div><ol class="gwhy">${banner.recovery.map((x) => `<li>${x}</li>`).join("")}</ol></div>` : ""}
      ${banner.d && (banner.d.strategy || banner.d.roles.length || (banner.d.scarcity && banner.d.scarcity.length)) ? `<div class="gb-plan"><div class="gb-h">PIANO AGGIORNATO</div>
        ${banner.d.scarcity && banner.d.scarcity.length ? banner.d.scarcity.map((x) => `<div class="gb-l scar">SCARSITÀ ${RNAME[x.r].toUpperCase()} ↑ <small>qualità disponibile per la domanda residua −${Math.round(x.drop * 100)}%</small></div>`).join("") : ""}
        ${banner.d.strategy ? `<div class="gb-l"><b>Cambio di piano</b></div>${banner.d.strategy.map((x) => `<div class="gb-l">${x}</div>`).join("")}` : ""}
        ${banner.d.roles.map((x) => `<div class="gb-l">${RNAME[x.r]} ${x.from} → <b>${x.to}</b> FM <span class="${x.to > x.from ? "up" : "down"}">${x.to > x.from ? "+" : ""}${x.to - x.from}</span></div>`).join("")}</div>` : ""}
      <a href="#" id="gb-close">chiudi</a></div>` : "";
    box.innerHTML = `
      <div class="gstatus"><div><span>Presi</span><b>${done} / ${tot}</b></div><div><span>Residuo</span><b>${R}<small> FM</small></b></div><div><span>Coerenza</span><b>${coh}</b></div><div><span>Qualità rosa</span><b>${qual}</b></div><div><span>Rischio</span><b class="sm">${rk.length >= 3 ? "Alto" : rk.length ? "Medio" : "Basso"}</b></div><div><span>Fase</span><b class="sm">${ph.k}</b></div></div>
      <div class="gnextmove"><div class="gb-h">Prossima mossa</div><div><b>Cerca:</b> ${nm.cerca}</div>${nm.budget ? `<div><b>Budget:</b> ${nm.budget}</div>` : ""}${nm.evita ? `<div><b>Evita:</b> ${nm.evita}</div>` : ""}<div class="muted" style="font-size:11px;margin-top:3px">${ph.msg}${q[0] && pr[q[0].role]?.lvl === "BASSA" ? ` · ${pr[q[0].role].msg}` : ""}</div></div>
      ${calledHtml(plan)}
      ${bannerHtml}
      ${strategyPanel(S, plan)}
      ${planHtml(plan, S)}
      <div class="card"><h3>Mercato della tua asta<span>${S.participants} squadre · fase ${ph.k}</span></h3>
        <div class="gtxt">Venduti <b>${soldTot}</b> (${ROLES.map((r) => `${RS[r]} ${mk[r].soldR}`).join(" · ")}) · disponibili <b>${availTot}</b></div>
        <div class="gtxt">Prezzi vs attese: ${infTxt}</div>${inf.all.n >= 5 && Object.values(inf.byRole).some((x) => x && Math.abs(x.adj) >= 0.08) ? `<div class="gtxt muted">${ROLES.filter((r) => inf.byRole[r] && inf.byRole[r].adj >= 0.08).map((r) => RL[r]).join(", ") || "Alcuni ruoli"} stanno andando sopra le valutazioni: prezzi massimi aggiornati e budget rivisto di conseguenza.</div>` : ""}
        <div class="gb-h" style="margin-top:8px">Pressione competitiva</div>${ROLES.map((r) => `<div class="gtxt"><b>${RNAME[r]}</b>: <span class="gpr ${pr[r].lvl}">${pr[r].lvl}</span> <small>${pr[r].msg}</small></div>`).join("")}
        ${rk.length ? `<div class="gb-h" style="margin-top:8px">Rischi di rosa</div>${rk.map((x) => `<div class="gtxt">⚠ ${x}</div>`).join("")}` : `<div class="gtxt muted" style="margin-top:8px">Nessun rischio strutturale rilevato.</div>`}</div>
      <div class="row"><button class="secondary" id="g-undo" ${S.history.length ? "" : "disabled"}>↩ Annulla ultima azione</button></div>`;
    // eventi
    const bind = (id, fn) => { const e = $(id); if (e) e.onclick = (ev) => { ev.preventDefault(); fn(); }; };
    const gq = $("gc-q"); if (gq) gq.oninput = () => { called.q = gq.value; const pos = gq.selectionStart; SOLO.render(); const e2 = $("gc-q"); if (e2) { e2.focus(); try { e2.setSelectionRange(pos, pos); } catch {} } };
    box.querySelectorAll("[data-gc]").forEach((el) => el.onclick = () => { called = { q: "", id: el.dataset.gc, price: "" }; showWhy = showSim = false; SOLO.render(); window.scrollTo(0, 0); });
    bind("gc-clear", () => { called = { q: "", id: null, price: "" }; SOLO.render(); setTimeout(() => $("gc-q")?.focus(), 30); });
    const gp = $("gc-price"); if (gp) { gp.oninput = () => { called.price = gp.value; SOLO.render(); $("gc-price")?.focus(); }; gp.onkeydown = (e) => { if (e.key === "Enter") $("gc-mine")?.click(); }; }
    box.querySelectorAll(".gcalled .quick button").forEach((b) => b.onclick = () => { called.price = String((parseInt(called.price, 10) || 0) + Number(b.dataset.d)); SOLO.render(); });
    bind("gc-mine", () => { const v = parseInt(called.price, 10); if (!v || v < 1) { const a = prompt("Prezzo pagato (FM)", ""); const n = parseInt(a, 10); if (!n) return; commit("roster", called.id, n); return; } commit("roster", called.id, v); });
    bind("gc-other", () => commit("sold", called.id, parseInt(called.price, 10) || 0));
    bind("gc-skip", () => commit("excluded", called.id));
    bind("gc-why", () => { showWhy = !showWhy; SOLO.render(); }); bind("gc-sim", () => { showSim = !showSim; SOLO.render(); });
    bind("g-undo", undo); bind("gb-close", () => { banner = null; SOLO.render(); });
    bind("g-plan-toggle", () => { planOpen = !planOpen; SOLO.render(); }); bind("g-planb", () => { showB = !showB; SOLO.render(); });
    bind("g-restrat", () => { if (confirm("Cambiare strategia? Il piano viene ricalcolato; rosa e budget restano.")) { delete S.strategy; SOLO.save(); SOLO.render(); } });
    box.querySelectorAll(".gslot[data-id]").forEach((el) => el.onclick = (ev) => { if (ev.target.dataset.alt) return; called = { q: "", id: el.dataset.id, price: "" }; SOLO.render(); window.scrollTo(0, 0); });
    box.querySelectorAll("[data-alt]").forEach((el) => el.onclick = (ev) => { ev.stopPropagation(); called = { q: "", id: el.dataset.alt, price: "" }; SOLO.render(); window.scrollTo(0, 0); });
  }
  function bindStrategy(box, S) {
    box.querySelectorAll("[data-pick]").forEach((b) => b.onclick = () => {
      const key = b.dataset.pick; const share = {}; if (key === "cust") { let tot = 0; ROLES.forEach((r) => { share[r] = Math.max(0, parseInt(box.querySelector(`[data-share=${r}]`).value, 10) || 0); tot += share[r]; }); if (!tot) return; ROLES.forEach((r) => (share[r] = share[r] / tot)); }
      S.strategy = { key, share: key === "cust" ? share : null }; SOLO.save(); lastPlan = null; SOLO.render(); window.scrollTo(0, 0);
    });
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
    .gq .rl{width:32px;flex-basis:32px;font-size:11px}
    .gfit{margin-top:12px}
    .gfitbar{height:10px;border-radius:5px;background:rgba(255,255,255,.12);overflow:hidden}
    .gfitbar div{height:100%;background:linear-gradient(90deg,#ff5d5d,#e0a63a 55%,#34d17f);border-radius:5px}
    .gfitlab{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:4px} .gfitlab b{color:#fff;font-family:var(--display);font-size:18px}
    .gnext{font-size:13px;color:var(--muted);margin:2px 0 8px} .gnext b{color:#fff} .gnext small{font-size:12px}
    .gslot.mine{opacity:.85;cursor:default} .gslot.mine .gname{font-size:14px}
    .gcalled input#gc-q{margin-top:6px}`;
  document.head.appendChild(st);

  return { RW, STRATS, render, optimize, compute, commit, undo, quality, market, evaluateCalled, simulate, coherence, getPlan: () => lastPlan, openPlan: (v) => { planOpen = v; }, setCalled: (id, price) => { called = { q: "", id, price: price || "" }; showWhy = showSim = false; }, setFlags: (w, s, b) => { showWhy = !!w; showSim = !!s; if (b !== undefined) showB = !!b; }, reset: () => { lastPlan = null; banner = null; called = { q: "", id: null, price: "" }; showWhy = showSim = showB = false; planOpen = true; } };
})();

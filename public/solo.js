// Modalità "In solitaria": Fantalgoritmo come copilota durante un'asta che si svolge altrove.
// Stato salvato in localStorage (sopravvive a chiusura del browser). Nessun server coinvolto.
(() => {
  const $ = (id) => document.getElementById(id);
  const ROLES = ["POR", "DIF", "CEN", "ATT"];
  const RL = FA.ROLE_LABEL, RS = FA.ROLE_SHORT;
  const KEY = "fantasta_solo";
  let S = JSON.parse(localStorage.getItem(KEY) || "null"); // { budget, limits, roster:[{id,price}], sold:[{id,price}], step }
  const save = () => localStorage.setItem(KEY, JSON.stringify(S));
  let sel = null, cmpA = null, cmpB = null, tab = "asta";

  const root = $("s-solo");
  root.innerHTML = `
  <div class="topbar"><span><a href="#" id="so-home" style="color:var(--muted);text-decoration:none">‹ Home</a> · In solitaria</span><span id="so-meta"></span></div>
  <div id="so-setup">
    <div class="kicker">Copilota d'asta</div>
    <h1>In <em>solitaria</em></h1>
    <div class="card">
      <label>Fantamilioni iniziali</label><input id="so-budget" type="number" min="1" value="500">
      <label>Composizione della rosa</label>
      <div class="row">${ROLES.map((r, i) => `<div><input id="so-l-${r}" type="number" min="0" value="${[3, 8, 8, 6][i]}"><div class="muted" style="font-size:11px;text-align:center;margin-top:3px">${RL[r]}</div></div>`).join("")}</div>
      <button id="so-start">Inizia</button>
      <div class="err" id="so-err"></div>
    </div>
    <p class="muted">Durante l'asta cerchi il giocatore chiamato, scrivi il prezzo raggiunto e Fantalgoritmo ti dice fino a quanto rilanciare. Registri gli acquisti tuoi e degli altri: budget, rosa e inflazione dell'asta si aggiornano da soli.</p>
  </div>
  <div id="so-main" class="hidden">
    <div class="stats" style="grid-template-columns:1fr 1fr 1fr 1fr 1fr">
      <div style="grid-column:span 1"><span>Residuo</span><b id="so-res"></b></div>
      ${ROLES.map((r) => `<div><span>${RS[r]}</span><b id="so-s-${r}"></b></div>`).join("")}
    </div>
    <div class="tabs small" id="so-tabs">
      <button class="on" data-t="asta">Asta</button><button data-t="rosa">Rosa</button><button data-t="cerca">Cerca</button><button data-t="confronto">Confronto</button><button data-t="andamento">Andamento</button>
    </div>
    <div id="so-asta">
      <div class="tabs small" id="so-rf"><button class="on" data-r="ALL">Tutti</button>${ROLES.map((r) => `<button data-r="${r}">${RS[r]}</button>`).join("")}</div>
      <input id="so-q" placeholder="Cerca il giocatore chiamato…" autocomplete="off">
      <div class="card tight hidden" id="so-results"></div>
      <div id="so-card"></div>
    </div>
    <div id="so-rosa" class="hidden roster"></div>
    <div id="so-cerca" class="hidden roster">
      <div class="card"><h3 style="margin-bottom:4px">Chi posso comprare?</h3>
        <div class="row"><div><label>Ruolo</label><select id="so-c-role">${ROLES.map((r) => `<option value="${r}">${RL[r]}</option>`).join("")}</select></div><div><label>Budget massimo (FM)</label><input id="so-c-max" type="number" min="1" placeholder="es. 80"></div></div>
        <button class="secondary" id="so-c-go">Cerca i migliori disponibili</button>
      </div>
      <div class="card tight hidden" id="so-c-res"></div>
    </div>
    <div id="so-confronto" class="hidden">
      <div class="card"><label>Giocatore A</label><input id="so-cmp-a" placeholder="Cerca…" autocomplete="off"><div class="card tight hidden" id="so-cmp-ra"></div>
      <label>Giocatore B</label><input id="so-cmp-b" placeholder="Cerca…" autocomplete="off"><div class="card tight hidden" id="so-cmp-rb"></div></div>
      <div id="so-cmp-out"></div>
    </div>
    <div id="so-andamento" class="hidden roster"></div>
    <button class="secondary" id="so-reset" style="margin-top:20px">Nuova asta (azzera tutto)</button>
  </div>`;

  // ---------- helpers ----------
  const total = () => ROLES.reduce((a, r) => a + S.limits[r], 0);
  const spent = () => S.roster.reduce((a, x) => a + x.price, 0);
  const residuo = () => S.budget - spent();
  const isAvail = (id) => !S.roster.some((x) => x.id === id) && !S.sold.some((x) => x.id === id);
  const me = () => ({ budget: residuo(), limits: S.limits, roster: S.roster.map((x) => ({ ...x, role: FA.get(x.id)?.role })) });
  const infl = () => FA.inflation(S.sold.concat(S.roster), S.budget);
  const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const search = (q, role) => { q = norm(q.trim()); if (q.length < 2) return []; return FA.players().filter((p) => (role === "ALL" || p.role === role) && (norm(p.name).includes(q) || norm(p.team).includes(q) || (p.faName && norm(p.faName).includes(q)))).sort((a, b) => (b.fa?.ia || 0) - (a.fa?.ia || 0)).slice(0, 12); };
  const row = (p, extra = "") => `<div class="lrow" data-id="${p.id}" style="cursor:pointer"><span class="rl ${p.role}">${RS[p.role]}</span><span class="nm">${p.name}<small>${p.team}</small></span><span class="st">${extra}</span><span class="cost">${FA.value(p, S.budget) ?? "—"}</span></div>`;
  const statusOf = (id) => S.roster.some((x) => x.id === id) ? "mio" : S.sold.some((x) => x.id === id) ? "venduto" : "";

  // ---------- setup ----------
  $("so-start").onclick = () => {
    const budget = parseInt($("so-budget").value, 10), limits = {};
    ROLES.forEach((r) => (limits[r] = Math.max(0, parseInt($("so-l-" + r).value, 10) || 0)));
    if (!budget || budget < 1 || !Object.values(limits).some((v) => v > 0)) return ($("so-err").textContent = "Inserisci budget e composizione validi");
    S = { budget, limits, roster: [], sold: [] }; save(); render();
  };
  $("so-reset").onclick = () => { if (confirm("Azzerare rosa, prezzi registrati e impostazioni?")) { S = null; localStorage.removeItem(KEY); sel = null; render(); } };
  $("so-home").onclick = (e) => { e.preventDefault(); window.showHome(); };

  // ---------- tabs ----------
  document.querySelectorAll("#so-tabs button").forEach((b) => b.onclick = () => { tab = b.dataset.t; document.querySelectorAll("#so-tabs button").forEach((x) => x.classList.toggle("on", x === b)); render(); });
  let rf = "ALL";
  document.querySelectorAll("#so-rf button").forEach((b) => b.onclick = () => { rf = b.dataset.r; document.querySelectorAll("#so-rf button").forEach((x) => x.classList.toggle("on", x === b)); showResults(); });
  $("so-q").oninput = showResults;
  function showResults() {
    const rows = search($("so-q").value, rf), box = $("so-results");
    box.classList.toggle("hidden", !rows.length);
    box.innerHTML = rows.map((p) => row(p, statusOf(p.id))).join("");
    box.querySelectorAll(".lrow").forEach((el) => el.onclick = () => { sel = el.dataset.id; $("so-q").value = ""; box.classList.add("hidden"); render(); });
  }

  // ---------- scheda giocatore + verdetto ----------
  let price = "";
  function renderCard() {
    const p = FA.get(sel), box = $("so-card");
    if (!p) return (box.innerHTML = `<div class="waiting">Cerca il giocatore appena chiamato all'asta</div>`);
    const st = statusOf(p.id), inf = infl(), m = me();
    const L = FA.limitFor(p, m, inf, isAvail), v = L.value, tc = window.TEAM_COLORS?.[p.team] || ["#34d17f", "#0b2418", "#fff"];
    const pr = parseInt(price, 10) || 0;
    const vd = pr ? FA.verdict(pr, L.limit) : null, fair = pr ? FA.fairness(pr, v) : null;
    const VD = { buy: ["🟢 COMPRA / RILANCIA", "buy"], near: ["🟠 VICINO AL LIMITE", "near"], leave: ["🔴 LASCIA", "leave"], no: ["⛔ NON TI SERVE", "leave"] };
    const FR = { affare: "🟢 AFFARE", corretto: "⚪ PREZZO CORRETTO", caro: "🟠 CARO", sovraprezzato: "🔴 SOVRAPREZZATO" };
    let planB = "";
    if (vd === "leave" || vd === "no" || (pr && L.limit && pr > L.limit)) {
      const alts = FA.players().filter((x) => x.role === p.role && x.id !== p.id && x.fa && isAvail(x.id)).map((x) => ({ x, lim: FA.limitFor(x, m, inf, isAvail).limit, v: FA.adjValue(x, S.budget, inf) }))
        .filter((a) => a.lim > 0 && a.v <= Math.max(L.limit, 1) * 1.15 && a.v >= Math.max(1, (v || L.limit) * 0.35)).sort((a, b) => (b.x.fa.ia - a.x.fa.ia) || (b.v - a.v)).slice(0, 4);
      if (alts.length) planB = `<div class="planb"><div class="planb-h">PIANO B</div>${alts.map((a, i) => `<div class="lrow" data-id="${a.x.id}" style="cursor:pointer"><span class="rl ${a.x.role}">${i + 1}</span><span class="nm">${a.x.name}<small>${a.x.team}${a.x.fa.fascia ? " · " + a.x.fa.fascia : ""}</small></span><span class="st">IA ${a.x.fa.ia}</span><span class="cost">${Math.min(a.v, a.lim)}</span></div>`).join("")}<div class="muted" style="font-size:11px;margin-top:4px">target FM per ciascuno</div></div>`;
    }
    box.innerHTML = `
      <a href="#" class="back" id="so-back">‹ Cerca un altro giocatore</a>
      <div class="card player" style="--t1:${tc[0]};--t2:${tc[1]};--tink:${tc[2]};padding-top:22px">
        <div class="name">${p.name}</div>
        <div class="meta"><span class="team">${p.team}</span> <span class="role ${p.role}">${RL[p.role]}</span>${p.fa?.fascia ? ` <span class="fatag fascia ${FA.fasciaClass(p.fa.fascia)}">${p.fa.fascia}</span>` : ""}</div>
        ${st ? `<div class="notice" style="margin-top:12px">${st === "mio" ? "È già nella tua rosa" : "Già venduto in questa asta"}</div>` : `
        <div class="fagrid" style="margin-top:16px">
          <div class="fakpi big"><span>Valore Fantalgoritmo</span><b>${v != null ? v + " FM" : "—"}</b>${v != null && inf.all.n ? `<small>${FA.value(p, S.budget)} base${inf.all.adj ? ` · ${inf.all.adj > 0 ? "+" : ""}${Math.round(inf.all.adj * 100)}% asta` : ""}</small>` : ""}</div>
          <div class="fakpi big lim"><span>Tuo limite consigliato</span><b>${L.limit} FM</b><small>${L.reason}</small></div>
        </div>
        <div class="pricebox">
          <input id="so-price" type="number" inputmode="numeric" placeholder="Prezzo attuale" value="${price}">
          <div class="quick">${[1, 5, 10].map((n) => `<button data-d="${n}">+${n}</button>`).join("")}</div>
        </div>
        ${vd ? `<div class="verdict ${VD[vd][1]}">${VD[vd][0]}</div>` : `<div class="muted" style="font-size:13px;margin-top:10px">Scrivi il prezzo raggiunto per avere il verdetto</div>`}
        ${fair ? `<div class="fair">${FR[fair]} <small>rispetto al valore Fantalgoritmo</small></div>` : ""}
        ${planB}
        <div class="row" style="margin-top:14px"><button class="green" id="so-buy">L'ho comprato</button><button class="secondary" id="so-other">Venduto ad altro</button></div>`}
      </div>
      ${FA.cardHtml(p, S.budget)}`;
    if (!st) {
      const inp = $("so-price");
      inp.oninput = () => { price = inp.value; renderCard(); $("so-price").focus(); };
      box.querySelectorAll(".quick button").forEach((b) => b.onclick = () => { price = String((parseInt(price, 10) || 0) + Number(b.dataset.d)); renderCard(); });
      $("so-buy").onclick = () => record("roster");
      $("so-other").onclick = () => record("sold");
    }
    box.querySelectorAll(".planb .lrow").forEach((el) => el.onclick = () => { sel = el.dataset.id; price = ""; render(); });
    $("so-back").onclick = (e) => { e.preventDefault(); sel = null; price = ""; render(); setTimeout(() => $("so-q").focus(), 50); };
  }
  function record(kind) {
    const p = FA.get(sel); let pr = parseInt(price, 10);
    if (!pr || pr < 1) { const a = prompt(`Prezzo finale di ${p.name} (FM)`, price || ""); pr = parseInt(a, 10); if (!pr || pr < 1) return; }
    if (kind === "roster") {
      const r = p.role, have = S.roster.filter((x) => FA.get(x.id)?.role === r).length;
      if (have >= S.limits[r] && !confirm(`Hai già ${have} ${RL[r].toLowerCase()} su ${S.limits[r]}. Registrare comunque?`)) return;
      if (pr > residuo() && !confirm(`Supera il budget residuo (${residuo()} FM). Registrare comunque?`)) return;
    }
    S[kind].push({ id: p.id, price: pr, t: Date.now() }); save();
    if (kind === "roster" && window.fireworks) window.fireworks(1800);
    sel = null; price = ""; render();
  }

  // ---------- rosa ----------
  function renderRosa() {
    const r = residuo(), pl = FA.plan(me(), infl(), isAvail);
    const groups = ROLES.map((ro) => {
      const rows = S.roster.map((x) => ({ ...x, p: FA.get(x.id) })).filter((x) => x.p?.role === ro).sort((a, b) => b.price - a.price);
      return `<h4>${RL[ro]} · ${rows.length}/${S.limits[ro]}</h4>${rows.length ? `<ul>${rows.map((x) => `<li><span>${x.p.name}<span class="t">${x.p.team}</span></span><span>${x.price} FM <a href="#" data-undo="${x.id}" class="undo">✕</a></span></li>`).join("")}</ul>` : `<div class="muted" style="font-size:13px">—</div>`}`;
    }).join("");
    $("so-rosa").innerHTML = `<div class="card"><h3>La mia rosa<span>${S.roster.length}/${total()} · spesi ${spent()} FM</span></h3>${groups}<p style="margin:12px 0 0"><b>Budget residuo: ${r} FM</b></p></div>
      ${distribHtml(pl, r)}`;
    $("so-rosa").querySelectorAll(".undo").forEach((a) => a.onclick = (e) => { e.preventDefault(); if (confirm("Rimuovere dalla rosa?")) { S.roster = S.roster.filter((x) => x.id !== a.dataset.undo); save(); render(); } });
  }
  function distribHtml(pl, r) {
    if (!pl.total) return `<div class="card"><h3>Rosa completa</h3><div class="muted">Hai riempito tutti gli slot.</div></div>`;
    return `<div class="card"><h3>Distribuzione consigliata<span>${r} FM per ${pl.total} giocatori</span></h3>
      ${ROLES.filter((ro) => pl.left[ro]).map((ro) => `<div class="lrow"><span class="rl ${ro}">${RS[ro]}</span><span class="nm">${pl.left[ro]} ${RL[ro].toLowerCase()}</span><span class="st">≈ ${Math.round(pl.quota[ro] / pl.left[ro])} FM ciascuno</span><span class="cost">${pl.quota[ro]}</span></div>`).join("")}
      <div class="muted" style="font-size:12px;margin-top:8px">Ripartizione proporzionale al valore dei giocatori ancora disponibili per ruolo; è la base del "tuo limite consigliato".</div></div>`;
  }

  // ---------- chi posso comprare ----------
  $("so-c-go").onclick = () => {
    const role = $("so-c-role").value, max = parseInt($("so-c-max").value, 10) || residuo(), inf = infl(), m = me();
    const rows = FA.players().filter((p) => p.role === role && p.fa && isAvail(p.id)).map((p) => ({ p, v: FA.adjValue(p, S.budget, inf), lim: FA.limitFor(p, m, inf, isAvail).limit })).filter((a) => a.v != null && a.v <= max).sort((a, b) => (b.p.fa.ia - a.p.fa.ia) || (b.v - a.v)).slice(0, 25);
    const box = $("so-c-res"); box.classList.remove("hidden");
    box.innerHTML = rows.length ? `<div class="muted" style="padding:8px 0 4px">${rows.length} ${RL[role].toLowerCase()} disponibili entro ${max} FM, per indice IA</div>` + rows.map((a) => `<div class="lrow" data-id="${a.p.id}" style="cursor:pointer"><span class="rl ia ${a.p.role}">${Math.round(a.p.fa.ia)}</span><span class="nm">${a.p.name}<small>${a.p.team}${a.p.fa.fascia ? " · " + a.p.fa.fascia : ""}</small></span><span class="st">limite <b>${a.lim}</b></span><span class="cost">${a.v}</span></div>`).join("") : `<div class="muted" style="padding:10px 0">Nessun giocatore disponibile entro quel budget</div>`;
    box.querySelectorAll(".lrow").forEach((el) => el.onclick = () => { sel = el.dataset.id; price = ""; tab = "asta"; document.querySelectorAll("#so-tabs button").forEach((x) => x.classList.toggle("on", x.dataset.t === "asta")); render(); });
  };

  // ---------- confronto ----------
  const bindCmp = (inp, res, setter) => {
    $(inp).oninput = () => { const rows = search($(inp).value, "ALL"), box = $(res); box.classList.toggle("hidden", !rows.length); box.innerHTML = rows.map((p) => row(p, statusOf(p.id))).join(""); box.querySelectorAll(".lrow").forEach((el) => el.onclick = () => { setter(el.dataset.id); $(inp).value = FA.get(el.dataset.id).name; box.classList.add("hidden"); renderCmp(); }); };
  };
  bindCmp("so-cmp-a", "so-cmp-ra", (id) => (cmpA = id)); bindCmp("so-cmp-b", "so-cmp-rb", (id) => (cmpB = id));
  function renderCmp() {
    const a = FA.get(cmpA), b = FA.get(cmpB), out = $("so-cmp-out");
    if (!a || !b) return (out.innerHTML = `<div class="waiting">Scegli due giocatori</div>`);
    const inf = infl(), m = me();
    const rowsDef = [
      ["Valore FA", (p) => FA.adjValue(p, S.budget, inf), true], ["Tuo limite", (p) => FA.limitFor(p, m, inf, isAvail).limit, true], ["Indice IA", (p) => p.fa?.ia, true],
      ["Fascia", (p) => p.fa?.fascia], ["Affidabilità", (p) => (p.fa?.fv != null ? Math.round(p.fa.fv * 100) + "%" : null)], ["Trend mercato", (p) => (p.fa?.trM == null ? null : p.fa.trM > 0 ? "↑" : p.fa.trM < 0 ? "↓" : "→")],
      ["Presenze", (p) => p.fa?.pg, true], ["Media voto", (p) => p.fa?.media, true], ["Fantamedia", (p) => p.fa?.fmed, true], ["Gol", (p) => p.fa?.gol, true], ["Assist", (p) => p.fa?.ass, true], ["Note", (p) => [p.fa?.note, p.fa?.sos].filter(Boolean).join(" · ")],
    ];
    let sa = 0, sb = 0;
    const tr = rowsDef.map(([l, f, num]) => { const va = f(a), vb = f(b); let ca = "", cb = ""; if (num && va != null && vb != null && va !== vb && l !== "Tuo limite") { if (va > vb) { ca = "win"; } else { cb = "win"; } } return `<tr><td class="${ca}">${va ?? "—"}</td><th>${l}</th><td class="${cb}">${vb ?? "—"}</td></tr>`; }).join("");
    const ia = (p) => p.fa?.ia || 0, best = ia(a) === ia(b) ? ((FA.adjValue(a, S.budget, inf) || 0) <= (FA.adjValue(b, S.budget, inf) || 0) ? a : b) : ia(a) > ia(b) ? a : b;
    out.innerHTML = `<div class="card"><table class="cmp"><thead><tr><th>${a.name}<br><small>${a.team}</small></th><th></th><th>${b.name}<br><small>${b.team}</small></th></tr></thead><tbody>${tr}</tbody></table>
      <div class="verdict buy" style="margin-top:12px">Secondo Fantalgoritmo: <b>${best.name}</b></div>
      <div class="muted" style="font-size:12px;margin-top:6px">Criterio: indice IA più alto; a parità, valore più conveniente.</div></div>`;
  }

  // ---------- andamento ----------
  function renderAndamento() {
    const inf = infl(), all = S.sold.concat(S.roster).map((x) => ({ ...x, p: FA.get(x.id) })).sort((a, b) => b.t - a.t);
    const pct = (o) => (o && o.n ? `${o.raw > 0 ? "+" : ""}${Math.round(o.raw * 100)}%` : "—");
    const applied = (o) => (o && o.n ? `${o.adj > 0 ? "+" : ""}${Math.round(o.adj * 100)}%` : "—");
    $("so-andamento").innerHTML = `<div class="card"><h3>Inflazione asta<span>${inf.all.n} vendite con valore FA</span></h3>
      <div class="fagrid"><div class="fakpi big"><span>Osservata</span><b>${pct(inf.all)}</b><small>prezzi reali vs valori Fantalgoritmo</small></div><div class="fakpi big lim"><span>Applicata ai valori</span><b>${applied(inf.all)}</b><small>prudente: pesa ${inf.all.n ? Math.round((inf.all.n / (inf.all.n + 8)) * 100) : 0}% del campione</small></div></div>
      <div class="chips" style="margin-top:10px">${ROLES.map((r) => `<span class="${r}">${RS[r]} ${inf.byRole[r] ? pct(inf.byRole[r]) : "n.d."}</span>`).join("")}</div>
      <div class="muted" style="font-size:12px">Per ruolo serve un campione di almeno 5 vendite.</div></div>
      ${distribHtml(FA.plan(me(), inf, isAvail), residuo())}
      <div class="card tight"><div class="muted" style="padding:8px 0 4px">Prezzi registrati (${all.length})</div>${all.map((x) => { const v = FA.value(x.p, S.budget); return `<div class="lrow"><span class="rl ${x.p.role}">${RS[x.p.role]}</span><span class="nm">${x.p.name}<small>${x.p.team}${S.roster.includes(x) || S.roster.some((r) => r.id === x.id) ? " · mio" : ""}</small></span><span class="st">${v != null ? `FA ${v} · ${x.price > v ? "+" : ""}${Math.round(((x.price - v) / v) * 100)}%` : "senza valore FA"}</span><span class="cost">${x.price}</span></div>`; }).join("") || `<div class="muted" style="padding:10px 0">Nessuna vendita registrata</div>`}</div>`;
  }

  // ---------- render ----------
  function render() {
    $("so-setup").classList.toggle("hidden", !!S); $("so-main").classList.toggle("hidden", !S);
    if (!S) return;
    $("so-meta").textContent = `${S.budget} FM · ${ROLES.map((r) => S.limits[r]).join("-")}`;
    $("so-res").innerHTML = residuo() + "<small> FM</small>";
    ROLES.forEach((r) => { const have = S.roster.filter((x) => FA.get(x.id)?.role === r).length; $("so-s-" + r).innerHTML = `${have}<small>/${S.limits[r]}</small>`; });
    ["asta", "rosa", "cerca", "confronto", "andamento"].forEach((t) => $("so-" + t).classList.toggle("hidden", t !== tab));
    if (tab === "asta") { renderCard(); $("so-q").classList.toggle("hidden", !!sel); $("so-rf").classList.toggle("hidden", !!sel); if (!sel) $("so-results").classList.add("hidden"); } if (tab === "rosa") renderRosa(); if (tab === "confronto") renderCmp(); if (tab === "andamento") renderAndamento();
  }
  window.showSolo = () => { FA.load().then(render); };
})();

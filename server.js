// FantAsta beta — server unico, nessuna dipendenza esterna (solo Node.js >= 18)
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = process.env.PORT || 3000;
const PLAYERS = JSON.parse(fs.readFileSync(path.join(__dirname, "players.json"), "utf8"));
const NEXT_DELAY = 4000; // ms tra aggiudicazione e prossima estrazione
const ROLE_ORDER = ["POR", "DIF", "CEN", "ATT"]; // ordine delle fasi d'asta
const DEFAULT_LIMITS = { POR: 3, DIF: 8, CEN: 8, ATT: 6 }; // composizione rosa di default (configurabile per stanza)

const totalSlots = (room) => Object.values(room.limits).reduce((a, b) => a + b, 0);
const countRole = (p, role) => p.roster.filter((x) => x.role === role).length;
const slotsLeft = (room, p) => totalSlots(room) - p.roster.length;
// offerta massima: deve restare almeno 1 M per ogni slot ancora da riempire dopo questo
const maxBid = (room, p) => p.budget - (slotsLeft(room, p) - 1);
const needsRole = (room, p, role) => countRole(p, role) < room.limits[role] && maxBid(room, p) >= 1;

// ruolo corrente: il primo dell'ordine che serve ancora ad almeno un partecipante.
// se il mazzo di quel ruolo è vuoto, i calciatori scartati (skip) tornano in gioco.
function currentRole(room) {
  for (const r of ROLE_ORDER) {
    if (!room.participants.some((p) => needsRole(room, p, r))) continue;
    if (!room.pool.some((p) => p.role === r)) {
      const back = room.skipped.filter((p) => p.role === r);
      if (!back.length) continue;
      room.skipped = room.skipped.filter((p) => p.role !== r);
      room.pool.push(...back);
    }
    return r;
  }
  return null;
}
// durata del timer per il calciatore in asta (dipende dal ruolo)
const timerFor = (room) => room.timers[room.current?.player?.role] || 8;

// chi può partecipare all'asta del calciatore corrente
const eligible = (room) => room.current ? room.participants.filter((p) => needsRole(room, p, room.current.player.role)) : [];

const rooms = {}; // code -> room

// ---------- utilità ----------
const rnd = (n) => Math.floor(Math.random() * n);
const code = (len, chars) => Array.from({ length: len }, () => chars[rnd(chars.length)]).join("");
const roomCode = () => code(4, "ABCDEFGHJKLMNPQRSTUVWXYZ");
const token = () => code(24, "abcdefghijklmnopqrstuvwxyz0123456789");
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "") || "user";

function json(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((ok) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } });
  });
}

// ---------- stato pubblico ----------
function publicState(room) {
  return {
    code: room.code,
    league: room.league,
    status: room.status, // lobby | live | paused | ended
    timerSeconds: timerFor(room),
    timers: room.timers,
    skippedList: room.skipped.map((p) => p.name + "|" + p.team + "|" + p.role),
    limits: room.limits,
    budget: room.budget,
    callMode: room.callMode,
    waitingCall: room.status === "live" && !room.current && room.callMode === "master",
    participants: room.participants.map((p) => ({
      name: p.name, username: p.username, budget: p.budget, online: p.online > 0,
      roster: p.roster, maxBid: Math.max(0, maxBid(room, p)),
      eligible: room.current ? needsRole(room, p, room.current.player.role) : false,
    })),
    current: room.current
      ? {
          player: room.current.player,
          bid: room.current.bid,
          bidder: room.current.bidder,
          timeLeft: room.current.timeLeft,
          sold: room.current.sold || false,
          skipped: room.current.skipped || false,
          skips: [...room.current.skips],
          eligibleCount: eligible(room).length,
          offlineCount: eligible(room).filter((p) => p.online <= 0).length,
          autoActive: Object.keys(room.current.auto || {}).filter((u) => room.current.auto[u] > 0),
        }
      : null,
    remaining: room.pool.length,
    lastAward: room.lastAward ? { name: room.lastAward.player.name, winner: room.lastAward.winner.name, price: room.lastAward.price } : null,
    phase: currentRole(room),
    phaseRemaining: room.pool.filter((p) => p.role === currentRole(room)).length,
    log: room.log.slice(-8),
  };
}

function broadcast(room) {
  const data = `data: ${JSON.stringify(publicState(room))}\n\n`;
  for (const c of room.clients) c.write(data);
}

// ---------- logica asta ----------
function drawNext(room, forceRandom = false) {
  clearTimeout(room.nextTimer);
  if (room.status === "ended") { room.current = null; return broadcast(room); }
  const role = currentRole(room);
  if (!role) { room.current = null; room.status = "ended"; return broadcast(room); } // nessuno ha più slot da riempire
  if (room.callMode === "master" && !forceRandom) { room.current = null; return broadcast(room); } // attende la chiamata del master
  // estrazione casuale limitata al ruolo della fase corrente
  const candidates = room.pool.map((p, i) => (p.role === role ? i : -1)).filter((i) => i >= 0);
  const idx = candidates[rnd(candidates.length)];
  putUp(room, room.pool.splice(idx, 1)[0]);
}

// mette all'asta un calciatore
function putUp(room, player) {
  room.current = { player, bid: 0, bidder: null, timeLeft: null, sold: false, skipped: false, skips: new Set(), auto: {} };
  broadcast(room);
  checkAllSkipped(room); // se nessuno può partecipare, passa oltre da solo
}

// nessuna offerta e tutti gli aventi diritto hanno passato → calciatore scartato
function checkAllSkipped(room) {
  const c = room.current;
  if (!c || c.sold || c.skipped || c.bid > 0) return;
  const el = eligible(room);
  // chi non è collegato conta come se avesse passato
  if (el.every((p) => c.skips.has(p.username) || p.online <= 0)) {
    c.skipped = true;
    room.skipped.push(c.player);
    room.log.push(`${c.player.name} → nessuna offerta, scartato`);
    broadcast(room);
    room.nextTimer = setTimeout(() => drawNext(room), 1500);
  }
}

function stopTicker(room) { clearInterval(room.ticker); room.ticker = null; }

function startTicker(room) {
  stopTicker(room);
  room.ticker = setInterval(() => {
    if (room.status !== "live" || !room.current || room.current.timeLeft == null) return;
    room.current.timeLeft -= 1;
    if (room.current.timeLeft <= 0) {
      room.current.timeLeft = 0;
      stopTicker(room);
      award(room);
    } else broadcast(room);
  }, 1000);
}

function award(room) {
  const c = room.current;
  const winner = room.participants.find((p) => p.username === c.bidder);
  if (winner) {
    winner.budget -= c.bid;
    winner.roster.push({ ...c.player, price: c.bid });
    room.lastAward = { player: c.player, winner, price: c.bid };
    room.log.push(`${c.player.name} → ${winner.name} per ${c.bid} M`);
  }
  c.sold = true;
  broadcast(room);
  room.nextTimer = setTimeout(() => drawNext(room), NEXT_DELAY);
}

// rilanci automatici: chi ha impostato un massimo rilancia di 1 finché non lo raggiunge
function runAutoBids(room) {
  const c = room.current;
  if (!c || c.sold || c.skipped || room.status !== "live") return;
  for (let guard = 0; guard < 5000; guard++) {
    const cands = room.participants.filter((p) => (c.auto[p.username] || 0) >= c.bid + 1 && p.username !== c.bidder && needsRole(room, p, c.player.role) && maxBid(room, p) >= c.bid + 1);
    if (!cands.length) break;
    cands.sort((a, b) => c.auto[b.username] - c.auto[a.username]);
    const p = cands[0];
    c.bid += 1; c.bidder = p.username; c.timeLeft = timerFor(room);
  }
  if (c.bid > 0) startTicker(room);
}

function placeBid(room, user, amount) {
  if (room.status !== "live") return "L'asta non è in corso";
  const c = room.current;
  if (!c || c.sold || c.skipped) return "Nessun calciatore in asta";
  if (!Number.isInteger(amount) || amount < 1) return "Offerta non valida";
  if (amount <= c.bid) return `Devi offrire più di ${c.bid} M`;
  if (countRole(user, c.player.role) >= room.limits[c.player.role]) return `Hai già ${room.limits[c.player.role]} ${c.player.role === "POR" ? "portieri" : c.player.role === "DIF" ? "difensori" : c.player.role === "CEN" ? "centrocampisti" : "attaccanti"}`;
  if (amount > user.budget) return `Budget insufficiente (hai ${user.budget} M)`;
  if (amount > maxBid(room, user)) return `Devi tenere 1 M per ogni giocatore mancante: massimo ${maxBid(room, user)} M`;
  if (c.bidder === user.username) return "Sei già il miglior offerente";
  c.bid = amount;
  c.bidder = user.username;
  c.timeLeft = timerFor(room);
  startTicker(room);
  runAutoBids(room);
  broadcast(room);
  return null;
}

// ---------- auth ----------
function auth(room, tok) {
  if (!room) return null;
  if (tok && tok === room.masterToken) return { master: true };
  const p = room.participants.find((x) => x.token === tok);
  return p ? { master: false, user: p } : null;
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  // --- API ---
  if (p === "/api/create" && req.method === "POST") {
    const b = await readBody(req);
    const names = (b.participants || []).map((s) => String(s).trim()).filter(Boolean);
    const budget = parseInt(b.budget, 10);
    const defaults = { POR: 8, DIF: 10, CEN: 12, ATT: 15 };
    const timers = {};
    for (const r of ROLE_ORDER) { const v = parseInt((b.timers || {})[r] ?? b.timer, 10); timers[r] = v >= 2 ? v : defaults[r]; }
    if (names.length < 2 || !budget || budget < 1) return json(res, 400, { error: "Dati incompleti" });
    const limits = {};
    for (const r of ROLE_ORDER) { const v = parseInt((b.limits || {})[r], 10); limits[r] = v >= 0 ? v : DEFAULT_LIMITS[r]; }
    if (Object.values(limits).reduce((a, x) => a + x, 0) < 1) return json(res, 400, { error: "Composizione rosa non valida" });
    const callMode = b.callMode === "master" ? "master" : "random";
    let c; do { c = roomCode(); } while (rooms[c]);
    const used = new Set();
    const participants = names.map((name) => {
      let u = slug(name), base = u, i = 2;
      while (used.has(u)) u = base + i++;
      used.add(u);
      return { name, username: u, password: String(1000 + rnd(9000)), token: token(), budget, roster: [], online: 0 };
    });
    rooms[c] = {
      code: c, league: String(b.league || "Lega").trim(), timers, limits, callMode, budget, status: "lobby",
      masterToken: token(), participants, pool: [...PLAYERS], skipped: [], current: null, lastAward: null, log: [], clients: new Set(),
      ticker: null, nextTimer: null,
    };
    return json(res, 200, {
      code: c, masterToken: rooms[c].masterToken,
      credentials: participants.map((x) => ({ name: x.name, username: x.username, password: x.password })),
    });
  }

  if (p === "/api/login" && req.method === "POST") {
    const b = await readBody(req);
    const room = rooms[String(b.code || "").toUpperCase().trim()];
    if (!room) return json(res, 404, { error: "Codice stanza inesistente" });
    const user = room.participants.find((x) => x.username === String(b.username || "").toLowerCase().trim());
    if (!user || user.password !== String(b.password || "").trim()) return json(res, 401, { error: "Username o password errati" });
    return json(res, 200, { token: user.token, code: room.code, name: user.name, username: user.username });
  }

  if (p === "/api/events") {
    const room = rooms[url.searchParams.get("room")];
    const a = auth(room, url.searchParams.get("token"));
    if (!a) return json(res, 401, { error: "Non autorizzato" });
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    room.clients.add(res);
    if (!a.master) a.user.online++;
    broadcast(room);
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => {
      clearInterval(ping);
      room.clients.delete(res);
      if (!a.master) { a.user.online--; broadcast(room); if (room.status === "live") checkAllSkipped(room); }
    });
    return;
  }

  if (p === "/api/bid" && req.method === "POST") {
    const b = await readBody(req);
    const room = rooms[b.code];
    const a = auth(room, b.token);
    if (!a || a.master) return json(res, 401, { error: "Non autorizzato" });
    const err = placeBid(room, a.user, Number(b.amount));
    return err ? json(res, 400, { error: err }) : json(res, 200, { ok: true });
  }

  if (p === "/api/auto" && req.method === "POST") {
    const b = await readBody(req);
    const room = rooms[b.code];
    const a = auth(room, b.token);
    if (!a || a.master) return json(res, 401, { error: "Non autorizzato" });
    const c = room.current, amount = Number(b.amount);
    if (room.status !== "live" || !c || c.sold || c.skipped) return json(res, 400, { error: "Nessun calciatore in asta" });
    if (amount === 0) { delete c.auto[a.user.username]; broadcast(room); return json(res, 200, { ok: true, amount: 0 }); }
    if (!Number.isInteger(amount) || amount < 1) return json(res, 400, { error: "Importo non valido" });
    if (!needsRole(room, a.user, c.player.role)) return json(res, 400, { error: "Non puoi partecipare a questa asta" });
    if (amount > maxBid(room, a.user)) return json(res, 400, { error: `Massimo consentito ${maxBid(room, a.user)} M` });
    if (amount <= c.bid && c.bidder !== a.user.username) return json(res, 400, { error: `L'offerta è già a ${c.bid} M` });
    c.auto[a.user.username] = amount;
    c.skips.delete(a.user.username);
    if (c.bid === 0) { c.bid = 1; c.bidder = a.user.username; c.timeLeft = timerFor(room); startTicker(room); }
    runAutoBids(room);
    broadcast(room);
    return json(res, 200, { ok: true, amount });
  }

  if (p === "/api/skip" && req.method === "POST") {
    const b = await readBody(req);
    const room = rooms[b.code];
    const a = auth(room, b.token);
    if (!a || a.master) return json(res, 401, { error: "Non autorizzato" });
    const c = room.current;
    if (room.status !== "live" || !c || c.sold || c.skipped) return json(res, 400, { error: "Nessun calciatore in asta" });
    if (c.bid > 0) return json(res, 400, { error: "C'è già un'offerta: non si può più passare" });
    c.skips.add(a.user.username);
    broadcast(room);
    checkAllSkipped(room);
    return json(res, 200, { ok: true });
  }

  if (p.startsWith("/api/master/") && req.method === "POST") {
    const b = await readBody(req);
    const room = rooms[b.code];
    const a = auth(room, b.token);
    if (!a || !a.master) return json(res, 401, { error: "Solo il master" });
    const action = p.split("/")[3];
    if (action === "credentials") return json(res, 200, {
      code: room.code, league: room.league,
      credentials: room.participants.map((x) => ({ name: x.name, username: x.username, password: x.password })),
    });
    if (action === "start" && room.status === "lobby") { room.status = "live"; drawNext(room); }
    else if (action === "pause" && room.status === "live") { room.status = "paused"; stopTicker(room); clearTimeout(room.nextTimer); broadcast(room); }
    else if (action === "resume" && room.status === "paused") {
      room.status = "live";
      if (room.current?.sold || room.current?.skipped) room.nextTimer = setTimeout(() => drawNext(room), 1000);
      else if (room.current?.timeLeft != null) startTicker(room);
      broadcast(room);
    }
    else if (action === "next" && room.status === "live") {
      stopTicker(room); clearTimeout(room.nextTimer);
      if (room.current && !room.current.sold && !room.current.skipped) room.pool.push(room.current.player); // torna nel mazzo
      drawNext(room, true);
    }
    else if (action === "call" && room.status === "live") {
      if (room.current && !room.current.sold && !room.current.skipped && room.current.bid > 0) return json(res, 400, { error: "C'è un'asta in corso" });
      let i = room.pool.findIndex((p) => p.name + "|" + p.team + "|" + p.role === b.id), player = null;
      if (i >= 0) player = room.pool.splice(i, 1)[0];
      else { i = room.skipped.findIndex((p) => p.name + "|" + p.team + "|" + p.role === b.id); if (i >= 0) player = room.skipped.splice(i, 1)[0]; }
      if (!player) return json(res, 400, { error: "Calciatore non disponibile" });
      if (!room.participants.some((p) => needsRole(room, p, player.role))) { room.pool.push(player); return json(res, 400, { error: "Nessun partecipante ha slot liberi in quel ruolo" }); }
      stopTicker(room); clearTimeout(room.nextTimer);
      if (room.current && !room.current.sold && !room.current.skipped) room.pool.push(room.current.player);
      putUp(room, player);
    }
    else if (action === "undo" && ["live", "paused"].includes(room.status)) {
      const c = room.current;
      stopTicker(room); clearTimeout(room.nextTimer);
      if (c && !c.sold && !c.skipped && c.bid > 0) {
        // asta in corso: azzera le offerte e ripeti lo stesso calciatore
        room.log.push(`${c.player.name} → asta annullata dal master, si ripete`);
        room.current = { player: c.player, bid: 0, bidder: null, timeLeft: null, sold: false, skipped: false, skips: new Set(), auto: {} };
      } else if (c && c.skipped) {
        room.skipped = room.skipped.filter((p) => p !== c.player);
        room.log.push(`${c.player.name} → scarto annullato dal master, si ripete`);
        room.current = { player: c.player, bid: 0, bidder: null, timeLeft: null, sold: false, skipped: false, skips: new Set(), auto: {} };
      } else if (room.lastAward) {
        // annulla l'ultima aggiudicazione: rimborso, rosa, e il calciatore torna in asta
        const { player, winner, price } = room.lastAward;
        winner.budget += price;
        const i = winner.roster.findIndex((x) => x.name === player.name && x.team === player.team && x.role === player.role);
        if (i >= 0) winner.roster.splice(i, 1);
        if (c && !c.sold && !c.skipped) room.pool.push(c.player); // quello appena estratto torna nel mazzo
        room.lastAward = null;
        room.log.push(`${player.name} → aggiudicazione a ${winner.name} annullata, si ripete`);
        room.current = { player, bid: 0, bidder: null, timeLeft: null, sold: false, skipped: false, skips: new Set(), auto: {} };
      } else return json(res, 400, { error: "Niente da annullare" });
      if (room.status === "live") checkAllSkipped(room);
      broadcast(room);
    }
    else if (action === "end") { room.status = "ended"; stopTicker(room); clearTimeout(room.nextTimer); room.current = null; broadcast(room); }
    else return json(res, 400, { error: "Azione non valida nello stato attuale" });
    return json(res, 200, { ok: true });
  }

  if (p === "/players.json") { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "max-age=3600" }); return res.end(JSON.stringify(PLAYERS)); }

  // --- static ---
  const file = p === "/" ? "/index.html" : p;
  const fp = path.join(__dirname, "public", path.normalize(file));
  if (fp.startsWith(path.join(__dirname, "public")) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    const ext = path.extname(fp);
    res.writeHead(200, { "Content-Type": { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" }[ext] || "application/octet-stream" });
    return fs.createReadStream(fp).pipe(res);
  }
  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log(`\nFantAsta avviata (${PLAYERS.length} calciatori)`);
  console.log(`  su questo computer:  http://localhost:${PORT}`);
  ips.forEach((ip) => console.log(`  dai telefoni (stesso Wi-Fi): http://${ip}:${PORT}`));
  console.log("");
});

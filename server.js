// FantAsta beta — server unico, nessuna dipendenza esterna (solo Node.js >= 18)
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = process.env.PORT || 3000;
const PLAYERS = JSON.parse(fs.readFileSync(path.join(__dirname, "players.json"), "utf8"));
const NEXT_DELAY = 4000; // ms tra aggiudicazione e prossima estrazione

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
    timerSeconds: room.timerSeconds,
    participants: room.participants.map((p) => ({
      name: p.name, username: p.username, budget: p.budget, online: p.online > 0,
      roster: p.roster,
    })),
    current: room.current
      ? {
          player: room.current.player,
          bid: room.current.bid,
          bidder: room.current.bidder,
          timeLeft: room.current.timeLeft,
          sold: room.current.sold || false,
        }
      : null,
    remaining: room.pool.length,
    log: room.log.slice(-8),
  };
}

function broadcast(room) {
  const data = `data: ${JSON.stringify(publicState(room))}\n\n`;
  for (const c of room.clients) c.write(data);
}

// ---------- logica asta ----------
function drawNext(room) {
  clearTimeout(room.nextTimer);
  if (room.status === "ended" || room.pool.length === 0) {
    room.current = null;
    if (room.pool.length === 0) room.status = "ended";
    return broadcast(room);
  }
  const idx = rnd(room.pool.length);
  const player = room.pool.splice(idx, 1)[0];
  room.current = { player, bid: 0, bidder: null, timeLeft: null, sold: false };
  broadcast(room);
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
    room.log.push(`${c.player.name} → ${winner.name} per ${c.bid} M`);
  }
  c.sold = true;
  broadcast(room);
  room.nextTimer = setTimeout(() => drawNext(room), NEXT_DELAY);
}

function placeBid(room, user, amount) {
  if (room.status !== "live") return "L'asta non è in corso";
  const c = room.current;
  if (!c || c.sold) return "Nessun calciatore in asta";
  if (!Number.isInteger(amount) || amount < 1) return "Offerta non valida";
  if (amount <= c.bid) return `Devi offrire più di ${c.bid} M`;
  if (amount > user.budget) return `Budget insufficiente (hai ${user.budget} M)`;
  if (c.bidder === user.username) return "Sei già il miglior offerente";
  c.bid = amount;
  c.bidder = user.username;
  c.timeLeft = room.timerSeconds;
  startTicker(room);
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
    const budget = parseInt(b.budget, 10), timer = parseInt(b.timer, 10);
    if (names.length < 2 || !budget || budget < 1 || !timer || timer < 1) return json(res, 400, { error: "Dati incompleti" });
    let c; do { c = roomCode(); } while (rooms[c]);
    const used = new Set();
    const participants = names.map((name) => {
      let u = slug(name), base = u, i = 2;
      while (used.has(u)) u = base + i++;
      used.add(u);
      return { name, username: u, password: String(1000 + rnd(9000)), token: token(), budget, roster: [], online: 0 };
    });
    rooms[c] = {
      code: c, league: String(b.league || "Lega").trim(), timerSeconds: timer, status: "lobby",
      masterToken: token(), participants, pool: [...PLAYERS], current: null, log: [], clients: new Set(),
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
      if (!a.master) { a.user.online--; broadcast(room); }
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

  if (p.startsWith("/api/master/") && req.method === "POST") {
    const b = await readBody(req);
    const room = rooms[b.code];
    const a = auth(room, b.token);
    if (!a || !a.master) return json(res, 401, { error: "Solo il master" });
    const action = p.split("/")[3];
    if (action === "start" && room.status === "lobby") { room.status = "live"; drawNext(room); }
    else if (action === "pause" && room.status === "live") { room.status = "paused"; stopTicker(room); clearTimeout(room.nextTimer); broadcast(room); }
    else if (action === "resume" && room.status === "paused") {
      room.status = "live";
      if (room.current?.sold) room.nextTimer = setTimeout(() => drawNext(room), 1000);
      else if (room.current?.timeLeft != null) startTicker(room);
      broadcast(room);
    }
    else if (action === "next" && room.status === "live") {
      stopTicker(room);
      if (room.current && !room.current.sold) room.pool.push(room.current.player); // torna nel mazzo
      drawNext(room);
    }
    else if (action === "end") { room.status = "ended"; stopTicker(room); clearTimeout(room.nextTimer); room.current = null; broadcast(room); }
    else return json(res, 400, { error: "Azione non valida nello stato attuale" });
    return json(res, 200, { ok: true });
  }

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

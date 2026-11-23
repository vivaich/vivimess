const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_BEFORE_PUBLIC_DEPLOYMENT";
const DB_FILE = path.join(__dirname, "data.json");

app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dirname, "public")));

let db = { users: [], friendships: [], messages: [], settings: null, customCss: "", currencies: [] };
try { if (fs.existsSync(DB_FILE)) db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) }; } catch (e) {
  console.error("Could not read data.json. Starting with an empty database.", e.message);
}
const DEFAULT_SETTINGS = {
  appName: "ViviMess",
  tagline: "Messages, calls and screen sharing — all in one place.",
  accent: "#28e0b2",
  background: "#0b111a",
  panel: "#182331",
  showFriends: true,
  showCalls: true,
  showVideo: true,
  showScreenShare: true
};
db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
if (!Array.isArray(db.users)) db.users = [];
if (!Array.isArray(db.friendships)) db.friendships = [];
if (!Array.isArray(db.messages)) db.messages = [];
if (!Array.isArray(db.currencies)) db.currencies = [];
// Everyone starts with zero balance. The default currency is named Чекушня.
if (!db.currencies.length) db.currencies.push({ id: "default", name: "Чекушня", logo: "", logoType: "image", createdAt: Date.now() });
for (const user of db.users) {
  if (!user.balances || typeof user.balances !== "object") user.balances = {};
  for (const currency of db.currencies) if (user.balances[currency.id] == null) user.balances[currency.id] = 0;
}
async function seedAdmin() {
  let admin = db.users.find(u => u.username === "viva");
  if (!admin) {
    admin = {
      id: require("crypto").randomUUID(), username: "viva", displayName: "viva",
      passwordHash: await bcrypt.hash("vivaich11", 12),
      bio: "ViviMess owner and creator.", avatar: "", status: "Online",
      role: "admin", seededAdmin: true, createdAt: Date.now()
    };
    db.users.push(admin);
  } else if (!admin.seededAdmin) {
    admin.passwordHash = await bcrypt.hash("vivaich11", 12);
    admin.role = "admin";
    admin.seededAdmin = true;
  } else {
    admin.role = "admin";
  }
  save();
}
function save() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function tokenFor(user) {
  return jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: "7d" });
}
function safeUser(user) {
  return { id: user.id, username: user.username, displayName: user.displayName, bio: user.bio || "", avatar: user.avatar || "", status: user.status || "Online", role: user.role || "user", balances: user.balances || {} };
}
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: "Please sign in again." }); }
}
function requireAdmin(req, res, next) {
  const user = db.users.find(u => u.id === req.user.id);
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Admin access only." });
  req.admin = user;
  next();
}
app.get("/api/settings", (req, res) => res.json({ settings: db.settings, customCss: db.customCss || "" }));
app.get("/api/admin/settings", auth, requireAdmin, (req, res) => res.json({ settings: db.settings, customCss: db.customCss || "" }));
app.patch("/api/admin/settings", auth, requireAdmin, (req, res) => {
  const allowed = ["appName", "tagline", "accent", "background", "panel", "showFriends", "showCalls", "showVideo", "showScreenShare"];
  for (const key of allowed) {
    if (req.body[key] === undefined) continue;
    if (["showFriends", "showCalls", "showVideo", "showScreenShare"].includes(key)) db.settings[key] = !!req.body[key];
    else db.settings[key] = String(req.body[key]).slice(0, key === "tagline" ? 120 : 40);
  }
  save(); res.json({ settings: db.settings });
});
app.patch("/api/admin/code", auth, requireAdmin, (req, res) => {
  const css = String(req.body.css || "");
  if (css.length > 30000) return res.status(400).json({ error: "Custom CSS limit is 30,000 characters." });
  db.customCss = css; save(); res.json({ ok: true });
});
app.get("/api/admin/overview", auth, requireAdmin, (req, res) => {
  res.json({ users: db.users.length, messages: db.messages.length, friends: db.friendships.length });
});
// Currency management: only an existing administrator can create/edit currencies or change balances.
app.get("/api/currencies", auth, (req, res) => {
  const user = db.users.find(u => u.id === req.user.id);
  res.json({ currencies: db.currencies.map(c => ({ id:c.id, name:c.name, logo:c.logo || "", logoType:c.logoType || "image", balance:Number(user?.balances?.[c.id] || 0) })) });
});
app.post("/api/admin/currencies", auth, requireAdmin, (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 32);
  const logo = String(req.body.logo || "");
  const logoType = ["image","gif","video"].includes(req.body.logoType) ? req.body.logoType : "image";
  if (!name) return res.status(400).json({error:"Enter a currency name."});
  if (logo.length > 10 * 1024 * 1024) return res.status(400).json({error:"Logo file is too large (maximum 10 MB)."});
  const id = require("crypto").randomUUID();
  const currency = { id, name, logo, logoType, createdAt: Date.now() };
  db.currencies.push(currency);
  for (const user of db.users) { if (!user.balances) user.balances = {}; user.balances[id] = 0; }
  save(); res.json({currency});
});
app.patch("/api/admin/currencies/:id", auth, requireAdmin, (req, res) => {
  const c = db.currencies.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({error:"Currency not found."});
  if (req.body.name !== undefined) c.name = String(req.body.name).trim().slice(0,32) || c.name;
  if (req.body.logo !== undefined) {
    const logo = String(req.body.logo || "");
    if (logo.length > 10 * 1024 * 1024) return res.status(400).json({error:"Logo file is too large (maximum 10 MB)."});
    c.logo = logo;
    c.logoType = ["image","gif","video"].includes(req.body.logoType) ? req.body.logoType : "image";
  }
  save(); res.json({currency:c});
});
app.post("/api/admin/balance", auth, requireAdmin, (req, res) => {
  const target = db.users.find(u => u.username === String(req.body.username || "").trim().toLowerCase());
  const currency = db.currencies.find(c => c.id === req.body.currencyId);
  const amount = Number(req.body.amount);
  if (!target || !currency || !Number.isFinite(amount) || Math.abs(amount) > 1000000000) return res.status(400).json({error:"Check username, currency and amount."});
  if (!target.balances) target.balances = {};
  target.balances[currency.id] = Math.max(0, Number(target.balances[currency.id] || 0) + amount);
  save(); res.json({ok:true, balance:target.balances[currency.id]});
});
app.post("/api/admin/roles", auth, requireAdmin, (req, res) => {
  const target = db.users.find(u => u.username === String(req.body.username || "").trim().toLowerCase());
  if (!target) return res.status(404).json({error:"Account not found."});
  if (target.username === "viva") return res.status(400).json({error:"The owner account cannot be changed."});
  target.role = req.body.role === "admin" ? "admin" : "user";
  save(); res.json({ok:true, user:safeUser(target)});
});

function areFriends(a, b) {
  return db.friendships.some(f => (f.from === a && f.to === b) || (f.from === b && f.to === a));
}
function emitToUser(userId, event, data) {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.user && socket.user.id === userId) socket.emit(event, data);
  }
}

app.post("/api/register", async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const displayName = String(req.body.displayName || username).trim().slice(0, 28);
  const password = String(req.body.password || "");
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Username: 3–20 letters, numbers or _." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (db.users.some(u => u.username === username)) return res.status(409).json({ error: "This username is already taken." });
  const user = { id: require("crypto").randomUUID(), username, displayName: displayName || username, passwordHash: await bcrypt.hash(password, 12), bio: "Hey! I'm using ViviMess.", avatar: "", status: "Online", role: "user", balances: Object.fromEntries(db.currencies.map(c => [c.id, 0])), createdAt: Date.now() };
  db.users.push(user); save();
  res.json({ token: tokenFor(user), user: safeUser(user) });
});
app.post("/api/login", async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const user = db.users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.passwordHash))) return res.status(401).json({ error: "Incorrect username or password." });
  res.json({ token: tokenFor(user), user: safeUser(user) });
});
app.get("/api/me", auth, (req, res) => {
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "Account not found." });
  res.json({ user: safeUser(user) });
});
app.patch("/api/profile", auth, (req, res) => {
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "Account not found." });
  if (req.body.displayName !== undefined) user.displayName = String(req.body.displayName).trim().slice(0, 28) || user.username;
  if (req.body.bio !== undefined) user.bio = String(req.body.bio).trim().slice(0, 160);
  if (req.body.avatar !== undefined) user.avatar = String(req.body.avatar).trim().slice(0, 500);
  save(); res.json({ user: safeUser(user) });
});
app.get("/api/users", auth, (req, res) => {
  const q = String(req.query.q || "").toLowerCase().slice(0, 30);
  const users = db.users.filter(u => u.id !== req.user.id && (u.username.includes(q) || u.displayName.toLowerCase().includes(q))).slice(0, 30).map(u => ({ ...safeUser(u), isFriend: areFriends(req.user.id, u.id) }));
  res.json({ users });
});
app.post("/api/friends/:id", auth, (req, res) => {
  const target = db.users.find(u => u.id === req.params.id);
  if (!target || target.id === req.user.id) return res.status(404).json({ error: "User not found." });
  if (!areFriends(req.user.id, target.id)) db.friendships.push({ from: req.user.id, to: target.id, createdAt: Date.now() });
  save();
  emitToUser(target.id, "friends:changed", {});
  res.json({ ok: true });
});
app.delete("/api/friends/:id", auth, (req, res) => {
  db.friendships = db.friendships.filter(f => !((f.from === req.user.id && f.to === req.params.id) || (f.from === req.params.id && f.to === req.user.id)));
  save(); res.json({ ok: true });
});
app.get("/api/friends", auth, (req, res) => {
  const ids = new Set(db.friendships.filter(f => f.from === req.user.id || f.to === req.user.id).map(f => f.from === req.user.id ? f.to : f.from));
  res.json({ users: db.users.filter(u => ids.has(u.id)).map(safeUser) });
});
app.get("/api/messages/:id", auth, (req, res) => {
  if (!areFriends(req.user.id, req.params.id)) return res.status(403).json({ error: "Add this person as a friend to chat." });
  const messages = db.messages.filter(m => (m.from === req.user.id && m.to === req.params.id) || (m.from === req.params.id && m.to === req.user.id)).slice(-200);
  res.json({ messages });
});

io.use((socket, next) => {
  try { socket.user = jwt.verify(socket.handshake.auth.token, SECRET); next(); }
  catch { next(new Error("Unauthorized")); }
});
io.on("connection", socket => {
  socket.on("message:send", data => {
    const to = String(data.to || "");
    const text = String(data.text || "").trim().slice(0, 2000);
    if (!text || !areFriends(socket.user.id, to)) return;
    const message = { id: require("crypto").randomUUID(), from: socket.user.id, to, text, createdAt: Date.now() };
    db.messages.push(message); if (db.messages.length > 10000) db.messages = db.messages.slice(-10000);
    save();
    socket.emit("message:new", message);
    emitToUser(to, "message:new", message);
  });
  socket.on("call:invite", ({ to, mode }) => {
    if (!areFriends(socket.user.id, to)) return;
    emitToUser(to, "call:incoming", { from: socket.user.id, username: socket.user.username, mode: mode === "video" ? "video" : "audio" });
  });
  socket.on("call:signal", ({ to, signal }) => {
    if (!areFriends(socket.user.id, to)) return;
    emitToUser(to, "call:signal", { from: socket.user.id, signal });
  });
  socket.on("call:end", ({ to }) => emitToUser(to, "call:ended", { from: socket.user.id }));
});

seedAdmin().then(() => {
  server.listen(PORT, () => console.log(`ViviMess is running at http://localhost:${PORT}`));
}).catch(err => {
  console.error("Could not initialize ViviMess:", err);
  process.exit(1);
});

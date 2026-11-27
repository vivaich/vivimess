const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 14 * 1024 * 1024 });
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_BEFORE_PUBLIC_DEPLOYMENT";
const DB_FILE = path.join(__dirname, "data.json");

app.use(express.json({ limit: "24mb" }));
app.use(express.static(path.join(__dirname, "public")));

let db = { users: [], friendships: [], friendRequests: [], messages: [], callLogs: [], settings: null, customCss: "", currencies: [], customPages: [], gifLibrary: [], shopItems: [], quests: [] };
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
  showVideo: false,
  showScreenShare: true
};
db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
if (!Array.isArray(db.users)) db.users = [];
if (!Array.isArray(db.friendships)) db.friendships = [];
if (!Array.isArray(db.messages)) db.messages = [];
if (!Array.isArray(db.currencies)) db.currencies = [];
if (!Array.isArray(db.friendRequests)) db.friendRequests = [];
if (!Array.isArray(db.customPages)) db.customPages = [];
if (!Array.isArray(db.gifLibrary)) db.gifLibrary = [];
if (!Array.isArray(db.callLogs)) db.callLogs = [];
if (!Array.isArray(db.shopItems)) db.shopItems = [];
if (!Array.isArray(db.quests)) db.quests = [];
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
  return { id: user.id, username: user.username, displayName: user.displayName, bio: user.bio || "", avatar: user.avatar || "", banner: user.banner || "", bannerColor: user.bannerColor || "#087c70", status: user.status || "Online", role: user.role || "user", balances: user.balances || {}, equippedFrame:user.equippedFrame||"", equippedBanner:user.equippedBanner||"" };
}
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  try { req.user = jwt.verify(token, SECRET); if(!db.users.some(u=>u.id===req.user.id)) return res.status(401).json({error:"Account no longer exists. Please sign in again."}); next(); }
  catch { res.status(401).json({ error: "Please sign in again." }); }
}
function requireAdmin(req, res, next) {
  const user = db.users.find(u => u.id === req.user.id);
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Admin access only." });
  req.admin = user; next();
}
function requireModerator(req, res, next) {
  const user = db.users.find(u => u.id === req.user.id);
  if (!user || !["admin", "moderator"].includes(user.role)) return res.status(403).json({ error: "Moderator access only." });
  req.staff = user; next();
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
// Admin-created sidebar pages. Content is declarative JSON; no arbitrary JavaScript is executed.
app.get("/api/pages", auth, (req,res) => res.json({ pages: db.customPages.filter(p => p.published !== false) }));
app.get("/api/admin/pages", auth, requireAdmin, (req,res) => res.json({ pages: db.customPages }));
app.post("/api/admin/pages", auth, requireAdmin, (req,res) => {
  const title = String(req.body.title || "New page").trim().slice(0,32) || "New page";
  const slug = String(req.body.slug || (title.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || ("page-"+Date.now().toString(36)))).slice(0,40);
  if (db.customPages.some(p=>p.slug===slug)) return res.status(409).json({error:"A page with this name already exists."});
  const page={id:require("crypto").randomUUID(),title,slug,elements:[],published:true,createdAt:Date.now()}; db.customPages.push(page); save(); res.json({page});
});
app.put("/api/admin/pages/:id", auth, requireAdmin, (req,res) => {
  const page=db.customPages.find(p=>p.id===req.params.id); if(!page) return res.status(404).json({error:"Page not found."});
  if(req.body.title!==undefined) page.title=String(req.body.title).trim().slice(0,32)||page.title;
  if(req.body.published!==undefined) page.published=!!req.body.published;
  if(req.body.elements!==undefined){ if(!Array.isArray(req.body.elements)||req.body.elements.length>100) return res.status(400).json({error:"A page can contain up to 100 elements."}); page.elements=req.body.elements.map(e=>({id:String(e.id||require("crypto").randomUUID()),type:["text","button","image","video","card"].includes(e.type)?e.type:"text",content:String(e.content||"").slice(0,10*1024*1024),label:String(e.label||"").slice(0,80),action:["none","open-page","award-currency","code","game-link"].includes(e.action)?e.action:"none",code:String(e.code||"").slice(0,12000),target:String(e.target||"").slice(0,100),width:Math.max(20,Math.min(100,Number(e.width)||100)),color:/^#[0-9a-f]{6}$/i.test(e.color||"")?e.color:"#ffffff",radius:Math.max(0,Math.min(32,Number(e.radius)||12)),amount:Math.max(0,Math.min(100000,Number(e.amount)||0))})); }
  save(); res.json({page});
});
app.delete("/api/admin/pages/:id", auth, requireAdmin, (req,res)=>{db.customPages=db.customPages.filter(p=>p.id!==req.params.id);save();res.json({ok:true});});
app.post("/api/pages/:slug/action", auth, (req,res)=>{const page=db.customPages.find(p=>p.slug===req.params.slug&&p.published!==false);const el=page?.elements?.find(e=>e.id===req.body.elementId&&e.type==="button");if(!el)return res.status(404).json({error:"Button not found."});if(el.action!=="award-currency"&&el.action!=="code")return res.status(400).json({error:"This button has no reward action."});const currencyId=el.action==="code"?String(req.body.currencyId||""):el.target;const amount=el.action==="code"?Number(req.body.amount):Number(el.amount);const c=db.currencies.find(x=>x.id===currencyId);if(!c||!Number.isFinite(amount)||amount<=0||amount>100000)return res.status(400).json({error:"Currency reward is not configured or amount is invalid."});const user=db.users.find(u=>u.id===req.user.id);if(!user.balances)user.balances={};user.balances[c.id]=Number(user.balances[c.id]||0)+amount;save();res.json({ok:true,amount,currency:c.name,balance:user.balances[c.id]});});
app.post("/api/gifs", auth, (req,res)=>{const data=String(req.body.data||"");if(!/^data:image\/gif;base64,/.test(data)||data.length>10*1024*1024)return res.status(400).json({error:"Upload a GIF up to 7 MB."});const item={id:require("crypto").randomUUID(),owner:req.user.id,data,createdAt:Date.now()};db.gifLibrary.push(item);save();res.json({gif:{id:item.id,data:item.data}});});
app.get("/api/gifs", auth, (req,res)=>res.json({gifs:db.gifLibrary.filter(g=>g.owner===req.user.id).map(g=>({id:g.id,data:g.data}))}));

// Currency management: only an existing administrator can create/edit currencies or change balances.
// Shop and quest data: purchases and rewards are verified server-side.
app.get("/api/market", auth, (req,res)=>{
 const user=db.users.find(u=>u.id===req.user.id);
 const submissions=user.questSubmissions||{};
 res.json({items:db.shopItems.map(x=>({...x,owned:(user.ownedItems||[]).includes(x.id),equipped:user.equippedFrame===x.id||user.equippedBanner===x.id})),quests:db.quests.map(q=>({...q,submissionStatus:submissions[q.id]?.status||"",completed:!!submissions[q.id]?.claimed})),currencies:db.currencies.map(c=>({id:c.id,name:c.name,balance:Number(user.balances?.[c.id]||0)}))});
});
app.post("/api/quests/:id/submit", auth, (req,res)=>{
 const q=db.quests.find(x=>x.id===req.params.id);if(!q)return res.status(404).json({error:"Quest not found."});if(!q.link)return res.status(400).json({error:"This quest has no action link."});
 const user=db.users.find(u=>u.id===req.user.id);user.questSubmissions=user.questSubmissions||{};const old=user.questSubmissions[q.id];
 if(old?.status==="approved"||old?.status==="claimed")return res.status(409).json({error:"This quest is already approved."});
 user.questSubmissions[q.id]={status:"pending",submittedAt:Date.now()};save();res.json({ok:true,status:"pending"});
});
app.get("/api/admin/quest-submissions", auth, requireAdmin, (req,res)=>{
 const rows=[];for(const u of db.users){for(const [questId,sub] of Object.entries(u.questSubmissions||{})){if(sub.status==="pending"){const q=db.quests.find(x=>x.id===questId);if(q)rows.push({questId,userId:u.id,username:u.username,displayName:u.displayName,questTitle:q.title,submittedAt:sub.submittedAt});}}}rows.sort((a,b)=>(b.submittedAt||0)-(a.submittedAt||0));res.json({submissions:rows});
});
app.post("/api/admin/quests/:id/review/:userId", auth, requireAdmin, (req,res)=>{
 const q=db.quests.find(x=>x.id===req.params.id),u=db.users.find(x=>x.id===req.params.userId);if(!q||!u)return res.status(404).json({error:"Quest or user not found."});
 u.questSubmissions=u.questSubmissions||{};const sub=u.questSubmissions[q.id];if(!sub||sub.status!=="pending")return res.status(409).json({error:"No pending submission for this quest."});
 sub.status="approved";sub.reviewedAt=Date.now();sub.reviewedBy=req.user.id;save();res.json({ok:true});
});
app.post("/api/shop/:id/buy", auth, (req,res)=>{
 const user=db.users.find(u=>u.id===req.user.id), item=db.shopItems.find(x=>x.id===req.params.id);
 if(!item)return res.status(404).json({error:"Item not found."});
 user.ownedItems=user.ownedItems||[]; if(user.ownedItems.includes(item.id))return res.status(409).json({error:"You already own this item."});
 const currency=db.currencies.find(c=>c.id===item.currencyId);if(!currency)return res.status(400).json({error:"Item currency no longer exists."});
 user.balances=user.balances||{};const balance=Number(user.balances[item.currencyId]||0);if(balance<item.price)return res.status(400).json({error:"Not enough currency."});
 user.balances[item.currencyId]=balance-item.price;user.ownedItems.push(item.id);save();res.json({ok:true,balance:user.balances[item.currencyId],item:item.name});
});
app.post("/api/shop/equip", auth, (req,res)=>{
 const user=db.users.find(u=>u.id===req.user.id),item=db.shopItems.find(x=>x.id===String(req.body.itemId||''));
 if(!item||!(user.ownedItems||[]).includes(item.id))return res.status(403).json({error:"You do not own this item."});
 const key=item.type==='frame'?'equippedFrame':'equippedBanner';user[key]=user[key]===item.id?'':item.id;save();res.json({ok:true,user:safeUser(user)});
});
app.post("/api/quests/:id/claim", auth, (req,res)=>{
 const user=db.users.find(u=>u.id===req.user.id),q=db.quests.find(x=>x.id===req.params.id);
 if(!q)return res.status(404).json({error:"Quest not found."});user.questSubmissions=user.questSubmissions||{};const sub=user.questSubmissions[q.id];
 if(!sub||sub.status!=="approved")return res.status(403).json({error:"The administrator must approve your quest first."});
 const c=db.currencies.find(x=>x.id===q.currencyId);if(!c)return res.status(400).json({error:"Reward currency no longer exists."});user.balances=user.balances||{};user.balances[q.currencyId]=Number(user.balances[q.currencyId]||0)+q.reward;sub.status="claimed";sub.claimedAt=Date.now();save();res.json({ok:true,reward:q.reward,currency:c.name});
});
app.post("/api/admin/shop", auth, requireAdmin, (req,res)=>{const b=req.body||{},name=String(b.name||'').trim().slice(0,60),price=Number(b.price),type=b.type==='banner'?'banner':'frame';if(!name||!Number.isInteger(price)||price<1||price>100000000||!db.currencies.some(c=>c.id===b.currencyId)||!/^data:(image\/(png|jpeg|webp|gif)|video\/(mp4|webm));base64,/.test(String(b.media||''))||String(b.media).length>12*1024*1024)return res.status(400).json({error:'Check item name, price, currency and media (max 8 MB).'});const item={id:require('crypto').randomUUID(),name,description:String(b.description||'').slice(0,180),price,currencyId:b.currencyId,type,media:b.media,mediaType:String(b.media).startsWith('data:video/')?'video':String(b.media).startsWith('data:image/gif')?'gif':'image',createdAt:Date.now()};db.shopItems.push(item);save();res.json({item});});
app.delete("/api/admin/shop/:id", auth, requireAdmin, (req,res)=>{const item=db.shopItems.find(x=>x.id===req.params.id);if(!item)return res.status(404).json({error:'Item not found.'});db.shopItems=db.shopItems.filter(x=>x.id!==item.id);for(const u of db.users){u.ownedItems=(u.ownedItems||[]).filter(id=>id!==item.id);if(u.equippedFrame===item.id)u.equippedFrame='';if(u.equippedBanner===item.id)u.equippedBanner='';}save();res.json({ok:true});});
app.post("/api/admin/quests", auth, requireAdmin, (req,res)=>{const b=req.body||{},title=String(b.title||'').trim().slice(0,80),reward=Number(b.reward),image=String(b.image||''),link=String(b.link||'').trim().slice(0,1000);if(!title||!Number.isInteger(reward)||reward<1||reward>100000000||!db.currencies.some(c=>c.id===b.currencyId)||(image&&!/^data:image\/(png|jpeg|webp|gif);base64,/.test(image))||image.length>12*1024*1024||(link&&!/^https:\/\//i.test(link)))return res.status(400).json({error:'Check quest title, reward, currency, optional image and HTTPS link.'});const q={id:require('crypto').randomUUID(),title,description:String(b.description||'').slice(0,220),reward,currencyId:b.currencyId,image,link,createdAt:Date.now()};db.quests.push(q);save();res.json({quest:q});});
app.delete("/api/admin/quests/:id", auth, requireAdmin, (req,res)=>{db.quests=db.quests.filter(q=>q.id!==req.params.id);save();res.json({ok:true});});
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
app.delete("/api/admin/currencies/:id", auth, requireAdmin, (req,res)=>{
  const exists=db.currencies.some(c=>c.id===req.params.id); if(!exists)return res.status(404).json({error:"Currency not found."});
  db.currencies=db.currencies.filter(c=>c.id!==req.params.id);
  for(const user of db.users){if(user.balances)delete user.balances[req.params.id];}
  for(const page of db.customPages)for(const el of page.elements||[])if(el.target===req.params.id){el.target="";el.amount=0;}
  save();res.json({ok:true});
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
  if (req.admin.username !== "viva") return res.status(403).json({error:"Only the owner can assign staff roles."});
  const target = db.users.find(u => u.username === String(req.body.username || "").trim().toLowerCase());
  if (!target) return res.status(404).json({error:"Account not found."});
  if (target.username === "viva") return res.status(400).json({error:"The owner account cannot be changed."});
  target.role = ["admin", "moderator"].includes(req.body.role) ? req.body.role : "user";
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

// Moderator lookup: profile + friends for one username. Moderators have read-only access.
app.get("/api/moderation/user/:username", auth, requireModerator, (req,res)=>{
  const target=db.users.find(u=>u.username===String(req.params.username||"").trim().toLowerCase());
  if(!target) return res.status(404).json({error:"User not found."});
  const friendIds=new Set(db.friendships.filter(f=>f.from===target.id||f.to===target.id).map(f=>f.from===target.id?f.to:f.from));
  const friends=db.users.filter(u=>friendIds.has(u.id)).map(safeUser);
  const recent=db.messages.filter(m=>m.from===target.id||m.to===target.id).slice(-100).map(m=>({...m,fromUsername:db.users.find(u=>u.id===m.from)?.username||"deleted",toUsername:db.users.find(u=>u.id===m.to)?.username||"deleted"}));
  res.json({user:safeUser(target),friends,recentMessages:recent});
});
// Owner-triggered clean start. A dated backup is written before removing community data.
app.post("/api/admin/reset-community", auth, requireAdmin, (req,res)=>{
  if(req.admin.username!=="viva") return res.status(403).json({error:"Only the owner can reset the community."});
  const owner=db.users.find(u=>u.username==="viva");
  if(!owner) return res.status(500).json({error:"Owner account missing; reset cancelled."});
  const backup=path.join(__dirname,`data-backup-${Date.now()}.json`);
  try { if(fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE,backup); } catch(e) { return res.status(500).json({error:"Backup failed; no data was deleted."}); }
  db.users=[owner]; owner.role="admin"; owner.seededAdmin=true;
  db.friendships=[]; db.friendRequests=[]; db.messages=[]; db.callLogs=[]; db.gifLibrary=[];
  db.customPages=[]; db.customCss="";
  db.currencies=[{id:"default",name:"Чекушня",logo:"",logoType:"image",createdAt:Date.now()}];
  owner.balances={default:0}; save();
  res.json({ok:true,backup:path.basename(backup),message:"Community reset complete. Owner account preserved."});
});

// Owner-only account deletion. The owner account itself is protected.
app.get("/api/admin/users", auth, requireModerator, (req,res)=>{
  res.json({users:db.users.map(u=>({id:u.id,username:u.username,displayName:u.displayName,role:u.role,createdAt:u.createdAt}))});
});
app.delete("/api/admin/users/:id", auth, requireAdmin, (req,res)=>{
  if(req.admin.username!=="viva") return res.status(403).json({error:"Only the owner can delete accounts."});
  const target=db.users.find(u=>u.id===req.params.id);
  if(!target) return res.status(404).json({error:"Account not found."});
  if(target.username==="viva" || target.id===req.admin.id) return res.status(400).json({error:"The owner account cannot be deleted."});
  db.users=db.users.filter(u=>u.id!==target.id);
  db.friendships=db.friendships.filter(f=>f.from!==target.id&&f.to!==target.id);
  db.friendRequests=db.friendRequests.filter(r=>r.from!==target.id&&r.to!==target.id);
  db.messages=db.messages.filter(m=>m.from!==target.id&&m.to!==target.id);
  save(); res.json({ok:true});
});
// Moderation access is explicit and restricted to administrators; no call audio is stored.
app.get("/api/admin/conversation", auth, requireModerator, (req,res)=>{
  const a=db.users.find(u=>u.username===String(req.query.a||"").toLowerCase());
  const b=db.users.find(u=>u.username===String(req.query.b||"").toLowerCase());
  if(!a||!b) return res.status(404).json({error:"Both usernames must exist."});
  const messages=db.messages.filter(m=>(m.from===a.id&&m.to===b.id)||(m.from===b.id&&m.to===a.id)).slice(-300).map(m=>({...m,fromUsername:db.users.find(u=>u.id===m.from)?.username||"deleted",toUsername:db.users.find(u=>u.id===m.to)?.username||"deleted"}));
  res.json({a:a.username,b:b.username,messages});
});
app.get("/api/admin/calls", auth, requireModerator, (req,res)=>{
  res.json({calls:db.callLogs.slice(-100).reverse().map(c=>({...c,fromUsername:db.users.find(u=>u.id===c.from)?.username||"deleted",toUsername:db.users.find(u=>u.id===c.to)?.username||"deleted"}))});
});

app.post("/api/register", async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const displayName = String(req.body.displayName || username).trim().slice(0, 28);
  const password = String(req.body.password || "");
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Username: 3–20 letters, numbers or _." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  const finalDisplayName = displayName || username;
  const normalizedName = finalDisplayName.normalize("NFKC").toLocaleLowerCase("und");
  if (db.users.some(u => String(u.username || "").trim().toLowerCase() === username)) return res.status(409).json({ error: "This username is already taken. Choose another username." });
  if (db.users.some(u => String(u.displayName || u.username || "").trim().normalize("NFKC").toLocaleLowerCase("und") === normalizedName)) return res.status(409).json({ error: "This nickname is already taken. Choose another nickname." });
  const user = { id: require("crypto").randomUUID(), username, displayName: finalDisplayName, passwordHash: await bcrypt.hash(password, 12), bio: "Hey! I'm using ViviMess.", avatar: "", status: "Online", role: "user", balances: Object.fromEntries(db.currencies.map(c => [c.id, 0])), createdAt: Date.now() };
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
  if (req.body.displayName !== undefined) {
    const nextName = String(req.body.displayName).trim().slice(0, 28) || user.username;
    const normalizedName = nextName.normalize("NFKC").toLocaleLowerCase("und");
    if (db.users.some(u => u.id !== user.id && String(u.displayName || u.username || "").trim().normalize("NFKC").toLocaleLowerCase("und") === normalizedName)) {
      return res.status(409).json({ error: "This nickname is already taken. Choose another nickname." });
    }
    user.displayName = nextName;
  }
  if (req.body.bio !== undefined) user.bio = String(req.body.bio).trim().slice(0, 160);
  if (req.body.equippedFrame !== undefined) { const id=String(req.body.equippedFrame||''); if(id && (!db.shopItems.some(x=>x.id===id&&x.type==='frame') || !(user.ownedItems||[]).includes(id))) return res.status(403).json({error:'You do not own this frame.'}); user.equippedFrame=id; }
  if (req.body.equippedBanner !== undefined) { const id=String(req.body.equippedBanner||''); if(id && (!db.shopItems.some(x=>x.id===id&&x.type==='banner') || !(user.ownedItems||[]).includes(id))) return res.status(403).json({error:'You do not own this banner.'}); user.equippedBanner=id; }

  if (req.body.avatar !== undefined) {
    const avatar = String(req.body.avatar || "").trim();
    if (avatar.length > 10 * 1024 * 1024) return res.status(400).json({ error: "Avatar is too large. Maximum 7 MB." });
    if (avatar && !/^data:image\/(png|jpeg|webp|gif);base64,/.test(avatar) && !/^https?:\/\//i.test(avatar)) return res.status(400).json({ error: "Choose a PNG, JPG, WEBP or GIF image." });
    user.avatar = avatar;
  }
  if (req.body.banner !== undefined) {
    const banner = String(req.body.banner || "").trim();
    if (banner.length > 9 * 1024 * 1024) return res.status(400).json({ error: "Banner is too large. Maximum 6 MB." });
    if (banner && !/^data:image\/(png|jpeg|webp|gif);base64,/.test(banner) && !/^data:video\/(mp4|webm);base64,/.test(banner) && !/^https?:\/\//i.test(banner)) return res.status(400).json({ error: "Choose an image, GIF, MP4 or WEBM video." });
    user.banner = banner;
  }
  if (req.body.bannerColor !== undefined && /^#[0-9a-fA-F]{6}$/.test(String(req.body.bannerColor))) user.bannerColor = String(req.body.bannerColor);
  save(); res.json({ user: safeUser(user) });
});
app.get("/api/users", auth, (req, res) => {
  const q = String(req.query.q || "").toLowerCase().slice(0, 30);
  const users = db.users.filter(u => u.id !== req.user.id && (u.username.includes(q) || u.displayName.toLowerCase().includes(q))).slice(0, 30).map(u => ({ ...safeUser(u), isFriend: areFriends(req.user.id, u.id), requestSent: db.friendRequests.some(r=>r.from===req.user.id&&r.to===u.id), requestReceived: db.friendRequests.some(r=>r.from===u.id&&r.to===req.user.id) }));
  res.json({ users });
});
app.post("/api/friends/:id", auth, (req, res) => {
  const target=db.users.find(u=>u.id===req.params.id); if(!target||target.id===req.user.id)return res.status(404).json({error:"User not found."});
  if(areFriends(req.user.id,target.id))return res.json({ok:true,alreadyFriends:true});
  const reverse=db.friendRequests.find(r=>r.from===target.id&&r.to===req.user.id);
  if(reverse){db.friendRequests=db.friendRequests.filter(r=>r!==reverse);db.friendships.push({from:req.user.id,to:target.id,createdAt:Date.now()});save();emitToUser(target.id,"friends:changed",{});return res.json({ok:true,accepted:true});}
  if(!db.friendRequests.some(r=>r.from===req.user.id&&r.to===target.id))db.friendRequests.push({id:require("crypto").randomUUID(),from:req.user.id,to:target.id,createdAt:Date.now()});
  save();emitToUser(target.id,"friend-request:new",{from:safeUser(db.users.find(u=>u.id===req.user.id))});res.json({ok:true,pending:true});
});
app.get("/api/friend-requests", auth, (req,res)=>{const incoming=db.friendRequests.filter(r=>r.to===req.user.id).map(r=>({...r,user:safeUser(db.users.find(u=>u.id===r.from)||{})}));const outgoing=db.friendRequests.filter(r=>r.from===req.user.id);res.json({incoming,outgoing});});
app.post("/api/friend-requests/:id/accept", auth, (req,res)=>{const r=db.friendRequests.find(x=>x.id===req.params.id&&x.to===req.user.id);if(!r)return res.status(404).json({error:"Request not found."});db.friendRequests=db.friendRequests.filter(x=>x.id!==r.id);if(!areFriends(r.from,r.to))db.friendships.push({from:r.from,to:r.to,createdAt:Date.now()});save();emitToUser(r.from,"friends:changed",{});emitToUser(r.from,"friend-request:changed",{});res.json({ok:true});});
app.delete("/api/friend-requests/:id", auth, (req,res)=>{const r=db.friendRequests.find(x=>x.id===req.params.id&&(x.to===req.user.id||x.from===req.user.id));if(!r)return res.status(404).json({error:"Request not found."});db.friendRequests=db.friendRequests.filter(x=>x.id!==r.id);save();emitToUser(r.from,"friend-request:changed",{});emitToUser(r.to,"friend-request:changed",{});res.json({ok:true});});
app.delete("/api/friends/:id", auth, (req, res) => {
  db.friendships=db.friendships.filter(f=>!((f.from===req.user.id&&f.to===req.params.id)||(f.from===req.params.id&&f.to===req.user.id)));save();res.json({ok:true});
});
app.get("/api/friends", auth, (req,res)=>{const ids=new Set(db.friendships.filter(f=>f.from===req.user.id||f.to===req.user.id).map(f=>f.from===req.user.id?f.to:f.from));res.json({users:db.users.filter(u=>ids.has(u.id)).map(safeUser)});});
app.get("/api/messages/:id", auth, (req, res) => {
  if (!areFriends(req.user.id, req.params.id)) return res.status(403).json({ error: "Add this person as a friend to chat." });
  const messages = db.messages.filter(m => (m.from === req.user.id && m.to === req.params.id) || (m.from === req.params.id && m.to === req.user.id)).slice(-200);
  res.json({ messages });
});

io.use((socket, next) => {
  try { socket.user = jwt.verify(socket.handshake.auth.token, SECRET); if(!db.users.some(u=>u.id===socket.user.id)) return next(new Error("Unauthorized")); next(); }
  catch { next(new Error("Unauthorized")); }
});
io.on("connection", socket => {
  socket.on("message:send", data => {
    const to = String(data.to || "");
    const text = String(data.text || "").trim().slice(0, 2000);
    const mediaName=String(data.media?.name||"File").slice(0,100); const mediaExt=mediaName.split(".").pop().toLowerCase(); const modExts=["jar","zip","mrpack","rar","7z","schem","schematic","mcaddon","mcpack"]; const isMediaData=typeof data.media?.data==="string"&&/^data:(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime));base64,/i.test(data.media.data); const isModData=typeof data.media?.data==="string"&&modExts.includes(mediaExt)&&/^data:(application\/octet-stream|application\/java-archive|application\/zip|application\/x-zip-compressed|application\/x-rar-compressed|application\/x-7z-compressed|application\/vnd\.[^;,]+|application\/x-[^;,]+);base64,/i.test(data.media.data); const media=data.media&&data.media.data.length<=12*1024*1024&&(isMediaData||isModData)?{type:isModData?"file":String(data.media.type||"image"),name:mediaName,data:data.media.data}:null;
    if ((!text && !media) || !areFriends(socket.user.id, to)) return;
    const message = { id: require("crypto").randomUUID(), from: socket.user.id, to, text, media, createdAt: Date.now() };
    db.messages.push(message); if (db.messages.length > 10000) db.messages = db.messages.slice(-10000);
    save();
    socket.emit("message:new", message);
    emitToUser(to, "message:new", message);
  });
  socket.on("call:invite", ({ to }) => {
    if (!areFriends(socket.user.id, to)) return;
    const log={id:require("crypto").randomUUID(),from:socket.user.id,to,startedAt:Date.now(),endedAt:null,status:"ringing",mode:"audio"};
    db.callLogs.push(log); if(db.callLogs.length>2000)db.callLogs=db.callLogs.slice(-2000); save();
    socket.data.activeCallLog=log.id;
    emitToUser(to, "call:incoming", { from: socket.user.id, username: socket.user.username, mode: "audio" });
  });
  socket.on("call:signal", ({ to, signal }) => {
    if (!areFriends(socket.user.id, to)) return;
    if(signal?.type==="description"){
      const log=[...db.callLogs].reverse().find(c=>!c.endedAt&&((c.from===socket.user.id&&c.to===to)||(c.from===to&&c.to===socket.user.id)));
      if(log&&log.status==="ringing"){log.status="connected";log.connectedAt=Date.now();save();}
    }
    emitToUser(to, "call:signal", { from: socket.user.id, signal });
  });
  socket.on("call:end", ({ to }) => {
    const log=[...db.callLogs].reverse().find(c=>!c.endedAt&&((c.from===socket.user.id&&c.to===to)||(c.from===to&&c.to===socket.user.id)));
    if(log&&!log.endedAt){log.endedAt=Date.now();if(log.status==="ringing")log.status="missed / declined";else log.status="ended";save();}
    socket.data.activeCallLog=null;
    emitToUser(to, "call:ended", { from: socket.user.id });
  });
});

seedAdmin().then(() => {
  server.listen(PORT, () => console.log(`ViviMess is running at http://localhost:${PORT}`));
}).catch(err => {
  console.error("Could not initialize ViviMess:", err);
  process.exit(1);
});

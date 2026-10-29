import express from 'express';
import Database from 'better-sqlite3';
import webpush from 'web-push';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_STORE_ID, comparePeople, orderServices } from '../src/catalog.js';
import { validGoalValues, validWorkdays, normalizeWorkdays } from '../src/goals.js';
import { saleMessage } from '../src/sale-message.js';
import { DEFAULT_DEPARTMENTS, TECH_DEPARTMENT_ID, departmentsForStore, sellerDepartmentId } from '../src/departments.js';
import { summaryGoals } from '../src/summary-goals.js';
import { summarize, earliestDate } from '../src/cloud-stats.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'pulse.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
  lat REAL, lon REAL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sellers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, store_id TEXT
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'other',
  active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY, request_id TEXT UNIQUE, store_id TEXT NOT NULL REFERENCES stores(id),
  seller_id INTEGER NOT NULL REFERENCES sellers(id), service_id INTEGER NOT NULL REFERENCES services(id),
  business_date TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT, source TEXT NOT NULL DEFAULT 'sale'
);
CREATE INDEX IF NOT EXISTS sales_period ON sales(store_id, business_date, deleted_at);
CREATE TABLE IF NOT EXISTS service_orders (
  store_id TEXT NOT NULL REFERENCES stores(id), service_id INTEGER NOT NULL REFERENCES services(id),
  position INTEGER NOT NULL, PRIMARY KEY(store_id,service_id)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id), seller_id INTEGER REFERENCES sellers(id),
  subscription_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS seller_goals (
  store_id TEXT NOT NULL REFERENCES stores(id), seller_id INTEGER NOT NULL REFERENCES sellers(id),
  service_id INTEGER NOT NULL REFERENCES services(id), day INTEGER, week INTEGER, month INTEGER, revision TEXT NOT NULL,
  PRIMARY KEY(store_id,seller_id,service_id)
);
CREATE TABLE IF NOT EXISTS seller_workdays (
  store_id TEXT NOT NULL REFERENCES stores(id), seller_id INTEGER NOT NULL REFERENCES sellers(id),
  days TEXT NOT NULL, revision TEXT NOT NULL, PRIMARY KEY(store_id,seller_id)
);
CREATE TABLE IF NOT EXISTS departments (
  store_id TEXT NOT NULL REFERENCES stores(id), id TEXT NOT NULL, name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(store_id,id)
);
`);

// Migration SQLite historique : conserver les identifiants, les ventes et les abonnements.
if (!db.prepare('PRAGMA table_info(sellers)').all().some(c=>c.name==='store_id')) db.exec('ALTER TABLE sellers ADD COLUMN store_id TEXT');
db.prepare("UPDATE sellers SET store_id=? WHERE store_id IS NULL OR store_id=''").run(LEGACY_STORE_ID);
if (!db.prepare('PRAGMA table_info(sellers)').all().some(c=>c.name==='department_id')) db.exec("ALTER TABLE sellers ADD COLUMN department_id TEXT NOT NULL DEFAULT 'tech'");
if (!db.prepare('PRAGMA table_info(sales)').all().some(c=>c.name==='department_id')) db.exec("ALTER TABLE sales ADD COLUMN department_id TEXT NOT NULL DEFAULT 'tech'");

const getSetting = key => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
const setSetting = (key, value) => db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
const seed = db.transaction(() => {
  if (!db.prepare('SELECT 1 FROM stores LIMIT 1').get()) {
    const stores = JSON.parse(fs.readFileSync(path.join(root, 'server/locations.json'), 'utf8'));
    const add = db.prepare('INSERT INTO stores (id,name,city,address,lat,lon) VALUES (@id,@name,@city,@address,@lat,@lon)');
    stores.forEach(store => add.run(store));
  }
  if (!db.prepare('SELECT 1 FROM sellers LIMIT 1').get()) {
    const names = ['Morgan', 'Anthony', 'Cedric', 'Philippe', 'Fabien', 'Florent', 'Eric', 'Tamera', 'Ikram', 'Selenia', 'Johan', 'Alice'];
    const add = db.prepare('INSERT INTO sellers(name,sort_order,store_id) VALUES (?,?,?)');
    names.forEach((name, index) => add.run(name, index, LEGACY_STORE_ID));
  }
  if (!db.prepare('SELECT 1 FROM services LIMIT 1').get()) {
    const names = [
      ['DMax','play'], ['Assu Téléph','phone'], ['Assu Multim','devices'], ['Garantie','shield'],
      ['FVD','package'], ['FNAC +','badge'], ['TRC','repeat'], ['Reprise','refresh'],
      ['Canal +','tv'], ['Free','wifi'], ['Autre','other']
    ];
    const add = db.prepare('INSERT INTO services(name,icon,sort_order) VALUES (?,?,?)');
    names.forEach(([name, icon], index) => add.run(name, icon, index));
  }
});
seed();

function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function checkPassword(password, record) {
  try {
    const [salt, hash] = record.split(':');
    const expected = Buffer.from(hash, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}
if (!getSetting('admin_password')) {
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(10).toString('base64url');
  setSetting('admin_password', makePasswordRecord(password));
  if (!process.env.ADMIN_PASSWORD) {
    const credentialFile = path.join(dataDir, 'ADMIN-INITIAL.txt');
    fs.writeFileSync(credentialFile, `${password}\n`, { mode: 0o600 });
    console.log(`Mot de passe administrateur initial créé dans ${credentialFile}`);
  }
}
let vapid = getSetting('vapid_keys');
if (!vapid) { vapid = JSON.stringify(webpush.generateVAPIDKeys()); setSetting('vapid_keys', vapid); }
vapid = JSON.parse(vapid);
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@fnacpulse.local', vapid.publicKey, vapid.privateKey);

const app = express();
app.disable('x-powered-by');
app.use((req,res,next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'geolocation=(self)');
  // Intentionally no X-Frame-Options: a same-origin preview may be embedded by the host.
  next();
});
app.use(express.json({ limit: '24kb' }));
app.use('/api', (req,res,next) => { res.set('Cache-Control', 'no-store'); next(); });

const sessions = new Map();
const loginAttempts = new Map();
const SESSION_MS = 8 * 60 * 60 * 1000;
function requireAdmin(req,res,next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'Session administrateur expirée. Reconnectez-vous.' });
  }
  session.expiresAt = Date.now() + SESSION_MS;
  req.adminToken = token;
  next();
}
const failure = (res, message, code=400) => res.status(code).json({ error: message });
const isId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const cleanName = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
const activeStore = id => typeof id === 'string' && db.prepare('SELECT * FROM stores WHERE id=? AND active=1').get(id);
const activeSeller = (id,storeId) => isId(id) && db.prepare('SELECT * FROM sellers WHERE id=? AND store_id=? AND active=1').get(Number(id),storeId);
const activeService = id => isId(id) && db.prepare('SELECT * FROM services WHERE id=? AND active=1').get(Number(id));

function parisToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Paris', year:'numeric',month:'2-digit',day:'2-digit' }).format(now);
}
function serviceOrders() {
  const orders={};
  for(const row of db.prepare('SELECT store_id AS storeId,service_id AS serviceId FROM service_orders ORDER BY position').all()) (orders[row.storeId]||=[]).push(row.serviceId);
  return orders;
}
function localDepartmentsByStore() {
  const groups={};
  for(const row of db.prepare('SELECT store_id AS storeId,id,name,active FROM departments ORDER BY sort_order,id').all())
    (groups[row.storeId]||=[]).push({id:row.id,name:row.name,active:!!row.active});
  return groups;
}
function localCatalog(storeId) {
  const sellers=db.prepare('SELECT id,name,store_id AS storeId,department_id AS departmentId,active FROM sellers').all();
  const services=orderServices(db.prepare("SELECT id,name,icon,active,CASE WHEN id=1 THEN 'dmax' WHEN id=5 THEN 'fvd' ELSE NULL END AS priorityCode FROM services ORDER BY sort_order,id").all(),serviceOrders(),storeId);
  return {sellers,services,departmentsByStore:localDepartmentsByStore()};
}
function statsFor(storeId,sellerId,today) {
  const rows=db.prepare(`SELECT id,store_id AS storeId,seller_id AS sellerId,department_id AS departmentId,
    service_id AS serviceId,business_date AS businessDate,created_at AS createdAt,deleted_at AS deletedAt,source
    FROM sales WHERE store_id=? AND business_date>=? AND business_date<=?`).all(storeId,earliestDate(today),today);
  return summarize(localCatalog(storeId),rows,sellerId,today,storeId);
}

// All clients in a store receive changes in real time, without polling.
const streams = new Set();
function broadcast(storeId, payload) {
  const text = `event: change\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const item of streams) {
    if (!storeId || item.storeId === storeId) {
      try { item.res.write(text); } catch { streams.delete(item); }
    }
  }
}
app.get('/api/events', (req,res) => {
  const store = activeStore(req.query.storeId);
  if (!store) return failure(res,'Magasin introuvable.',404);
  res.writeHead(200, { 'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'no-cache, no-transform', 'Connection':'keep-alive', 'X-Accel-Buffering':'no' });
  res.write('retry: 2500\nevent: ready\ndata: {}\n\n');
  const item = {res,storeId:store.id}; streams.add(item);
  const ping = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch {} }, 20000);
  req.on('close', () => { clearInterval(ping); streams.delete(item); });
});

app.get('/api/bootstrap', (req,res) => {
  const today = parisToday();
  const stores = db.prepare('SELECT id,name,city,address,lat,lon FROM stores WHERE active=1 ORDER BY name COLLATE NOCASE').all();
  const sellers = db.prepare('SELECT id,name,store_id AS storeId,department_id AS departmentId FROM sellers WHERE active=1').all().sort(comparePeople);
  const services = orderServices(db.prepare('SELECT id,name,icon FROM services WHERE active=1 ORDER BY sort_order,id').all(),serviceOrders(),req.query.storeId);
  const store = req.query.storeId ? activeStore(req.query.storeId) : null;
  const stats = store ? statsFor(store.id,req.query.sellerId,today) : null;
  res.json({ stores, sellers, services, departmentsByStore:localDepartmentsByStore(), today, stats, pushPublicKey:vapid.publicKey });
});

function localGoals(storeId,sellerId) {
  const rows=db.prepare('SELECT service_id AS serviceId,day,week,month,revision FROM seller_goals WHERE store_id=? AND seller_id=?').all(storeId,Number(sellerId));
  const schedule=db.prepare('SELECT days,revision FROM seller_workdays WHERE store_id=? AND seller_id=?').get(storeId,Number(sellerId));
  let days;try{days=JSON.parse(schedule?.days||'null');}catch{}
  return {goals:Object.fromEntries(rows.map(({serviceId,...entry})=>[`s${serviceId}`,entry])),
    workdays:normalizeWorkdays(days),workdaysRevision:schedule?.revision||null};
}
function saveLocalGoals(req,res) {
  const {storeId,sellerId,serviceId,values,revision}=req.body||{};
  if(!activeStore(storeId)||!activeSeller(sellerId,storeId)||!activeService(serviceId))return failure(res,'Choisissez un vendeur et un service valides.');
  if(!validGoalValues(values))return failure(res,'Les objectifs doivent être des entiers entre 0 et 9 999, ou être laissés vides.');
  if(revision!==null&&(typeof revision!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(revision)))return failure(res,'Actualisez les objectifs avant de les modifier.');
  const old=db.prepare('SELECT revision FROM seller_goals WHERE store_id=? AND seller_id=? AND service_id=?').get(storeId,Number(sellerId),Number(serviceId));
  if((old?.revision||null)!==revision)return failure(res,'Cet objectif a changé. Rechargez ses valeurs avant de le modifier.',409);
  const next=crypto.randomUUID();
  db.prepare(`INSERT INTO seller_goals(store_id,seller_id,service_id,day,week,month,revision) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(store_id,seller_id,service_id) DO UPDATE SET day=excluded.day,week=excluded.week,month=excluded.month,revision=excluded.revision`)
    .run(storeId,Number(sellerId),Number(serviceId),values.day,values.week,values.month,next);
  broadcast(storeId,{kind:'goals',sellerId:Number(sellerId)});res.json(localGoals(storeId,sellerId));
}
app.get('/api/goals',(req,res)=>{
  const {storeId,sellerId}=req.query;
  if(!activeStore(storeId)||!activeSeller(sellerId,storeId))return failure(res,'Choisissez un vendeur de ce magasin.');
  res.json(localGoals(storeId,sellerId));
});
app.post('/api/goals',saveLocalGoals);
app.get('/api/summary-goals',(req,res)=>{
  const {storeId}=req.query;
  if(!activeStore(storeId))return failure(res,'Choisissez un magasin valide.');
  const catalog=localCatalog(storeId),sellers=catalog.sellers.filter(s=>s.active&&s.storeId===storeId)
    .map(s=>({...s,...localGoals(storeId,s.id)}));
  res.set('Cache-Control','no-store').json(summaryGoals(sellers,catalog.services,
    departmentsForStore(catalog,storeId,{activeOnly:false}),parisToday()));
});

app.post('/api/sales', (req,res) => {
  const {storeId,sellerId,serviceId,requestId,clientId} = req.body || {};
  const store = activeStore(storeId), seller = activeSeller(sellerId,storeId), service = activeService(serviceId);
  if (!store || !seller || !service) return failure(res,'Choisissez un magasin, un vendeur et un service valides.');
  const safeRequest = typeof requestId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(requestId) ? requestId : null;
  if (safeRequest) {
    const existing = db.prepare('SELECT id,store_id,seller_id,service_id FROM sales WHERE request_id=?').get(safeRequest);
    if (existing) {
      if (existing.store_id !== store.id || existing.seller_id !== seller.id || existing.service_id !== service.id) return failure(res,'Identifiant de requête déjà utilisé.',409);
      return res.json({ id:existing.id, duplicate:true });
    }
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const departmentId=seller.department_id||TECH_DEPARTMENT_ID;
  db.prepare('INSERT INTO sales(id,request_id,store_id,seller_id,service_id,business_date,created_at,source,department_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id,safeRequest,store.id,seller.id,service.id,parisToday(),now,'sale',departmentId);
  const event = { kind:'sale', id, departmentId, sellerId:seller.id, sellerName:seller.name, serviceName:service.name, clientId:typeof clientId==='string'?clientId.slice(0,80):'' };
  broadcast(store.id,event);
  res.status(201).json({ id });
  // Only real new sales trigger pushes; corrections and administrative adjustments do not.
  const payload = JSON.stringify({ title:'Une vente pour l’équipe !', body:saleMessage(service.name,seller.name), tag:`sale-${id}`, url:'/' });
  const rows = db.prepare(`SELECT subscriptions.endpoint,subscriptions.subscription_json FROM subscriptions
    JOIN sellers ON sellers.id=subscriptions.seller_id AND sellers.store_id=subscriptions.store_id
    WHERE subscriptions.store_id=? AND sellers.active=1 AND sellers.department_id=?`).all(store.id,departmentId);
  for (const row of rows) {
    // A broken or expired subscription must not prevent delivery to the rest of the team.
    Promise.resolve().then(() => webpush.sendNotification(JSON.parse(row.subscription_json),payload,{TTL:3600, urgency:'normal'})).catch(error => {
      if (error.statusCode === 404 || error.statusCode === 410) db.prepare('DELETE FROM subscriptions WHERE endpoint=?').run(row.endpoint);
      else console.error('Push delivery failed:',error.statusCode || error.message);
    });
  }
});

app.post('/api/sales/remove', (req,res) => {
  const {storeId,sellerId,serviceId} = req.body || {};
  const seller=activeSeller(sellerId,storeId);
  if (!activeStore(storeId) || !seller || !activeService(serviceId)) return failure(res,'Sélection invalide.');
  const row = db.prepare(`SELECT id FROM sales WHERE store_id=? AND seller_id=? AND service_id=? AND business_date=? AND department_id=? AND deleted_at IS NULL
    ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(storeId,Number(sellerId),Number(serviceId),parisToday(),seller.department_id||TECH_DEPARTMENT_ID);
  if (!row) return failure(res,'Aucune vente à retirer pour ce service aujourd’hui.',409);
  db.prepare('UPDATE sales SET deleted_at=? WHERE id=? AND deleted_at IS NULL').run(new Date().toISOString(),row.id);
  broadcast(storeId,{kind:'correction'});
  res.json({ id:row.id });
});
app.delete('/api/sales/:id', (req,res) => {
  const {storeId,sellerId} = req.body || {};
  if (!activeStore(storeId) || !activeSeller(sellerId,storeId)) return failure(res,'Sélection invalide.');
  const result = db.prepare(`UPDATE sales SET deleted_at=? WHERE id=? AND store_id=? AND seller_id=? AND business_date=? AND deleted_at IS NULL`)
    .run(new Date().toISOString(),req.params.id,storeId,Number(sellerId),parisToday());
  if (!result.changes) return failure(res,'Cette vente ne peut plus être annulée.',409);
  broadcast(storeId,{kind:'correction'});
  res.json({ ok:true });
});

function allowedPushEndpoint(endpoint) {
  try {
    const u = new URL(endpoint); const h = u.hostname.toLowerCase();
    return u.protocol === 'https:' && !u.username && !u.password &&
      (h === 'fcm.googleapis.com' || h === 'android.googleapis.com' || h === 'jmt17.google.com' || h === 'updates.push.services.mozilla.com' || h === 'push.services.mozilla.com' || h.endsWith('.push.apple.com') || h === 'web.push.apple.com' || h.endsWith('.notify.windows.com'));
  } catch { return false; }
}
function validPushKeys(keys) {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(keys?.p256dh || '') || !/^[A-Za-z0-9_-]+$/.test(keys?.auth || '')) return false;
    const publicKey = Buffer.from(keys.p256dh, 'base64url'), auth = Buffer.from(keys.auth, 'base64url');
    if (publicKey.length !== 65 || publicKey[0] !== 4 || auth.length !== 16) return false;
    const curve = crypto.createECDH('prime256v1');
    curve.generateKeys(); curve.computeSecret(publicKey); // Reject malformed elliptic-curve points.
    return true;
  } catch { return false; }
}
app.post('/api/push/subscribe', (req,res) => {
  const {storeId,sellerId,subscription} = req.body || {};
  if (!activeStore(storeId) || !activeSeller(sellerId,storeId)) return failure(res,'Sélectionnez d’abord votre magasin et votre profil.');
  if (!subscription || typeof subscription.endpoint!=='string' || !allowedPushEndpoint(subscription.endpoint) ||
      !validPushKeys(subscription.keys)) return failure(res,'Abonnement aux notifications invalide.');
  db.prepare(`INSERT INTO subscriptions(endpoint,store_id,seller_id,subscription_json,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET store_id=excluded.store_id,seller_id=excluded.seller_id,subscription_json=excluded.subscription_json,updated_at=excluded.updated_at`)
    .run(subscription.endpoint,storeId,Number(sellerId),JSON.stringify(subscription),new Date().toISOString());
  res.json({ok:true});
});
app.delete('/api/push/subscribe', (req,res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== 'string' || !allowedPushEndpoint(endpoint)) return failure(res,'Abonnement invalide.');
  db.prepare('DELETE FROM subscriptions WHERE endpoint=?').run(endpoint);
  res.json({ok:true});
});

app.post('/api/admin/login', (req,res) => {
  // Avoid trusting arbitrary forwarding headers: in deployment put a rate-limiting proxy in front as well.
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (loginAttempts.get(ip) || []).filter(t => now-t < 15*60*1000);
  if (recent.length >= 8) return failure(res,'Trop de tentatives. Réessayez dans 15 minutes.',429);
  if (typeof req.body?.password !== 'string' || !checkPassword(req.body.password,getSetting('admin_password'))) {
    recent.push(now); loginAttempts.set(ip,recent); return failure(res,'Mot de passe incorrect.',401);
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token,{expiresAt:now+SESSION_MS});
  res.json({token});
});
app.post('/api/admin/logout', requireAdmin, (req,res) => { sessions.delete(req.adminToken); res.json({ok:true}); });
app.get('/api/admin/all', requireAdmin, (req,res) => {
  res.json({
    sellers:db.prepare('SELECT id,name,active,store_id AS storeId,department_id AS departmentId FROM sellers').all().sort(comparePeople),
    services:db.prepare('SELECT id,name,icon,active FROM services ORDER BY sort_order,id').all(),
    serviceOrders:serviceOrders(), departmentsByStore:localDepartmentsByStore(),
  });
});
app.get('/api/admin/goals',requireAdmin,(req,res)=>{
  const {storeId,sellerId}=req.query;
  if(!activeStore(storeId)||!activeSeller(sellerId,storeId))return failure(res,'Choisissez un vendeur de ce magasin.');
  res.json(localGoals(storeId,sellerId));
});
app.post('/api/admin/goals',requireAdmin,saveLocalGoals);
app.post('/api/admin/workdays',requireAdmin,(req,res)=>{
  const {storeId,sellerId,workdays,revision}=req.body||{};
  if(!activeStore(storeId)||!activeSeller(sellerId,storeId))return failure(res,'Choisissez un vendeur de ce magasin.');
  if(!validWorkdays(workdays))return failure(res,'Choisissez de un à sept jours différents, du lundi au dimanche.');
  if(revision!==null&&(typeof revision!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(revision)))return failure(res,'Actualisez les jours travaillés avant de les modifier.');
  const old=db.prepare('SELECT revision FROM seller_workdays WHERE store_id=? AND seller_id=?').get(storeId,Number(sellerId));
  if((old?.revision||null)!==revision)return failure(res,'Les jours travaillés ont changé. Rechargez-les avant de recommencer.',409);
  db.prepare(`INSERT INTO seller_workdays(store_id,seller_id,days,revision) VALUES (?,?,?,?)
    ON CONFLICT(store_id,seller_id) DO UPDATE SET days=excluded.days,revision=excluded.revision`)
    .run(storeId,Number(sellerId),JSON.stringify(normalizeWorkdays(workdays)),crypto.randomUUID());
  broadcast(storeId,{kind:'goals',sellerId:Number(sellerId)});res.json(localGoals(storeId,sellerId));
});
app.post('/api/admin/password', requireAdmin, (req,res) => {
  const {currentPassword,newPassword} = req.body || {};
  if (typeof currentPassword !== 'string' || !checkPassword(currentPassword,getSetting('admin_password'))) return failure(res,'Mot de passe actuel incorrect.',401);
  if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 200) return failure(res,'Le nouveau mot de passe doit comporter au moins 12 caractères.');
  setSetting('admin_password',makePasswordRecord(newPassword));
  for (const token of sessions.keys()) if (token !== req.adminToken) sessions.delete(token);
  try { fs.unlinkSync(path.join(dataDir,'ADMIN-INITIAL.txt')); } catch {}
  res.json({ok:true});
});
function localDepartments(storeId,activeOnly=true) {
  return departmentsForStore({departmentsByStore:localDepartmentsByStore()},storeId,{activeOnly});
}
function seedLocalDepartments(storeId) {
  if(db.prepare('SELECT 1 FROM departments WHERE store_id=? LIMIT 1').get(storeId))return;
  const insert=db.prepare('INSERT INTO departments(store_id,id,name,active,sort_order) VALUES (?,?,?,?,?)');
  DEFAULT_DEPARTMENTS.forEach((d,i)=>insert.run(storeId,d.id,d.name,1,i));
}
app.post('/api/admin/departments',requireAdmin,(req,res)=>{
  const {storeId}=req.body||{},name=cleanName(req.body?.name);
  if(!activeStore(storeId))return failure(res,'Choisissez d’abord un magasin valide.');
  if(!name)return failure(res,'Saisissez le nom du département.');
  const list=localDepartments(storeId,false);
  if(list.length>=30)return failure(res,'Nombre maximal de départements atteint.');
  if(list.some(d=>d.active&&d.name.localeCompare(name,'fr',{sensitivity:'base'})===0))return failure(res,'Ce département existe déjà dans ce magasin.',409);
  const id=`dep-${crypto.randomUUID()}`;
  db.transaction(()=>{seedLocalDepartments(storeId);db.prepare('INSERT INTO departments(store_id,id,name,active,sort_order) VALUES (?,?,?,?,?)').run(storeId,id,name,1,list.length);})();
  broadcast(storeId,{kind:'config'});res.status(201).json({id,ok:true});
});
app.patch('/api/admin/departments/:id',requireAdmin,(req,res)=>{
  const {storeId}=req.body||{},id=req.params.id;
  if(!activeStore(storeId))return failure(res,'Choisissez d’abord un magasin valide.');
  const list=localDepartments(storeId,false),row=list.find(d=>d.id===id);
  if(!row)return failure(res,'Département introuvable.',404);
  const name=typeof req.body?.name==='string'?cleanName(req.body.name):row.name;
  const active=typeof req.body?.active==='boolean'?req.body.active:!!row.active;
  if(!name)return failure(res,'Saisissez le nom du département.');
  if(!active&&row.active&&db.prepare('SELECT 1 FROM sellers WHERE store_id=? AND department_id=? AND active=1 LIMIT 1').get(storeId,id))return failure(res,'Réaffectez les vendeurs actifs avant d’archiver ce département.',409);
  if(!active&&row.active&&list.filter(d=>d.active).length<=1)return failure(res,'Conservez au moins un département actif.',409);
  if(active&&list.some(d=>d.id!==id&&d.active&&d.name.localeCompare(name,'fr',{sensitivity:'base'})===0))return failure(res,'Ce département existe déjà dans ce magasin.',409);
  db.transaction(()=>{seedLocalDepartments(storeId);db.prepare('UPDATE departments SET name=?,active=? WHERE store_id=? AND id=?').run(name,active?1:0,storeId,id);})();
  broadcast(storeId,{kind:'config'});res.json({id,ok:true});
});
const entityTable = kind => kind==='sellers' ? 'sellers' : kind==='services' ? 'services' : null;
function duplicateEntity(table,name,storeId,exceptId) {
  return db.prepare(`SELECT id,name,${table==='sellers'?'store_id AS storeId':'NULL AS storeId'} FROM ${table} WHERE active=1`).all()
    .some(x=>x.id!==exceptId&&(table!=='sellers'||x.storeId===storeId)&&x.name.localeCompare(name,'fr',{sensitivity:'base'})===0);
}
app.post('/api/admin/entities/:kind',requireAdmin,(req,res) => {
  const table=entityTable(req.params.kind), name=cleanName(req.body?.name),storeId=req.body?.storeId;
  if (!table || !name) return failure(res,'Saisissez un nom valide.');
  if(table==='sellers'&&!activeStore(storeId))return failure(res,'Choisissez d’abord un magasin valide.');
  const departmentId=req.body?.departmentId||TECH_DEPARTMENT_ID;
  if(table==='sellers'&&!localDepartments(storeId).some(d=>d.id===departmentId))return failure(res,'Choisissez un département actif de ce magasin.');
  if(duplicateEntity(table,name,storeId))return failure(res,'Ce nom existe déjà dans cette liste.',409);
  const order=db.prepare(`SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM ${table}`).get().n;
  const result=table==='sellers'?db.prepare('INSERT INTO sellers(name,sort_order,store_id,department_id) VALUES (?,?,?,?)').run(name,order,storeId,departmentId):db.prepare('INSERT INTO services(name,sort_order) VALUES (?,?)').run(name,order);
  broadcast(null,{kind:'config'});
  res.status(201).json({id:Number(result.lastInsertRowid)});
});
app.patch('/api/admin/entities/:kind/:id',requireAdmin,(req,res) => {
  const table=entityTable(req.params.kind),id=Number(req.params.id);
  const row=table&&isId(id)?db.prepare(`SELECT *,${table==='sellers'?'store_id':'NULL'} AS storeId FROM ${table} WHERE id=?`).get(id):null;
  if(!row)return failure(res,'Élément introuvable.',404);
  if(table==='sellers'&&req.body?.storeId!==undefined&&req.body.storeId!==row.storeId)return failure(res,'Ce vendeur appartient à un autre magasin.');
  const name=typeof req.body?.name==='string'?cleanName(req.body.name):row.name;
  const active=typeof req.body?.active==='boolean'?req.body.active:!!row.active;
  const departmentId=table==='sellers'?(req.body?.departmentId??row.department_id??TECH_DEPARTMENT_ID):null;
  if(!name)return failure(res,'Saisissez un nom valide.');
  if(table==='sellers'&&((req.body?.departmentId!==undefined)||active)&&!localDepartments(row.storeId).some(d=>d.id===departmentId))return failure(res,'Réaffectez ce vendeur à un département actif.',409);
  if(active&&duplicateEntity(table,name,row.storeId,id))return failure(res,'Ce nom existe déjà dans cette liste.',409);
  if(table==='sellers')db.prepare('UPDATE sellers SET name=?,active=?,department_id=? WHERE id=?').run(name,active?1:0,departmentId,id);
  else db.prepare('UPDATE services SET name=?,active=? WHERE id=?').run(name,active?1:0,id);
  broadcast(null,{kind:'config'});res.json({ok:true});
});
app.post('/api/admin/services/order',requireAdmin,(req,res)=>{
  const {storeId,serviceIds}=req.body||{},services=db.prepare('SELECT id FROM services').all();
  if(!activeStore(storeId))return failure(res,'Choisissez d’abord un magasin valide.');
  if(!Array.isArray(serviceIds)||serviceIds.length!==services.length||serviceIds.some(id=>!isId(id))||new Set(serviceIds.map(Number)).size!==serviceIds.length||
     serviceIds.some(id=>!services.some(s=>s.id===Number(id))))return failure(res,'La liste des services a changé. Actualisez et réessayez.');
  db.transaction(()=>{
    db.prepare('DELETE FROM service_orders WHERE store_id=?').run(storeId);
    const insert=db.prepare('INSERT INTO service_orders(store_id,service_id,position) VALUES (?,?,?)');
    serviceIds.forEach((id,index)=>insert.run(storeId,Number(id),index));
  })();
  broadcast(storeId,{kind:'config'});res.json({ok:true});
});
app.get('/api/admin/counts',requireAdmin,(req,res) => {
  const {storeId,sellerId}=req.query;
  if(!activeStore(storeId)||!activeSeller(sellerId,storeId)) return failure(res,'Sélection invalide.');
  const counts=db.prepare('SELECT service_id AS serviceId,COUNT(*) AS count FROM sales WHERE store_id=? AND seller_id=? AND business_date=? AND deleted_at IS NULL GROUP BY service_id')
    .all(storeId,Number(sellerId),parisToday());
  res.json({counts});
});
app.post('/api/admin/adjust',requireAdmin,(req,res) => {
  const {storeId,sellerId,serviceId,count}=req.body||{};
  if(!activeStore(storeId)||!activeSeller(sellerId,storeId)||!activeService(serviceId)||!Number.isInteger(count)||count<0||count>999) return failure(res,'Choisissez une quantité entière entre 0 et 999.');
  const today=parisToday();
  db.transaction(() => {
    const rows=db.prepare(`SELECT id FROM sales WHERE store_id=? AND seller_id=? AND service_id=? AND business_date=? AND deleted_at IS NULL ORDER BY created_at DESC,rowid DESC`)
      .all(storeId,Number(sellerId),Number(serviceId),today);
    const difference=count-rows.length;
    if(difference>0) {
      const add=db.prepare('INSERT INTO sales(id,store_id,seller_id,service_id,business_date,created_at,source,department_id) VALUES (?,?,?,?,?,?,?,?)');
      const departmentId=activeSeller(sellerId,storeId).department_id||TECH_DEPARTMENT_ID;
      for(let i=0;i<difference;i++) add.run(crypto.randomUUID(),storeId,Number(sellerId),Number(serviceId),today,new Date().toISOString(),'adjustment',departmentId);
    } else if(difference<0) {
      const del=db.prepare('UPDATE sales SET deleted_at=? WHERE id=?');
      for(const row of rows.slice(0,-difference)) del.run(new Date().toISOString(),row.id);
    }
  })();
  broadcast(storeId,{kind:'adjustment'}); res.json({ok:true});
});
app.post('/api/admin/stores',requireAdmin,(req,res) => {
  const name=cleanName(req.body?.name);
  const lat=req.body?.lat,lon=req.body?.lon;
  const coordinatesEmpty = (lat===''||lat===null||lat===undefined) && (lon===''||lon===null||lon===undefined);
  if(!name) return failure(res,'Saisissez le nom du magasin.');
  if(!coordinatesEmpty && (!Number.isFinite(Number(lat))||!Number.isFinite(Number(lon))||Math.abs(Number(lat))>90||Math.abs(Number(lon))>180||lat===''||lon==='')) return failure(res,'Coordonnées GPS invalides.');
  if(db.prepare('SELECT 1 FROM stores WHERE lower(name)=lower(?) AND active=1').get(name)) return failure(res,'Ce magasin existe déjà.',409);
  const id=`custom-${crypto.randomUUID()}`;
  db.prepare('INSERT INTO stores(id,name,city,address,lat,lon) VALUES (?,?,?,?,?,?)').run(id,name,'','',coordinatesEmpty?null:Number(lat),coordinatesEmpty?null:Number(lon));
  broadcast(null,{kind:'config'});res.status(201).json({id});
});

app.get('/api/health',(req,res) => res.json({ok:true}));
app.use(express.static(path.join(root,'dist'), { index:false, maxAge:'1h', setHeaders(res,filePath) {
  if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.webmanifest')) res.setHeader('Cache-Control','no-cache');
}}));
app.get('*',(req,res) => res.sendFile(path.join(root,'dist','index.html')));
app.use((err,req,res,next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({error:'Une erreur est survenue. Réessayez.'});
});
const port = Number(process.env.PORT || 4173);
app.listen(port,'0.0.0.0',() => console.log(`Fnac Pulse est prêt sur le port ${port}.`));

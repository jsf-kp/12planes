'use strict';
// 12 Planes strategy app: the argument map and Present, behind email-code sign-in.
// Team members edit directly. Client members suggest, and the team accepts or rejects.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store');

const PORT = Number(process.env.PORT || 8080);
const SECRET = process.env.SESSION_SECRET || (console.warn('[warn] SESSION_SECRET not set; sessions reset on restart'), crypto.randomBytes(32).toString('hex'));
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const MAIL_FROM = String(process.env.MAIL_FROM || '').trim().replace(/^["']+|["']+$/g, '');
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'Kontrapunkt';
const clean = v => String(v || '').trim().replace(/^["']+|["']+$/g, '').trim();
const BREVO_KEY = clean(process.env.BREVO_API_KEY);
if (BREVO_KEY) console.log(`[mail] Brevo key loaded: starts ${BREVO_KEY.slice(0, 8)}…, ${BREVO_KEY.length} characters${BREVO_KEY.startsWith('xkeysib-') ? '' : ' · WARNING: an API key starts with xkeysib-'}`);
const DEV = !BREVO_KEY; // without a mail key, codes are printed to the server log (local testing only)
const SECURE = APP_URL.startsWith('https://');
const PUB = path.join(__dirname, 'public');
const SESSION_DAYS = 30;
const PW = { team: String(process.env.TEAM_PASSWORD || '').trim(), client: String(process.env.CLIENT_PASSWORD || '').trim() };
if (!PW.team || !PW.client) console.warn('[warn] TEAM_PASSWORD and CLIENT_PASSWORD must both be set for password sign-in');
// a short fingerprint of each password, stored in the session, so changing a password signs everyone with it out
const pwv = role => PW[role] ? hmac('pw:' + role + ':' + PW[role]).slice(0, 12) : 'none';

// ---------- helpers ----------
const hmac = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 200;
const ID_RE = /^[A-Za-z0-9_\-.:@+]{1,120}$/;
const COLS = new Set(['content', 'suggestions', 'log', 'decisions', 'people', 'config']);

function readBody(req, limit = 300 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (_) { reject(new Error('bad_json')); } });
    req.on('error', reject);
  });
}

function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function sessionCookie(uid, role) {
  const payload = Buffer.from(JSON.stringify({ uid, pv: role ? pwv(role) : null, exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  return `kp12=${payload}.${hmac(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${SECURE ? '; Secure' : ''}`;
}
async function currentUser(req) {
  const c = cookies(req).kp12; if (!c) return null;
  const [payload, sig] = c.split('.');
  if (!payload || !sig) return null;
  const good = hmac(payload);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  let s; try { s = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch (_) { return null; }
  if (!s.uid || s.exp < Date.now()) return null;
  const p = await store.personById(s.uid);
  if (!p || !p.active) return null;
  if (s.pv && s.pv !== pwv(p.role)) return null; // password changed since sign-in
  return p;
}

// simple in-memory rate limit
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(); const h = (hits.get(key) || []).filter(t => now - t < windowMs);
  h.push(now); hits.set(key, h); return h.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 36e5)) hits.delete(k); }, 6e5).unref();

async function effectiveMode(p) {
  const cfg = await store.get('config', 'people');
  const ov = cfg && cfg.data && cfg.data.overrides && cfg.data.overrides[p.id];
  return ov === 'edit' || ov === 'suggest' ? ov : (p.role === 'team' ? 'edit' : 'suggest');
}

async function sendCode(email, code) {
  if (DEV) { console.log(`[dev] sign-in code for ${email}: ${code}`); return true; }
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: MAIL_FROM, name: MAIL_FROM_NAME }, to: [{ email }],
      subject: `Your 12 Planes sign-in code: ${code}`,
      textContent: `Your sign-in code for the 12 Planes strategy is ${code}.\n\nIt works for 10 minutes. If you did not ask for it, you can ignore this email.\n\n${APP_URL}`,
      htmlContent: `<p style="font-family:Arial,sans-serif;font-size:15px">Your sign-in code for the 12 Planes strategy is</p><p style="font-family:Arial,sans-serif;font-size:32px;letter-spacing:6px;margin:16px 0"><b>${code}</b></p><p style="font-family:Arial,sans-serif;font-size:13px;color:#444">It works for 10 minutes. If you did not ask for it, you can ignore this email.</p>`
    })
  });
  if (!r.ok) console.error('[mail] Brevo error', r.status, (await r.text()).slice(0, 300));
  return r.ok;
}

// ---------- static files ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const PUBLIC_FILES = new Set(['/login.html', '/login.js', '/favicon.ico']);
function serveFile(res, rel) {
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(404); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': rel.endsWith('.html') || rel.endsWith('.json') ? 'no-cache' : 'public, max-age=3600' });
    res.end(buf);
  });
}

// ---------- write rules (enforced here, not only in the page) ----------
async function canWrite(p, mode, op, col, id, data) {
  switch (col) {
    case 'content': return mode === 'edit';
    case 'decisions': return mode === 'edit' && op === 'add';
    case 'suggestions':
      if (op === 'add') return data && data.state === 'open';
      return mode === 'edit'; // deciding on a suggestion
    case 'log': return op === 'add' && mode === 'edit';
    case 'people': return id === p.id; // each person writes only their own record
    case 'config': return p.admin;
    default: return false;
  }
}

// ---------- API ----------
async function api(req, res, url, p) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const mode = await effectiveMode(p);

  if (req.method === 'GET' && parts[1] === 'me') {
    return json(res, 200, { id: p.id, name: p.name, email: p.email, role: p.role, admin: p.admin, guest: p.role !== 'team', mode });
  }
  if (req.method === 'GET' && parts[1] === 'profiles') {
    const all = await store.listPeople();
    const out = {}; all.forEach(x => { out[x.id] = { id: x.id, name: x.name || x.email.split('@')[0], guest: x.role !== 'team' }; });
    return json(res, 200, out);
  }
  if (req.method === 'GET' && parts[1] === 'state') {
    const cols = String(url.searchParams.get('cols') || '').split(',').filter(c => COLS.has(c));
    const out = {}; for (const c of cols) out[c] = await store.list(c);
    return json(res, 200, out);
  }
  if (parts[1] === 'd' && parts.length === 4) { // /api/d/:col/:id
    const [col, id] = [parts[2], decodeURIComponent(parts[3])];
    if (!COLS.has(col) || !ID_RE.test(id)) return json(res, 400, { error: 'invalid_argument' });
    if (req.method === 'GET') { const d = await store.get(col, id); return json(res, 200, d || { id, data: null }); }
    if (req.method === 'PUT' || req.method === 'PATCH') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'invalid_argument' });
      const op = req.method === 'PUT' ? 'set' : 'update';
      if (!(await canWrite(p, mode, op, col, id, body))) return json(res, 403, { error: 'invalid_argument' });
      let data = body;
      if (op === 'update') { const cur = await store.get(col, id); if (!cur) return json(res, 400, { error: 'invalid_argument' }); data = { ...cur.data, ...body }; }
      await store.set(col, id, data, p.id);
      return json(res, 200, { ok: true });
    }
  }
  if (parts[1] === 'c' && parts.length === 3 && req.method === 'POST') { // /api/c/:col  (add)
    const col = parts[2];
    if (!COLS.has(col)) return json(res, 400, { error: 'invalid_argument' });
    const body = await readBody(req);
    if (!(await canWrite(p, mode, 'add', col, null, body))) return json(res, 403, { error: 'invalid_argument' });
    const id = crypto.randomUUID();
    await store.set(col, id, { ...body, by: p.id, at: Date.now() }, p.id);
    return json(res, 200, { id });
  }
  // admin: who has access
  if (parts[1] === 'admin') {
    if (!p.admin) return json(res, 403, { error: 'not_admin' });
    if (parts[2] === 'people' && req.method === 'GET') return json(res, 200, await store.listPeople());
    if (parts[2] === 'people' && req.method === 'POST') {
      const b = await readBody(req); const email = normEmail(b.email);
      if (!validEmail(email)) return json(res, 400, { error: 'Enter a valid email address' });
      const existing = await store.personByEmail(email);
      const person = await store.upsertPerson({ id: existing ? existing.id : crypto.randomUUID(), email, name: String(b.name || '').slice(0, 120), role: b.role, admin: !!b.admin && b.role === 'team', active: b.active !== false });
      return json(res, 200, person);
    }
    if (parts[2] === 'import' && req.method === 'POST') { // one-off move of edits from the Claude artifact
      const b = await readBody(req, 5 * 1024 * 1024); let n = 0;
      for (const [col, docs] of Object.entries(b.collections || {})) {
        if (!COLS.has(col) || col === 'people' || col === 'config') continue;
        for (const d of docs) { if (ID_RE.test(d.id)) { await store.set(col, d.id, d.data, p.id); n++; } }
      }
      return json(res, 200, { imported: n });
    }
  }
  return json(res, 404, { error: 'not_found' });
}

// ---------- auth ----------
async function auth(req, res, url) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (url.pathname === '/auth/password' && req.method === 'POST') {
    const b = await readBody(req);
    if (limited('pw:' + ip, 10, 15 * 6e4)) return json(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' });
    const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const pw = String(b.password || '');
    if (name.length < 2) return json(res, 400, { error: 'Type your name, so the team can see who changed what.' });
    const eq = (a, c) => !!c && a.length === c.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(c));
    const role = eq(pw, PW.team) ? 'team' : eq(pw, PW.client) ? 'client' : null;
    if (!role) return json(res, 400, { error: 'That password is not right.' });
    const key = 'name:' + role + ':' + name.toLowerCase();
    const ex = await store.personByEmail(key);
    if (ex && !ex.active) return json(res, 403, { error: 'Access for this name has been turned off. Ask the Kontrapunkt team.' });
    const p = ex || await store.upsertPerson({ id: crypto.randomUUID(), email: key, name, role, admin: role === 'team' });
    res.setHeader('set-cookie', sessionCookie(p.id, role));
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/auth/request' && req.method === 'POST') {
    const b = await readBody(req); const email = normEmail(b.email);
    if (limited('ip:' + ip, 20, 15 * 6e4) || limited('em:' + email, 5, 15 * 6e4)) return json(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' });
    const p = validEmail(email) ? await store.personByEmail(email) : null;
    if (p && p.active) {
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
      await store.putCode(email, hmac(email + ':' + code), Date.now() + 10 * 6e4);
      await sendCode(email, code);
    }
    return json(res, 200, { ok: true }); // same answer either way, so the list of people stays private
  }
  if (url.pathname === '/auth/verify' && req.method === 'POST') {
    const b = await readBody(req); const email = normEmail(b.email); const code = String(b.code || '').replace(/\D/g, '');
    if (limited('vip:' + ip, 30, 15 * 6e4)) return json(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' });
    const row = await store.getCode(email);
    if (!row || Number(row.expires) < Date.now() || Number(row.attempts) >= 5) return json(res, 400, { error: 'That code has expired. Ask for a new one.' });
    const good = hmac(email + ':' + code);
    if (good.length !== row.hash.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(row.hash))) { await store.bumpCode(email); return json(res, 400, { error: 'That code is not right. Check the email and try again.' }); }
    await store.dropCode(email);
    const p = await store.personByEmail(email);
    if (!p || !p.active) return json(res, 400, { error: 'This email does not have access.' });
    res.setHeader('set-cookie', sessionCookie(p.id));
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/auth/logout') {
    res.writeHead(302, { 'set-cookie': `kp12=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE ? '; Secure' : ''}`, location: '/login.html' });
    return res.end();
  }
  return json(res, 404, { error: 'not_found' });
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');
  res.setHeader('x-frame-options', 'DENY');
  if (SECURE) res.setHeader('strict-transport-security', 'max-age=31536000');
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    if (url.pathname.startsWith('/auth/')) return await auth(req, res, url);
    if (PUBLIC_FILES.has(url.pathname)) return serveFile(res, url.pathname);
    const p = await currentUser(req);
    if (url.pathname.startsWith('/api/')) return p ? await api(req, res, url, p) : json(res, 401, { error: 'signed_out' });
    if (!p) { res.writeHead(302, { location: '/login.html' }); return res.end(); }
    if (url.pathname === '/') return serveFile(res, '/index.html');
    if (url.pathname === '/admin.html' && !p.admin) { res.writeHead(302, { location: '/' }); return res.end(); }
    return serveFile(res, url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, e.message === 'too_large' ? 413 : e.message === 'bad_json' ? 400 : 500, { error: 'server_error' });
  }
});

(async () => {
  await store.init();
  // first admins come from ADMIN_EMAILS, so someone can sign in and invite everyone else
  for (const e of String(process.env.ADMIN_EMAILS || '').split(',').map(normEmail).filter(validEmail)) {
    const ex = await store.personByEmail(e);
    if (!ex) await store.upsertPerson({ id: crypto.randomUUID(), email: e, name: '', role: 'team', admin: true });
  }
  server.listen(PORT, () => console.log(`12 Planes app on ${APP_URL} (port ${PORT})${DEV ? ' · DEV mail: codes printed here' : ''}`));
})();

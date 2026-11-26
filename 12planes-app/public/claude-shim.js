// Gives the map and Present the same small data API they use inside Claude,
// backed by this app's server. Polls every few seconds for other people's changes.
(function () {
  const POLL_MS = 4000;
  const colSubs = new Map();   // col -> Set(fn)
  const docSubs = new Map();   // "col/id" -> Set(fn)
  let timer = null, busy = false;

  const err = code => Object.assign(new Error(code), { code });
  async function call(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { location.href = '/login.html'; throw err('revoked'); }
    if (r.status === 403 || r.status === 400) throw err('invalid_argument');
    if (!r.ok) throw err('unavailable');
    return r.json();
  }
  const snapDoc = (id, data) => ({ id, exists: data != null, data: () => (data == null ? undefined : data), metadata: { fromCache: false, hasPendingWrites: false } });

  async function poll() {
    if (busy) return; busy = true;
    try {
      const cols = new Set([...colSubs.keys(), ...[...docSubs.keys()].map(k => k.split('/')[0])]);
      if (!cols.size) return;
      const state = await call('GET', '/api/state?cols=' + [...cols].join(','));
      for (const [col, fns] of colSubs) {
        const docs = (state[col] || []).map(d => snapDoc(d.id, d.data));
        const snap = { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
        fns.forEach(fn => { try { fn(snap); } catch (e) { console.error(e); } });
      }
      for (const [key, fns] of docSubs) {
        const [col, id] = key.split('/');
        const d = (state[col] || []).find(x => x.id === id);
        fns.forEach(fn => { try { fn(snapDoc(id, d ? d.data : null)); } catch (e) { console.error(e); } });
      }
    } catch (_) { /* keep polling */ } finally { busy = false; }
  }
  function ensureTimer() { if (!timer) { timer = setInterval(poll, POLL_MS); setTimeout(poll, 0); } }
  const nudge = () => setTimeout(poll, 50);

  function docRef(col, id) {
    const key = col + '/' + id;
    return {
      id, path: key,
      async get() { const d = await call('GET', `/api/d/${col}/${encodeURIComponent(id)}`); return snapDoc(id, d.data); },
      async set(data) { await call('PUT', `/api/d/${col}/${encodeURIComponent(id)}`, data); nudge(); },
      async update(data) { await call('PATCH', `/api/d/${col}/${encodeURIComponent(id)}`, data); nudge(); },
      onSnapshot(next) { if (!docSubs.has(key)) docSubs.set(key, new Set()); docSubs.get(key).add(next); ensureTimer(); return () => docSubs.get(key).delete(next); },
      collection() { throw new Error('not supported'); }
    };
  }
  function colRef(col) {
    return {
      path: col,
      doc(id) { return docRef(col, id); },
      async add(data) { const r = await call('POST', `/api/c/${col}`, data); nudge(); return docRef(col, r.id); },
      onSnapshot(next) { if (!colSubs.has(col)) colSubs.set(col, new Set()); colSubs.get(col).add(next); ensureTimer(); return () => colSubs.get(col).delete(next); },
      async get() { const s = await call('GET', '/api/state?cols=' + col); const docs = (s[col] || []).map(d => snapDoc(d.id, d.data)); return { docs, size: docs.length, empty: !docs.length }; }
    };
  }
  const db = {
    collection: c => colRef(c),
    doc: p => { const [c, id] = p.split('/'); return docRef(c, id); }
  };

  let meP = null, profP = null;
  const me = () => (meP ||= call('GET', '/api/me'));
  const user = {
    async me() { const m = await me(); return { id: m.id, name: m.name || '', email: m.email, canEdit: !!m.admin, isOwner: false, avatarUrl: '', color: '#917d46' }; },
    async id() { return (await me()).id; },
    async isOwner() { return false; },
    async canEdit() { return !!(await me()).admin; },
    async can(name) { return name === 'data.write' ? true : false; },
    async profiles(ids) {
      let all = await (profP ||= call('GET', '/api/profiles'));
      if ([].concat(ids).some(id => !all[id])) { profP = call('GET', '/api/profiles'); all = await profP; }
      const m = await me(); const out = {};
      [].concat(ids).forEach(id => { const p = all[id]; out[id] = { id, name: p ? p.name : '', guest: p ? p.guest : false, isMe: id === m.id, avatarUrl: '', color: '#917d46', email: null, roles: null }; });
      return out;
    },
    async search() { return []; }
  };

  window.claude = { use: async name => (name === 'db' ? db : name === 'user' ? user : null) };
})();

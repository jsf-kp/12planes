'use strict';
// Storage for the 12 Planes app.
// Production: PostgreSQL (Clever Cloud add-on, via DATABASE_URL or POSTGRESQL_ADDON_URI).
// Local testing: Node's built-in SQLite, when no Postgres URL is set.

const PG_URL = process.env.DATABASE_URL || process.env.POSTGRESQL_ADDON_URI || '';

let q; // q(sql, params) -> rows. SQL is written with $1, $2 placeholders.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS docs (
     col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
     updated_at BIGINT NOT NULL, updated_by TEXT, PRIMARY KEY (col, id))`,
  `CREATE TABLE IF NOT EXISTS people (
     id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
     role TEXT NOT NULL DEFAULT 'client', admin INTEGER NOT NULL DEFAULT 0,
     active INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS codes (
     email TEXT PRIMARY KEY, hash TEXT NOT NULL, expires BIGINT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)`
];

async function init() {
  if (PG_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: PG_URL, max: 5, ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false } });
    q = async (sql, params = []) => (await pool.query(sql, params)).rows;
  } else {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.SQLITE_FILE || ':memory:');
    q = async (sql, params = []) => {
      const s = db.prepare(sql.replace(/\$\d+/g, '?'));
      return /^\s*(select|with)/i.test(sql) || /returning/i.test(sql) ? s.all(...params) : (s.run(...params), []);
    };
    console.log('[store] using local SQLite (no DATABASE_URL set)');
  }
  for (const s of SCHEMA) await q(s);
}

const parse = r => ({ id: r.id, data: JSON.parse(r.data), updatedAt: Number(r.updated_at), updatedBy: r.updated_by });

async function list(col) {
  return (await q('SELECT id, data, updated_at, updated_by FROM docs WHERE col = $1', [col])).map(parse);
}
async function get(col, id) {
  const r = await q('SELECT id, data, updated_at, updated_by FROM docs WHERE col = $1 AND id = $2', [col, id]);
  return r[0] ? parse(r[0]) : null;
}
async function set(col, id, data, by) {
  await q(`INSERT INTO docs (col, id, data, updated_at, updated_by) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (col, id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [col, id, JSON.stringify(data), Date.now(), by || null]);
}

// people
const personRow = r => r && ({ id: r.id, email: r.email, name: r.name, role: r.role, admin: !!Number(r.admin), active: !!Number(r.active), createdAt: Number(r.created_at) });
async function personByEmail(email) { return personRow((await q('SELECT * FROM people WHERE email = $1', [email]))[0]); }
async function personById(id) { return personRow((await q('SELECT * FROM people WHERE id = $1', [id]))[0]); }
async function listPeople() { return (await q('SELECT * FROM people ORDER BY created_at')).map(personRow); }
async function upsertPerson({ id, email, name, role, admin, active }) {
  await q(`INSERT INTO people (id, email, name, role, admin, active, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, admin = EXCLUDED.admin, active = EXCLUDED.active`,
    [id, email, name || '', role === 'team' ? 'team' : 'client', admin ? 1 : 0, active === false ? 0 : 1, Date.now()]);
  return personByEmail(email);
}

// login codes
async function putCode(email, hash, expires) {
  await q(`INSERT INTO codes (email, hash, expires, attempts) VALUES ($1, $2, $3, 0)
           ON CONFLICT (email) DO UPDATE SET hash = EXCLUDED.hash, expires = EXCLUDED.expires, attempts = 0`, [email, hash, expires]);
}
async function getCode(email) { return (await q('SELECT * FROM codes WHERE email = $1', [email]))[0] || null; }
async function bumpCode(email) { await q('UPDATE codes SET attempts = attempts + 1 WHERE email = $1', [email]); }
async function dropCode(email) { await q('DELETE FROM codes WHERE email = $1', [email]); }

module.exports = { init, list, get, set, personByEmail, personById, listPeople, upsertPerson, putCode, getCode, bumpCode, dropCode };

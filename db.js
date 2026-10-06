'use strict';
// Storage + inventory rules. Every stock change goes through applyMovement()
// so the item quantity and the movement log can never drift apart.

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const MOVEMENT_TYPES = new Set(['in', 'out', 'adjust', 'count']);

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode    TEXT UNIQUE,
      sku        TEXT,
      name       TEXT NOT NULL,
      category   TEXT DEFAULT '',
      unit       TEXT DEFAULT 'pcs',
      qty        REAL NOT NULL DEFAULT 0,
      min_qty    REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS movements (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      delta      REAL NOT NULL,
      qty_after  REAL NOT NULL,
      note       TEXT DEFAULT '',
      source     TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS movements_created ON movements(created_at DESC);
    -- Live stocktake: one shared session, every device scanning adds to it.
    CREATE TABLE IF NOT EXISTS count_session (
      item_id    INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
      counted    REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  return new Inventory(db);
}

const now = () => new Date().toISOString();
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v) => (v == null ? '' : String(v).trim());

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

class Inventory {
  constructor(db) {
    this.db = db;
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---- items ---------------------------------------------------------------

  listItems() {
    return this.db.prepare('SELECT * FROM items ORDER BY name COLLATE NOCASE').all();
  }

  getItem(id) {
    return this.db.prepare('SELECT * FROM items WHERE id = ?').get(num(id));
  }

  findByCode(code) {
    code = str(code);
    if (!code) return undefined;
    return (
      this.db.prepare('SELECT * FROM items WHERE barcode = ?').get(code) ||
      this.db.prepare('SELECT * FROM items WHERE sku = ? COLLATE NOCASE').get(code)
    );
  }

  createItem(input) {
    const name = str(input.name);
    if (!name) throw new HttpError(400, 'Item name is required');
    const barcode = str(input.barcode) || null;
    if (barcode && this.findByCode(barcode)) throw new HttpError(409, `Barcode ${barcode} already exists`);
    return this.tx(() => {
      const info = this.db
        .prepare(
          `INSERT INTO items (barcode, sku, name, category, unit, qty, min_qty, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(barcode, str(input.sku), name, str(input.category), str(input.unit) || 'pcs', num(input.min_qty), now());
      const id = Number(info.lastInsertRowid);
      const startQty = num(input.qty);
      if (startQty) this._move(id, 'in', startQty, 'Opening stock', str(input.source) || 'app');
      return this.getItem(id);
    });
  }

  updateItem(id, input) {
    const item = this.getItem(id);
    if (!item) throw new HttpError(404, 'Item not found');
    const next = { ...item };
    for (const k of ['sku', 'name', 'category', 'unit']) if (k in input) next[k] = str(input[k]);
    if ('barcode' in input) next.barcode = str(input.barcode) || null;
    if ('min_qty' in input) next.min_qty = num(input.min_qty);
    if (!next.name) throw new HttpError(400, 'Item name is required');
    if (next.barcode && next.barcode !== item.barcode && this.findByCode(next.barcode)) {
      throw new HttpError(409, `Barcode ${next.barcode} already exists`);
    }
    this.db
      .prepare(
        `UPDATE items SET barcode=?, sku=?, name=?, category=?, unit=?, min_qty=?, updated_at=? WHERE id=?`
      )
      .run(next.barcode, next.sku, next.name, next.category, next.unit, next.min_qty, now(), item.id);
    // Quantity is never edited directly: it becomes a logged adjustment.
    if ('qty' in input && num(input.qty) !== item.qty) {
      this.applyMovement({ item_id: item.id, type: 'count', qty: num(input.qty), note: 'Manual edit', source: input.source });
    }
    return this.getItem(item.id);
  }

  deleteItem(id) {
    const item = this.getItem(id);
    if (!item) throw new HttpError(404, 'Item not found');
    this.db.prepare('DELETE FROM items WHERE id = ?').run(item.id);
    return item;
  }

  // ---- movements -----------------------------------------------------------

  // type: in (+qty) | out (-qty) | adjust (+/- qty) | count (set qty to value)
  _move(itemId, type, qty, note, source) {
    const item = this.getItem(itemId);
    const delta = type === 'in' ? qty : type === 'out' ? -qty : type === 'count' ? qty - item.qty : qty;
    const qtyAfter = Math.round((item.qty + delta) * 1000) / 1000;
    const ts = now();
    this.db.prepare('UPDATE items SET qty = ?, updated_at = ? WHERE id = ?').run(qtyAfter, ts, itemId);
    const info = this.db
      .prepare(
        `INSERT INTO movements (item_id, type, delta, qty_after, note, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(itemId, type, delta, qtyAfter, str(note), str(source), ts);
    return { movement: this.getMovement(Number(info.lastInsertRowid)), item: this.getItem(itemId) };
  }

  applyMovement(input) {
    const type = str(input.type) || 'out';
    if (!MOVEMENT_TYPES.has(type)) throw new HttpError(400, `type must be one of: ${[...MOVEMENT_TYPES].join(', ')}`);
    const item = input.item_id != null ? this.getItem(input.item_id) : this.findByCode(input.barcode ?? input.sku);
    if (!item) throw new HttpError(404, 'Item not found', { unknown: true, barcode: str(input.barcode ?? input.sku) });
    const qty = num(input.qty, type === 'count' ? NaN : 1);
    if (!Number.isFinite(qty)) throw new HttpError(400, 'qty is required for a count');
    if ((type === 'in' || type === 'out') && qty <= 0) throw new HttpError(400, 'qty must be greater than 0');
    if (type === 'count' && qty < 0) throw new HttpError(400, 'Counted qty cannot be negative');
    return this.tx(() => this._move(item.id, type, qty, input.note, input.source));
  }

  getMovement(id) {
    return this.db
      .prepare(
        `SELECT m.*, i.name AS item_name, i.unit AS unit FROM movements m JOIN items i ON i.id = m.item_id WHERE m.id = ?`
      )
      .get(id);
  }

  listMovements({ limit = 100, item_id } = {}) {
    limit = Math.min(Math.max(num(limit, 100), 1), 1000);
    const where = item_id ? 'WHERE m.item_id = ?' : '';
    const args = item_id ? [num(item_id), limit] : [limit];
    return this.db
      .prepare(
        `SELECT m.*, i.name AS item_name, i.unit AS unit FROM movements m JOIN items i ON i.id = m.item_id
         ${where} ORDER BY m.id DESC LIMIT ?`
      )
      .all(...args);
  }

  // ---- live stocktake ------------------------------------------------------

  countSession() {
    return this.db
      .prepare(
        `SELECT c.item_id, c.counted, c.updated_at, i.name, i.barcode, i.unit, i.qty AS system_qty,
                c.counted - i.qty AS variance
         FROM count_session c JOIN items i ON i.id = c.item_id ORDER BY c.updated_at DESC`
      )
      .all();
  }

  countAdd({ item_id, barcode, qty = 1, set }) {
    const item = item_id != null ? this.getItem(item_id) : this.findByCode(barcode);
    if (!item) throw new HttpError(404, 'Item not found', { unknown: true, barcode: str(barcode) });
    let v;
    if (set != null) {
      v = num(set, NaN);
      if (!Number.isFinite(v) || v < 0) throw new HttpError(400, 'Count must be 0 or more');
    } else {
      const cur = this.db.prepare('SELECT counted FROM count_session WHERE item_id = ?').get(item.id);
      v = Math.max((cur ? cur.counted : 0) + num(qty, 1), 0);
    }
    this.db
      .prepare(
        `INSERT INTO count_session (item_id, counted, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET counted = excluded.counted, updated_at = excluded.updated_at`
      )
      .run(item.id, v, now());
    return this.countSession().find((r) => r.item_id === item.id);
  }

  countRemove(itemId) {
    this.db.prepare('DELETE FROM count_session WHERE item_id = ?').run(num(itemId));
  }

  // Commit counted quantities as stock (one logged 'count' movement per item).
  countCommit({ source } = {}) {
    return this.tx(() => {
      const rows = this.countSession();
      const results = rows.map((r) => this._move(r.item_id, 'count', r.counted, 'Stocktake', source || 'stocktake'));
      this.db.exec('DELETE FROM count_session');
      return results;
    });
  }

  countClear() {
    this.db.exec('DELETE FROM count_session');
  }

  // ---- CSV -----------------------------------------------------------------

  exportCsv() {
    const cols = ['barcode', 'sku', 'name', 'category', 'unit', 'qty', 'min_qty', 'updated_at'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [cols.join(','), ...this.listItems().map((it) => cols.map((c) => esc(it[c])).join(','))].join('\n') + '\n';
  }

  // Upsert by barcode (or sku, or name). qty column, when present, becomes a stock count.
  importCsv(text, { source = 'import' } = {}) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new HttpError(400, 'CSV needs a header row and at least one item');
    const header = rows[0].map((h) => h.trim().toLowerCase());
    if (!header.includes('name')) throw new HttpError(400, 'CSV needs a "name" column');
    let created = 0;
    let updated = 0;
    this.tx(() => {
      for (const cells of rows.slice(1)) {
        if (cells.every((c) => !c.trim())) continue;
        const rec = Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
        let item = this.findByCode(rec.barcode) || this.findByCode(rec.sku);
        if (!item && rec.name) item = this.db.prepare('SELECT * FROM items WHERE name = ? COLLATE NOCASE').get(rec.name);
        if (!item) {
          if (!rec.name) continue;
          const info = this.db
            .prepare(
              `INSERT INTO items (barcode, sku, name, category, unit, qty, min_qty, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
            )
            .run(rec.barcode || null, rec.sku || '', rec.name, rec.category || '', rec.unit || 'pcs', num(rec.min_qty), now());
          item = this.getItem(Number(info.lastInsertRowid));
          created++;
        } else {
          this.db
            .prepare(
              `UPDATE items SET barcode = COALESCE(?, barcode), sku = COALESCE(?, sku), name = COALESCE(?, name),
               category = COALESCE(?, category), unit = COALESCE(?, unit), min_qty = COALESCE(?, min_qty), updated_at = ? WHERE id = ?`
            )
            .run(rec.barcode || null, rec.sku || null, rec.name || null, rec.category || null, rec.unit || null,
              rec.min_qty ? num(rec.min_qty) : null, now(), item.id);
          updated++;
        }
        if (rec.qty !== undefined && rec.qty !== '' && num(rec.qty, NaN) !== this.getItem(item.id).qty) {
          this._move(item.id, 'count', num(rec.qty), 'CSV import', source);
        }
      }
    });
    return { created, updated };
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

module.exports = { open, HttpError, parseCsv };

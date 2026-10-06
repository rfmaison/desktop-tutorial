'use strict';
// Red Panda Inventory server: REST API + live updates (Server-Sent Events) + web app.
// No npm dependencies — needs Node.js 22.13 or newer.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { open, HttpError } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'inventory.db');
// PIN staff type into the web app. API_KEY is for POS / scripts. Leave both empty to disable auth.
const ACCESS_PIN = process.env.ACCESS_PIN || '';
const API_KEY = process.env.API_KEY || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

function createServer({ inventory = open(DB_FILE), pin = ACCESS_PIN, apiKey = API_KEY } = {}) {
  const clients = new Set();

  const broadcast = (event) => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) res.write(data);
  };

  const safeEqual = (a, b) => {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };

  const authorized = (req, url) => {
    if (!pin && !apiKey) return true;
    const given = req.headers['x-pin'] || req.headers['x-api-key'] || url.searchParams.get('pin') ||
      (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    return Boolean(given) && ((pin && safeEqual(given, pin)) || (apiKey && safeEqual(given, apiKey)));
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 5 * 1024 * 1024) reject(new HttpError(413, 'Body too large'));
        else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });

  const readJson = async (req) => {
    const raw = await readBody(req);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'Invalid JSON');
    }
  };

  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };

  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  };

  const serveStatic = (res, pathname) => {
    const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  };

  // Records a stock movement and tells every connected screen.
  const moved = ({ movement, item }) => {
    broadcast({ type: 'movement', movement, item });
    return { movement, item, low: item.qty <= item.min_qty };
  };

  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true, auth: Boolean(pin || apiKey) })],
    ['GET', /^\/api\/items$/, () => inventory.listItems()],
    ['POST', /^\/api\/items$/, async (req) => {
      const item = inventory.createItem(await readJson(req));
      broadcast({ type: 'item', item });
      return item;
    }],
    ['GET', /^\/api\/items\/(\d+)$/, (req, m) => inventory.getItem(m[1]) || Promise.reject(new HttpError(404, 'Item not found'))],
    ['PATCH', /^\/api\/items\/(\d+)$/, async (req, m) => {
      const item = inventory.updateItem(m[1], await readJson(req));
      broadcast({ type: 'item', item });
      return item;
    }],
    ['DELETE', /^\/api\/items\/(\d+)$/, (req, m) => {
      const item = inventory.deleteItem(m[1]);
      broadcast({ type: 'item_deleted', id: item.id });
      return { ok: true };
    }],
    ['GET', /^\/api\/lookup$/, (req, m, url) =>
      inventory.findByCode(url.searchParams.get('code')) || Promise.reject(new HttpError(404, 'Item not found', { unknown: true }))],

    // Stock in / out / adjust / set. Accepts one movement or { movements: [...] } (e.g. a POS sale with many lines).
    ['POST', /^\/api\/movements$/, async (req) => {
      const body = await readJson(req);
      if (Array.isArray(body.movements)) {
        const results = [];
        const errors = [];
        body.movements.forEach((mv, i) => {
          try {
            results.push(moved(inventory.applyMovement({ source: body.source, ...mv })));
          } catch (err) {
            errors.push({ index: i, error: err.message, barcode: err.barcode });
          }
        });
        return { results, errors };
      }
      return moved(inventory.applyMovement(body));
    }],
    ['GET', /^\/api\/movements$/, (req, m, url) =>
      inventory.listMovements({ limit: url.searchParams.get('limit'), item_id: url.searchParams.get('item_id') })],

    // Live stocktake
    ['GET', /^\/api\/count$/, () => inventory.countSession()],
    ['POST', /^\/api\/count$/, async (req) => {
      const row = inventory.countAdd(await readJson(req));
      broadcast({ type: 'count', row });
      return row;
    }],
    ['DELETE', /^\/api\/count\/(\d+)$/, (req, m) => {
      inventory.countRemove(m[1]);
      broadcast({ type: 'count_removed', item_id: Number(m[1]) });
      return { ok: true };
    }],
    ['POST', /^\/api\/count\/commit$/, async (req) => {
      const body = await readJson(req);
      const results = inventory.countCommit(body);
      for (const r of results) broadcast({ type: 'movement', movement: r.movement, item: r.item });
      broadcast({ type: 'count_cleared' });
      return { committed: results.length };
    }],
    ['POST', /^\/api\/count\/clear$/, () => {
      inventory.countClear();
      broadcast({ type: 'count_cleared' });
      return { ok: true };
    }],

    ['GET', /^\/api\/export\.csv$/, (req, m, url, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="red-panda-inventory-${new Date().toISOString().slice(0, 10)}.csv"`,
      });
      res.end(inventory.exportCsv());
    }],
    ['POST', /^\/api\/import$/, async (req) => {
      const result = inventory.importCsv(await readBody(req));
      broadcast({ type: 'reload' });
      return result;
    }],
  ];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
      if (url.pathname !== '/api/health' && !authorized(req, url)) throw new HttpError(401, 'Wrong or missing PIN');

      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`data: ${JSON.stringify({ type: 'hello', clients: clients.size + 1 })}\n\n`);
        clients.add(res);
        broadcast({ type: 'presence', clients: clients.size });
        const ping = setInterval(() => res.write(': ping\n\n'), 25000);
        req.on('close', () => {
          clearInterval(ping);
          clients.delete(res);
          broadcast({ type: 'presence', clients: clients.size });
        });
        return;
      }

      for (const [method, pattern, handler] of routes) {
        const m = url.pathname.match(pattern);
        if (m && req.method === method) {
          const result = await handler(req, m, url, res);
          if (!res.headersSent) send(res, 200, result);
          return;
        }
      }
      throw new HttpError(404, 'Not found');
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      const body = { error: status === 500 ? 'Server error' : err.message };
      if (err.unknown) Object.assign(body, { unknown: true, barcode: err.barcode });
      if (!res.headersSent) send(res, status, body);
    }
  });

  server.on('close', () => clients.forEach((c) => c.end()));
  return server;
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`Red Panda Inventory running on http://${HOST}:${PORT}`);
    console.log(`Database: ${DB_FILE}`);
    if (!ACCESS_PIN && !API_KEY) console.warn('WARNING: no ACCESS_PIN set — anyone who can reach this port can edit stock.');
  });
}

module.exports = { createServer };

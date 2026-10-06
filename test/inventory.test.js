'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { open } = require('../db');
const { createServer } = require('../server');

test('stock in / out / set keeps qty and log in sync', () => {
  const inv = open(':memory:');
  const item = inv.createItem({ name: 'Bubble tea cup', barcode: '111', qty: 10, min_qty: 5 });
  assert.equal(item.qty, 10);
  inv.applyMovement({ barcode: '111', type: 'out', qty: 3 });
  inv.applyMovement({ barcode: '111', type: 'in', qty: 2 });
  const { item: after } = inv.applyMovement({ barcode: '111', type: 'count', qty: 4 });
  assert.equal(after.qty, 4);
  const log = inv.listMovements();
  assert.deepEqual(log.map((m) => m.delta), [-5, 2, -3, 10]);
  assert.equal(log[0].qty_after, 4);
  assert.throws(() => inv.applyMovement({ barcode: 'nope', type: 'in' }), /not found/);
  assert.throws(() => inv.createItem({ name: 'Dup', barcode: '111' }), /already exists/);
});

test('live count adds up and commit sets stock', () => {
  const inv = open(':memory:');
  const a = inv.createItem({ name: 'A', barcode: 'A1', qty: 7 });
  inv.createItem({ name: 'B', barcode: 'B1', qty: 2 });
  inv.countAdd({ barcode: 'A1' });
  inv.countAdd({ barcode: 'A1' });
  inv.countAdd({ barcode: 'A1', qty: -5 }); // never below zero
  inv.countAdd({ barcode: 'A1', qty: 3 });
  inv.countAdd({ barcode: 'B1', set: 9 });
  const rows = inv.countSession();
  assert.equal(rows.find((r) => r.item_id === a.id).counted, 3);
  assert.equal(rows.find((r) => r.item_id === a.id).variance, -4);
  inv.countCommit();
  assert.equal(inv.findByCode('A1').qty, 3);
  assert.equal(inv.findByCode('B1').qty, 9);
  assert.equal(inv.countSession().length, 0);
});

test('CSV round trip', () => {
  const inv = open(':memory:');
  const r = inv.importCsv('name,barcode,qty,min_qty,unit\n"Milk, fresh",900,12,4,bottle\nSugar,901,5,2,kg\n');
  assert.deepEqual(r, { created: 2, updated: 0 });
  assert.equal(inv.findByCode('900').name, 'Milk, fresh');
  const r2 = inv.importCsv(inv.exportCsv().replace('12,4', '20,4'));
  assert.deepEqual(r2, { created: 0, updated: 2 });
  assert.equal(inv.findByCode('900').qty, 20);
});

test('HTTP API with PIN, batch movements and live events', async () => {
  const server = createServer({ inventory: open(':memory:'), pin: '1234', apiKey: 'pos-key' });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, opts = {}) =>
    fetch(base + path, { ...opts, headers: { 'content-type': 'application/json', ...opts.headers } });

  assert.equal((await call('/api/items')).status, 401);
  const created = await (await call('/api/items', { method: 'POST', headers: { 'x-pin': '1234' }, body: JSON.stringify({ name: 'Boba', barcode: '555', qty: 50 }) })).json();
  assert.equal(created.qty, 50);

  // Listen for live events
  const events = [];
  const sse = await new Promise((resolve) => {
    const req = http.get(`${base}/api/events?pin=1234`, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        for (const line of chunk.split('\n')) if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
      });
      resolve(req);
    });
  });

  // A POS sale using the API key
  const sale = await (await call('/api/movements', {
    method: 'POST',
    headers: { 'x-api-key': 'pos-key' },
    body: JSON.stringify({ source: 'pos', movements: [{ barcode: '555', type: 'out', qty: 2 }, { barcode: 'zzz', type: 'out' }] }),
  })).json();
  assert.equal(sale.results[0].item.qty, 48);
  assert.equal(sale.errors.length, 1);

  await new Promise((r) => setTimeout(r, 50));
  const mv = events.find((e) => e.type === 'movement');
  assert.equal(mv.item.qty, 48);
  assert.equal(mv.movement.source, 'pos');

  sse.destroy();
  await new Promise((r) => server.close(r));
});

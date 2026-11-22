import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';

let app;
let base;

before(async () => {
  app = crearApp({ version: 'test', entorno: 'ci', logLevel: 'silent' });
  await new Promise((r) => app.servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.servidor.address().port}`;
});

after(() => new Promise((r) => app.servidor.close(r)));

const pedir = (ruta, opts) => fetch(base + ruta, opts);

test('GET /health responde ok y la versión', async () => {
  const r = await pedir('/health');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.estado, 'ok');
  assert.equal(j.version, 'test');
});

test('GET /api/productos devuelve el catálogo', async () => {
  const r = await pedir('/api/productos');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j) && j.length >= 1);
});

test('GET /api/productos/:id existente y no existente', async () => {
  assert.equal((await pedir('/api/productos/1')).status, 200);
  assert.equal((await pedir('/api/productos/9999')).status, 404);
});

test('POST /api/pedidos válido calcula el total', async () => {
  const r = await pedir('/api/pedidos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ productoId: 1, cantidad: 2 }] }),
  });
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.equal(j.total, 900);
});

test('POST /api/pedidos inválido responde 400', async () => {
  const r = await pedir('/api/pedidos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [] }),
  });
  assert.equal(r.status, 400);
});

test('POST /api/pedidos con JSON malformado responde 400', async () => {
  const r = await pedir('/api/pedidos', { method: 'POST', body: '{no-es-json' });
  assert.equal(r.status, 400);
});

test('GET /metrics expone contadores e histograma', async () => {
  await pedir('/api/productos');
  const txt = await (await pedir('/metrics')).text();
  assert.match(txt, /http_requests_total\{method="GET",route="\/api\/productos",status="200"\} \d+/);
  assert.match(txt, /http_request_duration_seconds_bucket\{.*le="\+Inf"\}/);
  assert.match(txt, /pedidos_creados_total \d+/);
  assert.match(txt, /app_info\{version="test",entorno="ci"\} 1/);
});

test('ruta desconocida responde 404', async () => {
  assert.equal((await pedir('/no-existe')).status, 404);
});

test('/ready pasa a 503 tras marcarNoListo (apagado ordenado)', async () => {
  const otra = crearApp({ logLevel: 'silent' });
  await new Promise((r) => otra.servidor.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${otra.servidor.address().port}/ready`;
  assert.equal((await fetch(url)).status, 200);
  otra.marcarNoListo();
  assert.equal((await fetch(url)).status, 503);
  await new Promise((r) => otra.servidor.close(r));
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
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

const sloCheckPath = fileURLToPath(new URL('../../scripts/tests/slo-check.mjs', import.meta.url));

async function ejecutarSloCheck({ total = 1000, errors = 0, p95 = 0.25, httpStatus = 200 }) {
  const queries = [];
  const servidor = createServer((req, res) => {
    const query = new URL(req.url, 'http://localhost').searchParams.get('query');
    queries.push(query);

    if (httpStatus !== 200) {
      res.writeHead(httpStatus).end();
      return;
    }

    let value;
    if (query.includes('status=~"5.."')) value = errors === 0 ? null : errors;
    else if (query.includes('http_requests_total')) value = total;
    else value = p95;

    const result = value === null ? [] : [{ value: [Date.now() / 1000, String(value)] }];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', data: { resultType: 'vector', result } }));
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const address = servidor.address();

  try {
    const child = spawn(process.execPath, [
      sloCheckPath,
      '--prometheus-url', `http://127.0.0.1:${address.port}`,
      '--window', '5m',
      '--min-availability', '99.5',
      '--max-p95-ms', '300',
      '--min-samples', '20',
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    return { code, stdout, stderr, queries };
  } finally {
    await new Promise((resolve, reject) => {
      servidor.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('la compuerta SLO consulta disponibilidad y p95 en Prometheus', async () => {
  const result = await ejecutarSloCheck({});
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /SLO OK/);
  assert.equal(result.queries.length, 3);
  assert.ok(result.queries.every((query) => query.includes('[5m]')));
});

test('la compuerta SLO falla cuando se incumple disponibilidad o latencia', async () => {
  const result = await ejecutarSloCheck({ errors: 10, p95: 0.5 });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /SLO INCUMPLIDO/);
});

test('un fallo de Prometheus no se trata como SLO aprobado', async () => {
  const result = await ejecutarSloCheck({ httpStatus: 500 });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Prometheus respondió HTTP 500/);
});

test('la compuerta informa cuando la ventana no tiene muestras suficientes', async () => {
  const result = await ejecutarSloCheck({ total: 5 });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /muestra insuficiente/);
  assert.equal(result.queries.length, 1);
});

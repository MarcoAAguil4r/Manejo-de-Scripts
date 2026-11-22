// Pruebas de integración funcional contra el entorno desplegado.
// Uso: node scripts/tests/integration.mjs <base_url>
import assert from 'node:assert/strict';

const base = process.argv[2];
if (!base) { console.error('uso: integration.mjs <base_url>'); process.exit(2); }

const json = (ruta, opts = {}) =>
  fetch(base + ruta, { headers: { 'Content-Type': 'application/json' }, ...opts });

const casos = [
  ['catálogo no vacío', async () => {
    const r = await json('/api/productos');
    assert.equal(r.status, 200);
    const lista = await r.json();
    assert.ok(lista.length > 0);
    assert.ok(lista.every((p) => p.id && p.nombre && p.precio > 0));
  }],
  ['detalle de producto', async () => {
    const r = await json('/api/productos/1');
    assert.equal(r.status, 200);
    assert.equal((await r.json()).id, 1);
  }],
  ['pedido válido devuelve id y total correcto', async () => {
    const r = await json('/api/pedidos', {
      method: 'POST',
      body: JSON.stringify({ items: [{ productoId: 3, cantidad: 2 }, { productoId: 4, cantidad: 10 }] }),
    });
    assert.equal(r.status, 201);
    const p = await r.json();
    assert.ok(p.id >= 1000);
    assert.equal(p.total, 620 * 2 + 85 * 10);
  }],
  ['pedido con producto inexistente = 400', async () => {
    const r = await json('/api/pedidos', {
      method: 'POST', body: JSON.stringify({ items: [{ productoId: 999, cantidad: 1 }] }),
    });
    assert.equal(r.status, 400);
  }],
  ['pedido por encima del stock = 400', async () => {
    const r = await json('/api/pedidos', {
      method: 'POST', body: JSON.stringify({ items: [{ productoId: 2, cantidad: 9999 }] }),
    });
    assert.equal(r.status, 400);
  }],
  ['las métricas de negocio reflejan los pedidos', async () => {
    const txt = await (await json('/metrics')).text();
    const creados = Number(/^pedidos_creados_total (\d+)/m.exec(txt)?.[1]);
    const rechazados = Number(/^pedidos_rechazados_total (\d+)/m.exec(txt)?.[1]);
    assert.ok(creados >= 1, 'pedidos_creados_total debería ser >= 1');
    assert.ok(rechazados >= 2, 'pedidos_rechazados_total debería ser >= 2');
  }],
];

let fallos = 0;
console.log(`Pruebas de integración contra ${base}`);
for (const [nombre, fn] of casos) {
  try { await fn(); console.log(`  OK   ${nombre}`); }
  catch (e) { fallos += 1; console.log(`  FALLA ${nombre}: ${e.message}`); }
}
console.log(fallos === 0 ? 'Integración OK' : `Integración FALLÓ (${fallos})`);
process.exit(fallos === 0 ? 0 : 1);

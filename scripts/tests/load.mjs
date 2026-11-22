// Prueba de carga ligera con umbrales. Mezcla: 70% lista, 20% detalle, 10% pedido.
// Uso: node scripts/tests/load.mjs <base_url> [--duration 20] [--concurrency 20]
//                                     [--max-p95-ms 300] [--max-error-pct 1]
const args = process.argv.slice(2);
const base = args[0];
if (!base || base.startsWith('--')) { console.error('uso: load.mjs <base_url> [opciones]'); process.exit(2); }
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };

const duracion = opt('duration', 20);
const concurrencia = opt('concurrency', 20);
const maxP95 = opt('max-p95-ms', 300);
const maxErr = opt('max-error-pct', 1);

const latencias = [];
let total = 0;
let errores = 0;
const fin = Date.now() + duracion * 1000;

function peticion() {
  const r = Math.random();
  if (r < 0.7) return fetch(`${base}/api/productos`);
  if (r < 0.9) return fetch(`${base}/api/productos/${1 + Math.floor(Math.random() * 4)}`);
  return fetch(`${base}/api/pedidos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ productoId: 4, cantidad: 1 }] }),
  });
}

async function trabajador() {
  while (Date.now() < fin) {
    const t0 = performance.now();
    try {
      const res = await peticion();
      await res.arrayBuffer();
      if (res.status >= 500) errores += 1;
    } catch {
      errores += 1;
    }
    latencias.push(performance.now() - t0);
    total += 1;
  }
}

console.log(`Carga: ${concurrencia} usuarios virtuales durante ${duracion}s contra ${base}`);
await Promise.all(Array.from({ length: concurrencia }, trabajador));

latencias.sort((a, b) => a - b);
const pct = (p) => latencias[Math.min(latencias.length - 1, Math.floor(p * latencias.length))] ?? 0;
const p50 = pct(0.5), p95 = pct(0.95), p99 = pct(0.99);
const errPct = total ? (100 * errores) / total : 100;

console.log(`  peticiones: ${total}  (${(total / duracion).toFixed(0)} req/s)`);
console.log(`  latencia ms  p50=${p50.toFixed(1)}  p95=${p95.toFixed(1)}  p99=${p99.toFixed(1)}`);
console.log(`  errores: ${errores} (${errPct.toFixed(2)}%)`);

const ok = total > 0 && p95 <= maxP95 && errPct <= maxErr;
console.log(ok ? 'Carga OK' : `Carga FALLÓ (umbrales: p95<=${maxP95}ms, errores<=${maxErr}%)`);
process.exit(ok ? 0 : 1);

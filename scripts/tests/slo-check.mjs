// Compuerta de SLO: lee /metrics del entorno y compara los SLI contra los objetivos.
// Uso: node scripts/tests/slo-check.mjs <base_url> [--min-availability 99.5] [--max-p95-ms 300]
//                                                  [--min-samples 20]
// La disponibilidad se calcula como 1 - (respuestas 5xx / total). Las 4xx son errores
// del cliente y no cuentan contra el SLO.
const args = process.argv.slice(2);
const base = args[0];
if (!base || base.startsWith('--')) { console.error('uso: slo-check.mjs <base_url> [opciones]'); process.exit(2); }
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };

const minDisp = opt('min-availability', 99.5);
const maxP95ms = opt('max-p95-ms', 300);
const minMuestras = opt('min-samples', 20);

const texto = await (await fetch(`${base}/metrics`)).text();

let total = 0;
let cincoXX = 0;
const acumulado = new Map(); // le -> conteo acumulado (suma de todas las rutas)

for (const linea of texto.split('\n')) {
  let m = /^http_requests_total\{[^}]*status="(\d{3})"[^}]*\} (\d+)/.exec(linea);
  if (m) {
    total += Number(m[2]);
    if (m[1].startsWith('5')) cincoXX += Number(m[2]);
    continue;
  }
  m = /^http_request_duration_seconds_bucket\{[^}]*le="([^"]+)"[^}]*\} (\d+)/.exec(linea);
  if (m) {
    const le = m[1] === '+Inf' ? Infinity : Number(m[1]);
    acumulado.set(le, (acumulado.get(le) ?? 0) + Number(m[2]));
  }
}

if (total < minMuestras) {
  console.log(`SLO: sólo ${total} peticiones (< ${minMuestras}); muestra insuficiente, no se evalúa.`);
  process.exit(0);
}

const disponibilidad = 100 * (1 - cincoXX / total);

// p95 conservador: el límite superior del primer bucket que acumula >= 95% de las peticiones.
const buckets = [...acumulado.entries()].sort((a, b) => a[0] - b[0]);
const objetivo = 0.95 * total;
const p95s = (buckets.find(([, n]) => n >= objetivo) ?? [Infinity])[0];
const p95ms = p95s * 1000;

console.log(`SLI observados (${total} peticiones):`);
console.log(`  disponibilidad = ${disponibilidad.toFixed(3)}%   (objetivo >= ${minDisp}%)`);
console.log(`  latencia p95   <= ${p95ms} ms          (objetivo <= ${maxP95ms} ms)`);

const ok = disponibilidad >= minDisp && p95ms <= maxP95ms;
console.log(ok ? 'SLO OK' : 'SLO INCUMPLIDO');
process.exit(ok ? 0 : 1);

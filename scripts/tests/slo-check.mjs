// Compuerta de SLO basada en las series históricas que conserva Prometheus.
// Uso: node scripts/tests/slo-check.mjs --prometheus-url http://localhost:9090
//      [--window 5m|30d] [--min-availability 99.5] [--max-p95-ms 300] [--min-samples 20]
const args = process.argv.slice(2);

function parseOptions() {
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error('uso: slo-check.mjs --prometheus-url <url> [opciones]');
    }
    options.set(key.slice(2), value);
  }
  return options;
}

function numberOption(options, name, fallback) {
  const value = Number(options.get(name) ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`--${name} debe ser numérico`);
  return value;
}

async function consultar(prometheusUrl, query) {
  const endpoint = new URL('api/v1/query', `${prometheusUrl.replace(/\/+$/, '')}/`);
  endpoint.searchParams.set('query', query);
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Prometheus respondió HTTP ${response.status}`);

  const body = await response.json();
  if (body.status !== 'success') {
    throw new Error(`Prometheus rechazó la consulta: ${body.error ?? 'error desconocido'}`);
  }

  const filas = body.data?.result;
  if (!Array.isArray(filas)) throw new Error('respuesta de Prometheus sin data.result');
  if (filas.length === 0) return null;
  if (filas.length !== 1) throw new Error('la consulta agregada devolvió más de un resultado');

  const valor = Number(filas[0].value?.[1]);
  if (!Number.isFinite(valor)) throw new Error('Prometheus devolvió un valor no numérico');
  return valor;
}

async function main() {
  const options = parseOptions();
  const prometheusUrl = options.get('prometheus-url');
  if (!prometheusUrl) throw new Error('falta --prometheus-url');
  const parsedUrl = new URL(prometheusUrl);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('--prometheus-url debe usar HTTP o HTTPS');
  }

  const window = options.get('window') ?? '5m';
  if (!/^(?:\d+(?:ms|[smhdwy]))+$/.test(window)) {
    throw new Error('--window debe ser una duración Prometheus, por ejemplo 5m o 30d');
  }
  const minAvailability = numberOption(options, 'min-availability', 99.5);
  const maxP95ms = numberOption(options, 'max-p95-ms', 300);
  const minSamples = numberOption(options, 'min-samples', 20);
  if (minAvailability < 0 || minAvailability > 100) {
    throw new Error('--min-availability debe estar entre 0 y 100');
  }
  if (maxP95ms <= 0 || minSamples < 0) {
    throw new Error('--max-p95-ms debe ser positivo y --min-samples no negativo');
  }

  const totalQuery =
    `sum(increase(http_requests_total{job="talaverashop-app"}[${window}]))`;
  const total = (await consultar(prometheusUrl, totalQuery)) ?? 0;
  if (total < minSamples) {
    console.log(`SLO (${window}): sólo ${total.toFixed(0)} peticiones (< ${minSamples}); muestra insuficiente, no se evalúa.`);
    return;
  }

  const errorsQuery =
    `sum(increase(http_requests_total{job="talaverashop-app",status=~"5.."}[${window}]))`;
  const p95Query =
    `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{job="talaverashop-app"}[${window}])))`;
  const errors = (await consultar(prometheusUrl, errorsQuery)) ?? 0;
  const p95Seconds = await consultar(prometheusUrl, p95Query);
  if (p95Seconds === null) throw new Error('Prometheus no tiene muestras de latencia para evaluar el p95');
  if (errors > total) throw new Error('Prometheus reportó más errores 5xx que peticiones totales');

  const availability = 100 * (1 - errors / total);
  const p95ms = p95Seconds * 1000;
  console.log(`SLI observados en ${window} (${total.toFixed(0)} peticiones):`);
  console.log(`  disponibilidad = ${availability.toFixed(3)}%   (objetivo >= ${minAvailability}%)`);
  console.log(`  latencia p95   = ${p95ms.toFixed(1)} ms (objetivo <= ${maxP95ms} ms)`);

  const ok = availability >= minAvailability && p95ms <= maxP95ms;
  console.log(ok ? 'SLO OK' : 'SLO INCUMPLIDO');
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`SLO check falló: ${error.message}`);
  process.exitCode = 1;
});

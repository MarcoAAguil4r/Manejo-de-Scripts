// Registro mínimo de métricas en formato de exposición de Prometheus.
// Sin dependencias externas para que la imagen sea pequeña y el pipeline reproducible.

// El bucket 0.3 coincide con el umbral del SLO de latencia (p95 < 300 ms).
export const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.3, 0.5, 1, 2.5, 5];

export function crearMetricas({ version, entorno }) {
  const inicio = Date.now();
  const peticiones = new Map(); // "metodo|ruta|estado" -> n
  const duracion = new Map(); // "metodo|ruta" -> { buckets:[], suma, cuenta }
  let pedidosCreados = 0;
  let pedidosRechazados = 0;

  function observar(metodo, ruta, estado, segundos) {
    const k = `${metodo}|${ruta}|${estado}`;
    peticiones.set(k, (peticiones.get(k) ?? 0) + 1);

    const kd = `${metodo}|${ruta}`;
    let h = duracion.get(kd);
    if (!h) {
      h = { buckets: BUCKETS.map(() => 0), suma: 0, cuenta: 0 };
      duracion.set(kd, h);
    }
    BUCKETS.forEach((le, i) => {
      if (segundos <= le) h.buckets[i] += 1;
    });
    h.suma += segundos;
    h.cuenta += 1;
  }

  function render() {
    const l = [];
    l.push('# HELP app_info Información de la versión desplegada.');
    l.push('# TYPE app_info gauge');
    l.push(`app_info{version="${version}",entorno="${entorno}"} 1`);

    l.push('# HELP app_uptime_seconds Segundos desde el arranque del proceso.');
    l.push('# TYPE app_uptime_seconds gauge');
    l.push(`app_uptime_seconds ${((Date.now() - inicio) / 1000).toFixed(3)}`);

    l.push('# HELP http_requests_total Total de peticiones HTTP.');
    l.push('# TYPE http_requests_total counter');
    for (const [k, n] of peticiones) {
      const [metodo, ruta, estado] = k.split('|');
      l.push(`http_requests_total{method="${metodo}",route="${ruta}",status="${estado}"} ${n}`);
    }

    l.push('# HELP http_request_duration_seconds Duración de las peticiones HTTP.');
    l.push('# TYPE http_request_duration_seconds histogram');
    for (const [k, h] of duracion) {
      const [metodo, ruta] = k.split('|');
      const base = `method="${metodo}",route="${ruta}"`;
      BUCKETS.forEach((le, i) => {
        l.push(`http_request_duration_seconds_bucket{${base},le="${le}"} ${h.buckets[i]}`);
      });
      l.push(`http_request_duration_seconds_bucket{${base},le="+Inf"} ${h.cuenta}`);
      l.push(`http_request_duration_seconds_sum{${base}} ${h.suma.toFixed(6)}`);
      l.push(`http_request_duration_seconds_count{${base}} ${h.cuenta}`);
    }

    l.push('# HELP pedidos_creados_total Pedidos aceptados (métrica de negocio).');
    l.push('# TYPE pedidos_creados_total counter');
    l.push(`pedidos_creados_total ${pedidosCreados}`);
    l.push('# HELP pedidos_rechazados_total Pedidos rechazados por validación.');
    l.push('# TYPE pedidos_rechazados_total counter');
    l.push(`pedidos_rechazados_total ${pedidosRechazados}`);

    const mem = process.memoryUsage();
    l.push('# HELP process_resident_memory_bytes Memoria residente del proceso.');
    l.push('# TYPE process_resident_memory_bytes gauge');
    l.push(`process_resident_memory_bytes ${mem.rss}`);

    return l.join('\n') + '\n';
  }

  return {
    observar,
    render,
    pedidoCreado: () => { pedidosCreados += 1; },
    pedidoRechazado: () => { pedidosRechazados += 1; },
  };
}

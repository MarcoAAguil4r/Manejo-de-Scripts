import http from 'node:http';
import { crearMetricas } from './metrics.js';
import { PRODUCTOS, buscarProducto, validarPedido, calcularTotal } from './productos.js';

export function crearApp({
  version = process.env.APP_VERSION ?? 'dev',
  entorno = process.env.APP_ENV ?? 'local',
  logLevel = process.env.LOG_LEVEL ?? 'info',
} = {}) {
  const metricas = crearMetricas({ version, entorno });
  let listo = true;
  let siguientePedido = 1000;

  const log = (nivel, msg, extra = {}) => {
    if (logLevel === 'silent') return;
    console.log(JSON.stringify({ t: new Date().toISOString(), nivel, msg, ...extra }));
  };

  function responder(res, estado, cuerpo, tipo = 'application/json') {
    const datos = tipo === 'application/json' ? JSON.stringify(cuerpo) : cuerpo;
    res.writeHead(estado, { 'Content-Type': tipo, 'X-App-Version': version });
    res.end(datos);
  }

  async function leerJson(req) {
    const partes = [];
    for await (const p of req) partes.push(p);
    if (partes.length === 0) return null;
    try {
      return JSON.parse(Buffer.concat(partes).toString('utf8'));
    } catch {
      return undefined;
    }
  }

  async function enrutar(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const ruta = url.pathname;

    if (req.method === 'GET' && ruta === '/health') {
      responder(res, 200, { estado: 'ok', version });
      return '/health';
    }
    if (req.method === 'GET' && ruta === '/ready') {
      if (listo) responder(res, 200, { estado: 'listo' });
      else responder(res, 503, { estado: 'no-listo' });
      return '/ready';
    }
    if (req.method === 'GET' && ruta === '/metrics') {
      responder(res, 200, metricas.render(), 'text/plain; version=0.0.4');
      return '/metrics';
    }
    if (req.method === 'GET' && ruta === '/api/productos') {
      responder(res, 200, PRODUCTOS);
      return '/api/productos';
    }
    const m = ruta.match(/^\/api\/productos\/(\d+)$/);
    if (req.method === 'GET' && m) {
      const p = buscarProducto(Number(m[1]));
      if (p) responder(res, 200, p);
      else responder(res, 404, { error: 'No encontrado' });
      return '/api/productos/:id';
    }
    if (req.method === 'POST' && ruta === '/api/pedidos') {
      const cuerpo = await leerJson(req);
      const error = cuerpo === undefined ? 'JSON inválido' : validarPedido(cuerpo);
      if (error) {
        metricas.pedidoRechazado();
        responder(res, 400, { error });
      } else {
        metricas.pedidoCreado();
        responder(res, 201, { id: siguientePedido++, total: calcularTotal(cuerpo.items) });
      }
      return '/api/pedidos';
    }

    responder(res, 404, { error: 'Ruta no encontrada' });
    return 'desconocida';
  }

  const servidor = http.createServer(async (req, res) => {
    const t0 = process.hrtime.bigint();
    let rutaEtiqueta = 'desconocida';
    try {
      rutaEtiqueta = await enrutar(req, res);
    } catch (e) {
      log('error', 'fallo no controlado', { error: String(e) });
      if (!res.headersSent) responder(res, 500, { error: 'Error interno' });
    } finally {
      const seg = Number(process.hrtime.bigint() - t0) / 1e9;
      // /metrics se excluye para no contaminar los SLIs con el propio scraping.
      if (rutaEtiqueta !== '/metrics') {
        metricas.observar(req.method, rutaEtiqueta, res.statusCode, seg);
      }
      log('info', 'peticion', { m: req.method, ruta: rutaEtiqueta, estado: res.statusCode, seg });
    }
  });

  return {
    servidor,
    marcarNoListo: () => { listo = false; },
  };
}

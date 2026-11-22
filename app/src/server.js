import { crearApp } from './app.js';

const puerto = Number(process.env.PORT ?? 3000);
const { servidor, marcarNoListo } = crearApp();

servidor.listen(puerto, '0.0.0.0', () => {
  console.log(JSON.stringify({ nivel: 'info', msg: 'servidor iniciado', puerto }));
});

// Apagado ordenado: permite que el despliegue reemplace el contenedor sin cortar peticiones.
function apagar(senal) {
  console.log(JSON.stringify({ nivel: 'info', msg: 'apagando', senal }));
  marcarNoListo();
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));

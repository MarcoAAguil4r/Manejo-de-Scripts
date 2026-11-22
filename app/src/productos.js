// Catálogo en memoria. En un caso real vendría de una base de datos;
// se mantiene sin estado para simplificar el despliegue y el rollback.

export const PRODUCTOS = [
  { id: 1, nombre: 'Plato decorativo Talavera', precio: 450.0, stock: 25 },
  { id: 2, nombre: 'Jarrón azul cobalto', precio: 980.0, stock: 10 },
  { id: 3, nombre: 'Set de tazas (4 pzas)', precio: 620.0, stock: 40 },
  { id: 4, nombre: 'Azulejo artesanal 15x15', precio: 85.0, stock: 300 },
];

export function buscarProducto(id) {
  return PRODUCTOS.find((p) => p.id === id);
}

export function validarPedido(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object') return 'Cuerpo inválido';
  if (!Array.isArray(cuerpo.items) || cuerpo.items.length === 0) return 'items es obligatorio';
  for (const it of cuerpo.items) {
    const p = buscarProducto(it?.productoId);
    if (!p) return `Producto ${it?.productoId} no existe`;
    if (!Number.isInteger(it.cantidad) || it.cantidad < 1) return 'cantidad inválida';
    if (it.cantidad > p.stock) return `Sin stock suficiente de ${p.nombre}`;
  }
  return null;
}

export function calcularTotal(items) {
  return items.reduce((t, it) => t + buscarProducto(it.productoId).precio * it.cantidad, 0);
}

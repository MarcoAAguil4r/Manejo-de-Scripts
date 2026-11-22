#!/usr/bin/env bash
# Destruye el entorno. Con --volumes también borra métricas y dashboards guardados.
# Uso: scripts/env/teardown.sh <staging|production> [--volumes]

source "$(dirname "$0")/../lib/common.sh"
cargar_entorno "${1:-}"

if [[ "$1" == "production" ]]; then
  read -r -p "Vas a destruir PRODUCCIÓN. Escribe 'production' para confirmar: " r
  [[ "$r" == "production" ]] || die "cancelado"
fi

if [[ "${2:-}" == "--volumes" ]]; then
  "${COMPOSE[@]}" down --volumes --remove-orphans
else
  "${COMPOSE[@]}" down --remove-orphans
fi
log "Entorno '$1' eliminado"

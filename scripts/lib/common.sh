#!/usr/bin/env bash
# Funciones compartidas por los scripts de entorno, pruebas y despliegue.
# Se usa con:  source "$(dirname "$0")/../lib/common.sh"

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# Carga environments/<entorno>.env y deja listas las variables que usan los demás scripts:
#   ENV_FILE, COMPOSE (array), STATE_DIR, PROM_CONFIG_DIR y todas las variables del .env
cargar_entorno() {
  local env="${1:-}"
  case "$env" in
    staging|production) ;;
    *) die "entorno inválido '$env' (usa: staging | production)" ;;
  esac

  ENV_FILE="$ROOT/environments/$env.env"
  [[ -f "$ENV_FILE" ]] || die "no existe $ENV_FILE"

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  STATE_DIR="${DEPLOY_STATE_DIR:-$ROOT/.deploy-state}/$env"
  mkdir -p "$STATE_DIR"
  export PROM_CONFIG_DIR="$STATE_DIR/prometheus"

  COMPOSE=(docker compose -p "talaverashop-$env"
           -f "$ROOT/environments/docker-compose.yml" --env-file "$ENV_FILE")
}

requiere() {
  command -v "$1" >/dev/null 2>&1 || die "falta el comando '$1'"
}

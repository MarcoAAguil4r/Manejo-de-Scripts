#!/usr/bin/env bash
# Despliega una imagen en un entorno con verificación y rollback automático.
#
#   1. Registra la imagen candidata y la última imagen buena conocida.
#   2. Reemplaza sólo el servicio `app` (Prometheus/Grafana no se tocan).
#   3. Espera /health y /ready, y ejecuta las pruebas de humo.
#   4. Si algo falla -> vuelve a la última imagen buena y termina con error.
#   5. Si todo pasa -> la candidata pasa a ser la imagen buena y se registra el despliegue.
#
# Uso: scripts/deploy/deploy.sh <staging|production> <imagen:tag>

source "$(dirname "$0")/../lib/common.sh"
cargar_entorno "${1:-}"
ENTORNO="$1"
IMAGEN="${2:?uso: deploy.sh <entorno> <imagen:tag>}"

requiere docker
requiere curl

BASE_URL="http://localhost:${APP_PORT}"
VERSION="${IMAGEN##*:}"
ACTUAL_FILE="$STATE_DIR/current_image"
PREVIA_FILE="$STATE_DIR/previous_image"
HISTORIAL="$STATE_DIR/deployments.log"

ACTUAL=""
[[ -f "$ACTUAL_FILE" ]] && ACTUAL="$(cat "$ACTUAL_FILE")"

aplicar() { # aplicar <imagen>  -> levanta el servicio app con esa imagen
  local img="$1"
  export APP_IMAGE="$img" APP_VERSION="${img##*:}"
  docker image inspect "$img" >/dev/null 2>&1 || docker pull "$img"
  "${COMPOSE[@]}" up -d --no-deps --force-recreate app
}

verificar() {
  "$ROOT/scripts/deploy/wait-healthy.sh" "$BASE_URL" 60 &&
  "$ROOT/scripts/tests/smoke.sh" "$BASE_URL" "$VERSION"
}

registrar() { # registrar <resultado>
  printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$ENTORNO" "$IMAGEN" "$1" >> "$HISTORIAL"
}

log "Desplegando $IMAGEN en '$ENTORNO' (actual: ${ACTUAL:-ninguna})"
INICIO=$(date +%s)

if aplicar "$IMAGEN" && verificar; then
  [[ -n "$ACTUAL" && "$ACTUAL" != "$IMAGEN" ]] && echo "$ACTUAL" > "$PREVIA_FILE"
  echo "$IMAGEN" > "$ACTUAL_FILE"
  registrar "exito"
  log "Despliegue exitoso en $(( $(date +%s) - INICIO ))s"
  exit 0
fi

registrar "fallo"
log "Despliegue FALLIDO. Iniciando rollback automático"
if [[ -n "$ACTUAL" ]]; then
  aplicar "$ACTUAL"
  if verificar; then
    registrar "rollback-ok"
    die "se restauró $ACTUAL; la versión $IMAGEN fue rechazada"
  fi
  registrar "rollback-fallido"
  die "el rollback también falló: intervención manual requerida"
fi
die "no hay versión previa a la cual volver (primer despliegue)"

#!/usr/bin/env bash
# Ejecuta las pruebas del entorno de liberación en orden: humo -> integración -> carga -> SLO.
# Uso: scripts/tests/run-all.sh <staging|production> [version_esperada] [--solo-verificacion]
#   --solo-verificacion  omite la carga y la integración (producción: sólo humo + SLO),
#                        porque no se debe ensuciar producción con pedidos de prueba.

source "$(dirname "$0")/../lib/common.sh"
cargar_entorno "${1:-}"
requiere node

VERSION="${2:-}"
SOLO_VERIF=0
[[ "${3:-}" == "--solo-verificacion" || "${2:-}" == "--solo-verificacion" ]] && SOLO_VERIF=1
[[ "$VERSION" == "--solo-verificacion" ]] && VERSION=""

BASE="http://localhost:${APP_PORT}"
T="$ROOT/scripts/tests"

log "1/4 Smoke";  "$T/smoke.sh" "$BASE" "$VERSION"

if (( SOLO_VERIF == 0 )); then
  log "2/4 Integración"; node "$T/integration.mjs" "$BASE"
  log "3/4 Carga";       node "$T/load.mjs" "$BASE" \
        --duration "${LOAD_DURATION:-20}" --concurrency "${LOAD_CONCURRENCY:-20}" \
        --max-p95-ms "${SLO_MAX_P95_MS:-300}"
else
  log "2-3/4 Integración y carga omitidas en '$1'"
fi

log "4/4 Compuerta de SLO"
node "$T/slo-check.mjs" "$BASE" \
  --min-availability "${SLO_MIN_AVAILABILITY:-99.5}" --max-p95-ms "${SLO_MAX_P95_MS:-300}"

log "Todas las pruebas pasaron en '$1'"

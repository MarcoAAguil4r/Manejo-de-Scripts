#!/usr/bin/env bash
# Ejecuta el MISMO flujo que .github/workflows/pipeline.yml, pero en una sola máquina
# con Docker. Sirve para demostrar el pipeline completo sin depender de GitHub.
#
#   CI -> build -> provisión staging -> deploy staging -> pruebas staging
#      -> (aprobación manual) -> provisión production -> deploy production -> SLO
#
# Uso: scripts/pipeline/local-pipeline.sh [--auto-aprobar]

source "$(dirname "$0")/../lib/common.sh"
requiere docker

VERSION="local-$(date +%Y%m%d%H%M%S)"
IMAGEN="talaverashop:${VERSION}"
S="$ROOT/scripts"

log "### ETAPA 1: Integración continua"
"$S/pipeline/ci.sh"

log "### ETAPA 2: Construcción de la imagen"
"$S/pipeline/build-image.sh" "$IMAGEN" "$VERSION"

log "### ETAPA 3: Entorno de liberación (staging)"
"$S/env/provision.sh" staging
"$S/deploy/deploy.sh" staging "$IMAGEN"

log "### ETAPA 4: Pruebas en staging"
"$S/tests/run-all.sh" staging "$VERSION"

if [[ "${1:-}" != "--auto-aprobar" ]]; then
  read -r -p "¿Aprobar el paso a PRODUCCIÓN de $VERSION? [s/N] " r
  [[ "$r" =~ ^[sS]$ ]] || { log "Liberación detenida por el aprobador"; exit 0; }
fi

log "### ETAPA 5: Producción"
GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-local-$(date +%s)}" "$S/env/provision.sh" production
"$S/deploy/deploy.sh" production "$IMAGEN"
"$S/tests/run-all.sh" production "$VERSION" --solo-verificacion

log "Pipeline completo. Versión $VERSION liberada."

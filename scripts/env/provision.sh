#!/usr/bin/env bash
# Genera (o actualiza) el entorno de liberación: Prometheus + Grafana + red/volúmenes.
# La aplicación NO se levanta aquí; la despliega scripts/deploy/deploy.sh.
# Es idempotente: se puede ejecutar en cada corrida del pipeline.
#
# Uso: scripts/env/provision.sh <staging|production>

source "$(dirname "$0")/../lib/common.sh"
cargar_entorno "${1:-}"
ENTORNO="$1"

requiere docker
docker compose version >/dev/null 2>&1 || die "se requiere Docker Compose v2"
docker info >/dev/null 2>&1 || die "el daemon de Docker no responde"

if [[ "$ENTORNO" == "production" && "${GRAFANA_ADMIN_PASSWORD:-admin-cambiar}" == "admin-cambiar" ]]; then
  die "production exige GRAFANA_ADMIN_PASSWORD (secreto del Environment en GitHub)"
fi

log "Renderizando configuración de Prometheus para '$ENTORNO'"
mkdir -p "$PROM_CONFIG_DIR"
sed -e "s/__SCRAPE_INTERVAL__/${PROM_SCRAPE_INTERVAL:-15s}/g" \
    -e "s/__ENV_NAME__/${ENV_NAME}/g" \
    "$ROOT/environments/prometheus/prometheus.yml.tpl" > "$PROM_CONFIG_DIR/prometheus.yml"
cp "$ROOT/environments/prometheus/alert.rules.yml" "$PROM_CONFIG_DIR/alert.rules.yml"
chmod -R a+rX "$PROM_CONFIG_DIR"

log "Validando docker-compose.yml"
"${COMPOSE[@]}" config -q

log "Levantando observabilidad (prometheus, grafana)"
"${COMPOSE[@]}" up -d prometheus grafana

log "Entorno '$ENTORNO' listo:"
log "  app        -> http://localhost:${APP_PORT}"
log "  prometheus -> http://localhost:${PROM_PORT}"
log "  grafana    -> http://localhost:${GRAFANA_PORT}"

#!/usr/bin/env bash
# Rollback manual a la versión inmediatamente anterior a la actual.
# Uso: scripts/deploy/rollback.sh <staging|production>
# (Se ejecuta desde el workflow rollback.yml o directamente en el servidor.)

source "$(dirname "$0")/../lib/common.sh"
cargar_entorno "${1:-}"

PREVIA_FILE="$STATE_DIR/previous_image"
[[ -s "$PREVIA_FILE" ]] || die "no hay imagen previa registrada para '$1'"

PREVIA="$(cat "$PREVIA_FILE")"
log "Rollback de '$1' a $PREVIA"
exec "$ROOT/scripts/deploy/deploy.sh" "$1" "$PREVIA"

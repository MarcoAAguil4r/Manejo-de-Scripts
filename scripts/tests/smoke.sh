#!/usr/bin/env bash
# Pruebas de humo: ¿el servicio recién desplegado está vivo y es la versión esperada?
# Uso: scripts/tests/smoke.sh <base_url> [version_esperada]
set -euo pipefail

BASE="${1:?uso: smoke.sh <base_url> [version_esperada]}"
ESPERADA="${2:-}"
fallos=0

verificar() { # verificar <descripcion> <comando...>
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "  OK   $desc"; else echo "  FALLA $desc"; fallos=$((fallos+1)); fi
}

echo "Smoke tests contra $BASE"
verificar "GET /health = 200"            curl -fsS -m 5 "$BASE/health"
verificar "GET /ready = 200"             curl -fsS -m 5 "$BASE/ready"
verificar "GET /api/productos = 200"     curl -fsS -m 5 "$BASE/api/productos"
verificar "GET /metrics expone histograma" bash -c "curl -fsS -m 5 '$BASE/metrics' | grep -q http_request_duration_seconds"
verificar "ruta inexistente = 404"       bash -c "[[ \$(curl -s -o /dev/null -w '%{http_code}' -m 5 '$BASE/no-existe') == 404 ]]"

if [[ -n "$ESPERADA" ]]; then
  real="$(curl -s -D - -o /dev/null -m 5 "$BASE/health" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-app-version"{print $2}')"
  if [[ "$real" == "$ESPERADA" ]]; then echo "  OK   versión desplegada = $real"
  else echo "  FALLA versión desplegada '$real' != esperada '$ESPERADA'"; fallos=$((fallos+1)); fi
fi

(( fallos == 0 )) && echo "Smoke OK" || { echo "Smoke FALLÓ ($fallos)"; exit 1; }

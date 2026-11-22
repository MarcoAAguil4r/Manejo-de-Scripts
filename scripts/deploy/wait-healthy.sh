#!/usr/bin/env bash
# Espera a que /health y /ready respondan 200. Falla al agotar el tiempo.
# Uso: scripts/deploy/wait-healthy.sh <base_url> [timeout_s]
set -euo pipefail

BASE="${1:?uso: wait-healthy.sh <base_url> [timeout_s]}"
TIMEOUT="${2:-60}"
FIN=$(( $(date +%s) + TIMEOUT ))

while (( $(date +%s) < FIN )); do
  if curl -fsS -m 3 "$BASE/health" >/dev/null 2>&1 && curl -fsS -m 3 "$BASE/ready" >/dev/null 2>&1; then
    echo "Servicio saludable en $BASE"
    exit 0
  fi
  sleep 2
done
echo "ERROR: $BASE no estuvo saludable en ${TIMEOUT}s" >&2
exit 1

#!/usr/bin/env bash
# Etapa de integración continua: validación estática + pruebas unitarias.
# La usan tanto el workflow de GitHub Actions como scripts/pipeline/local-pipeline.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/app"

echo "== Node $(node --version) =="
echo "== 1/3 Lint (verificación de sintaxis) =="
npm run lint --silent

echo "== 2/3 Pruebas unitarias =="
npm test --silent

echo "== 3/3 Validación de configuración del entorno =="
for f in "$ROOT"/environments/*.env; do
  grep -q '^ENV_NAME=' "$f" || { echo "Falta ENV_NAME en $f"; exit 1; }
  grep -q '^APP_PORT=' "$f" || { echo "Falta APP_PORT en $f"; exit 1; }
done
echo "CI OK"

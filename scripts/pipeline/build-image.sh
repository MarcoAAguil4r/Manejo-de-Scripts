#!/usr/bin/env bash
# Construye la imagen inmutable que recorrerá staging y production.
# Uso: scripts/pipeline/build-image.sh <imagen:tag> [version]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

IMAGEN="${1:?uso: build-image.sh <imagen:tag> [version]}"
VERSION="${2:-${IMAGEN##*:}}"

docker build \
  --build-arg APP_VERSION="$VERSION" \
  --label org.opencontainers.image.revision="${GITHUB_SHA:-local}" \
  --label org.opencontainers.image.version="$VERSION" \
  -t "$IMAGEN" "$ROOT/app"

echo "Imagen construida: $IMAGEN (versión $VERSION)"

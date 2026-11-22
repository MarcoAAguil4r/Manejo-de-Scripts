#!/usr/bin/env bash
# Vincula la herramienta de liberación continua (GitHub Actions) con el entorno:
# instala un runner autoalojado en el servidor del entorno, con la etiqueta <entorno>.
# Los jobs de despliegue usan `runs-on: [self-hosted, <entorno>]`, así que sólo se
# ejecutan en la máquina donde corre Docker de ese entorno.
#
# Uso: RUNNER_TOKEN=<token de registro> scripts/env/register-runner.sh <owner/repo> <staging|production>
# El token se obtiene en: Repositorio > Settings > Actions > Runners > New self-hosted runner
# (caduca en 1 hora). Usa un repositorio PRIVADO: no registres runners propios en repos públicos.

set -euo pipefail

REPO="${1:?uso: register-runner.sh <owner/repo> <staging|production>}"
ENTORNO="${2:?falta el entorno}"
: "${RUNNER_TOKEN:?define RUNNER_TOKEN}"
case "$ENTORNO" in staging|production) ;; *) echo "entorno inválido"; exit 1;; esac

case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "arquitectura no soportada: $(uname -m)"; exit 1 ;;
esac

DIR="$HOME/actions-runner-$ENTORNO"
mkdir -p "$DIR" && cd "$DIR"

VERSION="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
  | grep -oE '"tag_name": *"v[0-9.]+"' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
echo "Descargando actions/runner $VERSION ($ARCH)"
curl -fsSL -o runner.tar.gz \
  "https://github.com/actions/runner/releases/download/v${VERSION}/actions-runner-linux-${ARCH}-${VERSION}.tar.gz"
tar xzf runner.tar.gz && rm runner.tar.gz

./config.sh --unattended --replace \
  --url "https://github.com/$REPO" \
  --token "$RUNNER_TOKEN" \
  --name "tienda-$ENTORNO-$(hostname -s)" \
  --labels "$ENTORNO" \
  --work "_work"

sudo ./svc.sh install
sudo ./svc.sh start
echo "Runner '$ENTORNO' registrado. Verifica que aparece 'Idle' en Settings > Actions > Runners."
echo "Recuerda: el usuario del runner debe pertenecer al grupo 'docker'."

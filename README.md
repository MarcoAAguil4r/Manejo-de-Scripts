# TalaveraShop – Liberación y despliegue continuo

Caso de estudio completo de CI/CD: aplicación de ejemplo, pipeline, entorno de liberación,
pruebas, despliegue con rollback y monitoreo. El documento con la justificación, los niveles
de servicio, las métricas y los parámetros está en **[docs/DOCUMENTO.md](docs/DOCUMENTO.md)**.

## Estructura

```
.github/workflows/   pipeline.yml (CI + CD) y rollback.yml
app/                 API Node 22 sin dependencias, pruebas unitarias, Dockerfile
environments/        docker-compose.yml, staging.env, production.env, Prometheus y Grafana
scripts/pipeline/    ci.sh, build-image.sh, local-pipeline.sh
scripts/env/         provision.sh, teardown.sh, register-runner.sh
scripts/tests/       smoke.sh, integration.mjs, load.mjs, slo-check.mjs, run-all.sh
scripts/deploy/      deploy.sh, rollback.sh, wait-healthy.sh
docs/                DOCUMENTO.md
```

## Probar la aplicación (sin Docker)

```bash
cd app && npm test                       # 9 pruebas unitarias
PORT=8099 node src/server.js &           # arrancar la API
scripts/tests/smoke.sh http://localhost:8099
node scripts/tests/integration.mjs http://localhost:8099
node scripts/tests/load.mjs http://localhost:8099 --duration 5
node scripts/tests/slo-check.mjs http://localhost:8099
```

## Ejecutar todo el flujo en una máquina con Docker

```bash
scripts/pipeline/local-pipeline.sh            # pide aprobación antes de producción
scripts/pipeline/local-pipeline.sh --auto-aprobar
```

Staging queda en http://localhost:8081 (Prometheus 9091, Grafana 3001) y producción en
http://localhost:8080 (Prometheus 9090, Grafana 3000).

## Vincular GitHub Actions con los entornos

1. Subir este repositorio a GitHub (**privado**).
2. *Settings → Environments*: crear `staging` y `production` (con *Required reviewers* y el
   secreto `GRAFANA_ADMIN_PASSWORD`).
3. En cada servidor con Docker y Node 22:
   `RUNNER_TOKEN=<token> scripts/env/register-runner.sh <owner/repo> <staging|production>`
4. Hacer push a `main`. El pipeline despliega a staging, ejecuta las pruebas y espera la
   aprobación para producción.
5. Para revertir: *Actions → rollback → Run workflow*.

## Rollback

`deploy.sh` conserva la última imagen buena. Si la nueva no pasa `/health`, `/ready` y el
humo, regresa sola. El historial queda en `.deploy-state/<entorno>/deployments.log`.

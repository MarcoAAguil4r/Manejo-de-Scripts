---
title: "Liberación y despliegue continuo de TalaveraShop"
subtitle: "Caso de estudio: pipeline, entorno, niveles de servicio, métricas y configuración"
lang: es-MX
---

# 1. Caso de estudio

**TalaveraShop** es la tienda en línea de una cooperativa de ceramistas de Puebla que vende piezas de talavera (platos, jarrones, tazas, azulejos). La venta en línea representa cerca de la mitad de sus ingresos y el pico de demanda ocurre en temporadas como el Buen Fin, Navidad y el Día de Muertos.

**Situación actual (el problema).** El equipo de desarrollo (3 personas) publica cambios copiando archivos al servidor a mano, sin pruebas automáticas y sin forma rápida de regresar a la versión anterior. En el último año:

- Dos despliegues provocaron caídas de varias horas durante campañas de venta.
- Cada liberación tarda medio día y se acumula en liberaciones grandes y poco frecuentes (riesgosas).
- Nadie sabe con datos si la tienda está sana: los problemas los reportan los clientes.

**Objetivo.** Liberar cambios pequeños, con frecuencia y con bajo riesgo: cada cambio aprobado debe llegar a producción de forma automática, verificada y reversible, y el servicio debe medirse contra objetivos explícitos.

**Aplicación.** API REST (Node.js 22) con catálogo de productos (`GET /api/productos`), alta de pedidos (`POST /api/pedidos`), sondas de salud (`/health`, `/ready`) y métricas en formato Prometheus (`/metrics`). Es *stateless*, lo que simplifica el reemplazo de versiones y el rollback. Se empaqueta como una imagen de contenedor.

**Supuestos.** No se recibió un caso de estudio específico, por lo que este caso es ilustrativo. El pipeline, los scripts y la estructura del documento son independientes del dominio: para adaptarlos a otra aplicación basta cambiar `app/`, los puertos y los umbrales de `environments/*.env` y la sección 4.

# 2. Justificación del flujo de trabajo (pipeline)

## 2.1 Flujo propuesto

```
 commit/PR ─► [1 CI] ─► [2 Build + escaneo + publicación] ─► [3 Staging: despliegue]
              lint        imagen inmutable por commit            provisión + deploy
              unitarias   Trivy (HIGH/CRITICAL bloquea)          rollback automático
                          push a GHCR                                  │
                                                                       ▼
 [6 Verificación en producción] ◄─ [5 Producción: despliegue] ◄─ [4 Pruebas en staging]
   humo + compuerta de SLO          APROBACIÓN MANUAL                humo, integración,
   rollback automático              del responsable                  carga, compuerta SLO
```

| # | Etapa | Qué hace | Se ejecuta en | Falla si… |
|---|-------|----------|---------------|-----------|
| 1 | Integración continua | Lint, pruebas unitarias, validación de la configuración del entorno | PR y `main` | Falla cualquier prueba |
| 2 | Build y publicación | Construye la imagen, la escanea y la publica con la etiqueta `sha-<commit>` | Sólo `main` | Hay vulnerabilidades HIGH/CRITICAL con corrección disponible |
| 3 | Despliegue en staging | Provisiona el entorno (idempotente) y despliega la imagen | `main` | La app no queda saludable → rollback automático |
| 4 | Pruebas en staging | Humo, integración, carga ligera y compuerta de SLO | `main` | Se rompe un umbral (sección 4) |
| 5 | Despliegue en producción | Igual que 3, pero detrás de aprobación manual | `main` | Rechazo del aprobador o falla de verificación |
| 6 | Verificación posterior | Humo + compuerta de SLO sin generar carga ni pedidos de prueba | `main` | SLO incumplido → rollback |

## 2.2 Por qué este diseño

**Una sola imagen inmutable recorre todo el flujo (*build once, deploy many*).** La imagen que se prueba en staging es exactamente la que llega a producción; sólo cambia la configuración externa (`environments/<entorno>.env`). Esto elimina la clase de fallos "en staging funcionaba" y permite el rollback instantáneo: la versión anterior ya existe como imagen en el registro.

**Trunk-based con PR cortos.** La rama `main` es siempre desplegable. Los PR ejecutan sólo la etapa 1 (rápida, <3 min) para dar retroalimentación inmediata sin consumir los entornos; sólo lo que entra a `main` avanza por el resto del pipeline. Esto favorece cambios pequeños, que son más fáciles de revisar, probar y revertir, y ataca directamente el problema de las liberaciones grandes y riesgosas.

**Pruebas por capas, de más barata a más cara (*fail fast*).** Unitarias (segundos) → humo (¿arrancó?) → integración (¿hace lo correcto?) → carga (¿aguanta?) → SLO (¿cumple lo prometido?). Si falla una capa barata no se pagan las caras.

**Seguridad integrada (*shift-left*).** El escaneo de la imagen ocurre antes de publicarla; la imagen se ejecuta sin privilegios (usuario `node`, sistema de archivos de solo lectura, `cap_drop: ALL`, `no-new-privileges`); y los secretos viven en *Environments* de GitHub, no en el repositorio.

**Aprobación manual sólo donde aporta.** Staging es automático (es barato equivocarse ahí). Producción requiere la aprobación de un responsable porque el negocio puede querer evitar liberar durante una campaña de ventas. Es un cambio de política, no de herramienta: quitar la aprobación convertiría el flujo en despliegue continuo puro.

**Reversibilidad como requisito, no como extra.** `deploy.sh` conserva la última imagen buena conocida; si la nueva versión no pasa `/health`, `/ready` y el humo, regresa sola. Además existe `rollback.yml` para un regreso manual. El objetivo de recuperación (sección 4) depende de esto.

**Compuerta de SLO.** La liberación no sólo debe "arrancar": debe cumplir los niveles de servicio acordados. Por eso las etapas 4 y 6 evalúan disponibilidad y latencia a partir de las métricas reales de la aplicación.

**Por qué estas herramientas.**

| Necesidad | Elección | Razón |
|-----------|----------|-------|
| Orquestador del pipeline | GitHub Actions | Integrado con el repositorio, *Environments* con aprobadores y secretos, sin servidor propio que mantener |
| Ejecución del despliegue | Runner autoalojado por entorno (etiquetas `staging`, `production`) | Despliega sin abrir SSH desde Internet y garantiza que cada job corre en el servidor del entorno correcto |
| Empaquetado | Docker + registro GHCR | Artefacto inmutable y portable; autenticación con el mismo `GITHUB_TOKEN` |
| Entorno | Docker Compose | Suficiente para una app con 3 servicios; reproducible con un solo archivo y alcanzable para un equipo pequeño. Kubernetes sería sobredimensionado en este momento |
| Observabilidad | Prometheus + Grafana | Estándar de facto, abierto, con alertas basadas en los SLO |
| Escaneo | Trivy | Gratuito, rápido y con acción oficial para GitHub Actions |

**Limitaciones asumidas.** Con Compose el reemplazo de `app` implica unos segundos de indisponibilidad (no es *blue-green*). Para el volumen de TalaveraShop es aceptable y se compensa con el rollback automático; si el SLO de disponibilidad se endurece (por ejemplo a 99.9%) habría que pasar a *blue-green* o a un orquestador.

# 3. Entorno requerido para la liberación y el despliegue continuo

## 3.1 Topología

```
Desarrollador ──push──► GitHub (repo privado)
                          │  Actions: CI, build, Trivy      ┌─────────────────────────────┐
                          ├────────── push imagen ─────────►│ GHCR (registro de imágenes) │
                          │                                 └──────────────┬──────────────┘
                          │ jobs de despliegue (long-poll saliente)        │ pull
                          ▼                                                ▼
        ┌───────────── Servidor STAGING ─────────────┐   ┌──────────── Servidor PRODUCTION ────────────┐
        │ runner [self-hosted, staging]              │   │ runner [self-hosted, production]            │
        │ docker compose: app :8081                  │   │ docker compose: app :8080                   │
        │                 prometheus :9091           │   │                 prometheus :9090            │
        │                 grafana :3001              │   │                 grafana :3000               │
        └────────────────────────────────────────────┘   └─────────────────────────────────────────────┘
```

El runner inicia la conexión hacia GitHub (saliente), por lo que no hace falta exponer puertos de administración.

## 3.2 Requisitos

| Componente | Requisito |
|------------|-----------|
| Servidores | 2 máquinas (o 1 para fines académicos, usando los puertos distintos de cada entorno). Mínimo por entorno: 2 vCPU, 4 GB RAM, 30 GB de disco |
| Sistema operativo | Linux (Ubuntu Server 22.04/24.04 LTS recomendado), x86_64 o arm64 |
| Software en el servidor | Docker Engine 24+ con Docker Compose v2, `curl`, `bash`, Node.js 22 (para las pruebas de integración, carga y SLO) |
| Usuario del runner | Pertenece al grupo `docker`; no es `root` |
| Repositorio | GitHub, **privado** (no se deben registrar runners propios en repositorios públicos) |
| Red | Salida a `github.com`, `*.actions.githubusercontent.com`, `ghcr.io` y Docker Hub (imágenes de Prometheus/Grafana). Entrada sólo a 8080 (tienda) en producción; Prometheus y Grafana deben restringirse por firewall/VPN |
| Puertos | Staging: 8081 (app), 9091 (Prometheus), 3001 (Grafana). Producción: 8080, 9090, 3000 |
| Secretos | `GRAFANA_ADMIN_PASSWORD` en el Environment `production` (el pipeline se niega a provisionar producción con la contraseña por defecto). `GITHUB_TOKEN` lo emite Actions automáticamente |
| GitHub Environments | `staging` (sin revisores) y `production` (con **Required reviewers**) |

## 3.3 Cómo se genera el entorno

`scripts/env/provision.sh <entorno>` es idempotente y hace lo siguiente: verifica Docker y Compose, renderiza la configuración de Prometheus para ese entorno a partir de una plantilla, valida el `docker-compose.yml` y levanta Prometheus y Grafana con sus volúmenes persistentes. La aplicación la despliega `scripts/deploy/deploy.sh`, de modo que provisionar el entorno y liberar una versión son responsabilidades separadas.

# 4. Niveles de servicio acordados

Se distingue entre **SLI** (lo que se mide), **SLO** (el objetivo interno) y **SLA** (el compromiso con el cliente, que debe ser menos exigente que el SLO para dejar margen).

## 4.1 Acuerdo con el negocio (producción)

| Indicador (SLI) | Cómo se mide | SLO (objetivo interno) | SLA (compromiso) |
|-----------------|--------------|------------------------|------------------|
| Disponibilidad | 1 − (respuestas 5xx ÷ total de peticiones), ventana de 30 días en Prometheus | ≥ 99.5% | ≥ 99.0% |
| Latencia | Percentil 95 de `http_request_duration_seconds`, ventana de 30 días en Prometheus | ≤ 300 ms | ≤ 500 ms |
| Tasa de errores | Respuestas 5xx ÷ total, ventana de 5 min | < 1% | — |
| Horario de soporte | Atención de incidentes críticos | 24×7 en campañas; 9–18 h L–V fuera de ellas | Igual |

**Presupuesto de error.** Un SLO de 99.5% en 30 días permite 0.5% de fallo: 43,200 min × 0.005 = **216 min (3 h 36 min)** de indisponibilidad al mes. Mientras quede presupuesto, se libera con normalidad; si se consume, se congelan las liberaciones no urgentes hasta recuperar la estabilidad. La alerta `PresupuestoDeErrorQuemandoRapido` avisa cuando el consumo es 14.4 veces más rápido de lo permitido.

> Las respuestas 4xx (por ejemplo, un pedido inválido) son errores del cliente y no cuentan contra la disponibilidad.

## 4.2 Niveles de servicio del proceso de liberación

| Objetivo | Meta |
|----------|------|
| Tiempo de ejecución del pipeline hasta staging verificado | ≤ 15 min |
| Plazo de cambio (commit → producción), sin contar la espera de aprobación | ≤ 30 min |
| Frecuencia de liberación | Bajo demanda, al menos una vez al día laboral |
| Tasa de fallos de cambios | < 15% |
| Tiempo de recuperación ante despliegue fallido (rollback automático) | ≤ 5 min |
| Tiempo máximo de recuperación ante incidente (RTO) | ≤ 15 min |
| Pérdida máxima de datos (RPO) | No aplica a la API (sin estado). Se definirá cuando se incorpore base de datos |

## 4.3 Cómo se hacen cumplir

- **Etapa 4 (staging):** `load.mjs` valida la carga y `slo-check.mjs` compara las series de Prometheus de los últimos 5 min con los umbrales.
- **Etapa 6 (producción):** `slo-check.mjs` consulta Prometheus para los últimos 30 días; Prometheus conserva 35 días de datos para cubrir la ventana completa.
- **Operación continua:** reglas de Prometheus (`alert.rules.yml`) que traducen los SLO en alertas.

La compuerta informa como inconclusa y no evalúa disponibilidad/latencia cuando la ventana contiene menos de 20 peticiones; es necesario acumular historial antes de que pueda evaluarse.

# 5. Métricas para el monitoreo de la aplicación

La aplicación expone `/metrics` y Prometheus las recolecta cada 15 s. Se agrupan en cuatro familias.

## 5.1 Señales de servicio (método RED)

| Métrica | Tipo | Etiquetas | Para qué sirve |
|---------|------|-----------|----------------|
| `http_requests_total` | counter | `method`, `route`, `status` | **R**ate y **E**rrors: tráfico y proporción de 5xx (base del SLO de disponibilidad) |
| `http_request_duration_seconds` | histogram | `method`, `route` | **D**uration: p50/p95/p99 (base del SLO de latencia). Los buckets incluyen 0.3 s, el umbral del SLO |

Consultas útiles:

```promql
# Disponibilidad (30 días)
1 - sum(increase(http_requests_total{job="talaverashop-app",status=~"5.."}[30d]))
    / sum(increase(http_requests_total{job="talaverashop-app"}[30d]))
# Latencia p95 (30 días)
histogram_quantile(0.95,
  sum by (le) (rate(http_request_duration_seconds_bucket{job="talaverashop-app"}[30d])))
```

## 5.2 Salud del proceso y del despliegue

| Métrica | Uso |
|---------|-----|
| `up{job="talaverashop-app"}` | ¿Prometheus alcanza la app? (alerta `AppCaida`) |
| `app_info{version,entorno}` | Qué versión está desplegada; permite marcar despliegues en los gráficos |
| `app_uptime_seconds` | Detecta reinicios inesperados (el valor se reinicia) |
| `process_resident_memory_bytes` | Fugas de memoria frente al límite del contenedor (`APP_MEM_LIMIT`) |

## 5.3 Métricas de negocio

| Métrica | Uso |
|---------|-----|
| `pedidos_creados_total` | Pedidos aceptados: una caída súbita con tráfico normal indica un fallo funcional que los códigos HTTP no muestran |
| `pedidos_rechazados_total` | Pedidos rechazados por validación: un aumento tras un despliegue sugiere una regresión |

## 5.4 Métricas del proceso de liberación (DORA)

| Métrica | Fuente | Meta |
|---------|--------|------|
| Frecuencia de despliegue | `.deploy-state/<entorno>/deployments.log` y el historial de Actions | ≥ 1 por día laboral |
| Plazo de entrega de cambios | Tiempo entre commit y despliegue en producción | ≤ 30 min (sin aprobación) |
| Tasa de fallos de cambios | Registros `fallo` y `rollback-*` sobre el total en `deployments.log` | < 15% |
| Tiempo de recuperación | De `fallo` a `rollback-ok` en `deployments.log` | ≤ 5 min |

## 5.5 Alertas definidas

| Alerta | Condición | Severidad |
|--------|-----------|-----------|
| `AppCaida` | `up == 0` durante 1 min | Crítica |
| `TasaDeErroresAlta` | 5xx > 1% durante 5 min | Crítica |
| `LatenciaP95Alta` | p95 > 300 ms durante 5 min | Advertencia |
| `PresupuestoDeErrorQuemandoRapido` | Consumo del presupuesto > 14.4× en 1 h | Crítica |

El dashboard **TalaveraShop – RED y SLO** (Grafana, aprovisionado automáticamente) muestra tasa de peticiones, % de errores, latencia p95, pedidos creados y versión desplegada.

# 6. Parámetros de configuración de las herramientas utilizadas

## 6.1 GitHub Actions (`.github/workflows/pipeline.yml`)

| Parámetro | Valor | Motivo |
|-----------|-------|--------|
| Disparadores | `pull_request` y `push` a `main`; `workflow_dispatch` | PR sólo CI; `main` ejecuta el flujo completo |
| `concurrency` | `pipeline-${{ github.ref }}`; cancela sólo en PR | Evita interrumpir un despliegue en curso |
| `permissions` (global) | `contents: read` | Mínimo privilegio |
| `permissions` (build) | `packages: write` | Publicar la imagen |
| `permissions` (deploy) | `packages: read` | Descargar la imagen |
| `timeout-minutes` | 10–15 por job | Evita jobs colgados |
| `runs-on` | `ubuntu-latest` (CI, build); `[self-hosted, staging]` y `[self-hosted, production]` (despliegue y pruebas) | Cada despliegue corre en su servidor |
| `environment` | `staging`; `production` con *Required reviewers* | Aprobación manual y secretos por entorno |
| Versión de Node | 22 | Misma que la imagen |
| Etiqueta de imagen | `ghcr.io/<owner>/<repo>:sha-<7 caracteres del commit>` | Trazabilidad commit → imagen |
| Secretos | `GRAFANA_ADMIN_PASSWORD` (Environment `production`) | La contraseña no se guarda en el repositorio |

## 6.2 Escaneo de seguridad (Trivy)

| Parámetro | Valor |
|-----------|-------|
| `severity` | `HIGH,CRITICAL` |
| `ignore-unfixed` | `true` (sólo bloquea lo que tiene corrección disponible) |
| `exit-code` | `1` (la etapa falla y la imagen no se publica) |

## 6.3 Runners autoalojados (`scripts/env/register-runner.sh`)

| Parámetro | Valor |
|-----------|-------|
| Etiqueta | `staging` o `production` (además de `self-hosted`) |
| Nombre | `tienda-<entorno>-<hostname>` |
| Directorio de trabajo | `_work` |
| Ejecución | Como servicio (`svc.sh install/start`) |
| Requisito | Usuario en el grupo `docker`, repositorio privado |

## 6.4 Docker (`app/Dockerfile`)

| Parámetro | Valor |
|-----------|-------|
| Imagen base | `node:22-alpine` |
| Usuario | `node` (no root) |
| `APP_VERSION` | Argumento de build, igual a la etiqueta de la imagen |
| `PORT` | `3000` |
| `HEALTHCHECK` | cada 10 s, timeout 3 s, inicio 5 s, 3 reintentos |
| Herramientas de empaquetado en runtime | `npm` y `npx` se eliminan de la imagen final; no hay dependencias de runtime |
| `.dockerignore` | `node_modules`, `test`, `*.md`, `.git` |

## 6.5 Docker Compose (`environments/docker-compose.yml`)

| Parámetro (servicio `app`) | Staging | Producción |
|----------------------------|---------|------------|
| Puerto publicado (`APP_PORT`) | 8081 | 8080 |
| Límite de memoria (`APP_MEM_LIMIT`) | 256m | 512m |
| Límite de CPU (`APP_CPUS`) | 0.5 | 1.0 |
| `LOG_LEVEL` | debug | info |
| `restart` | `unless-stopped` | `unless-stopped` |
| `read_only` / `tmpfs` | `true` / `/tmp` | igual |
| `cap_drop` / `security_opt` | `ALL` / `no-new-privileges:true` | igual |
| `stop_grace_period` | 15 s | 15 s |
| Logs | `json-file`, 10 MB × 3 archivos | igual |

Imágenes con versión fija: `prom/prometheus:v2.55.1` y `grafana/grafana:11.3.0`.

## 6.6 Prometheus (`environments/prometheus/`)

| Parámetro | Staging | Producción |
|-----------|---------|------------|
| `scrape_interval` / `evaluation_interval` (`PROM_SCRAPE_INTERVAL`) | 15 s | 15 s |
| Retención (`PROM_RETENTION`) | 7 d | 35 d |
| Ventana de la compuerta SLO (`SLO_WINDOW`) | 5 min | 30 d |
| Puerto externo (`PROM_PORT`) | 9091 | 9090 |
| Objetivo de scraping | `app:3000/metrics` | `app:3000/metrics` |
| Etiqueta externa `entorno` | `staging` | `production` |
| Reglas | `alert.rules.yml` (sección 5.5) | igual |

## 6.7 Grafana

| Parámetro | Valor |
|-----------|-------|
| Datasource | Prometheus en `http://prometheus:9090` (aprovisionado) |
| Dashboard | `talaverashop.json`, refresco 10 s, rango 1 h (aprovisionado) |
| Usuario / contraseña | `admin` / `GRAFANA_ADMIN_PASSWORD` (obligatoria en producción) |
| `GF_USERS_ALLOW_SIGN_UP` | `false` |
| Puerto externo (`GRAFANA_PORT`) | 3001 (staging), 3000 (producción) |

## 6.8 Scripts de despliegue y pruebas (umbrales)

| Parámetro | Staging | Producción | Descripción |
|-----------|---------|------------|-------------|
| `LOAD_DURATION` | 20 s | 10 s* | Duración de la prueba de carga |
| `LOAD_CONCURRENCY` | 20 | 5* | Usuarios virtuales |
| `SLO_MIN_AVAILABILITY` | 99.5 | 99.5 | Disponibilidad mínima (%) |
| `SLO_MAX_P95_MS` | 300 | 300 | Latencia p95 máxima (ms) |
| `SLO_WINDOW` | 5 min | 30 d | Ventana consultada en la API de Prometheus |
| Tiempo de espera de salud | 60 s | 60 s | `wait-healthy.sh` |
| Muestras mínimas del SLO | 20 | 20 | Con menos tráfico la compuerta informa que no hay datos suficientes |

\* En producción no se ejecuta la carga ni la integración (`--solo-verificacion`) para no generar pedidos de prueba; los valores se dejan definidos por si se habilita un ensayo controlado.

# 7. Vinculación de la herramienta de liberación continua con el entorno

La herramienta (GitHub Actions) queda vinculada al entorno mediante los runners con etiqueta. Pasos para dejarla operativa:

1. Crear un repositorio **privado** en GitHub y subir el contenido de este repositorio.
2. En *Settings → Environments* crear `staging` y `production`; en `production` agregar *Required reviewers* y el secreto `GRAFANA_ADMIN_PASSWORD`.
3. En cada servidor, instalar Docker y Node 22, y registrar su runner:
   `RUNNER_TOKEN=<token> scripts/env/register-runner.sh <owner/repo> staging` (y `production` en el otro servidor). El token se genera en *Settings → Actions → Runners → New self-hosted runner*.
4. Comprobar que ambos runners aparecen como **Idle**.
5. Hacer un commit a `main`: el pipeline recorre las etapas 1 a 4 solo y queda en pausa esperando aprobación para producción.
6. Probar el rollback desde *Actions → rollback → Run workflow*.

# 8. Contenido del repositorio y ejecución

| Ruta | Contenido |
|------|-----------|
| `.github/workflows/pipeline.yml`, `rollback.yml` | **Scripts del flujo de trabajo (pipeline)** de CI/CD y rollback |
| `scripts/pipeline/` | `ci.sh`, `build-image.sh`, `local-pipeline.sh` (el mismo flujo en una sola máquina) |
| `scripts/env/`, `environments/` | **Scripts para generar el entorno**: `provision.sh`, `teardown.sh`, `register-runner.sh`; Compose, Prometheus, Grafana y parámetros por entorno |
| `scripts/tests/` | **Pruebas en el entorno de liberación**: `smoke.sh`, `integration.mjs`, `load.mjs`, `slo-check.mjs`, `run-all.sh` |
| `scripts/deploy/` | **Scripts del despliegue**: `deploy.sh` (con rollback automático), `rollback.sh`, `wait-healthy.sh` |
| `app/` | Aplicación, pruebas unitarias y Dockerfile |
| `docs/DOCUMENTO.md` | Este documento |

Ejecución local de todo el flujo (requiere Docker): `scripts/pipeline/local-pipeline.sh`.

# 9. Evidencia de verificación y alcance

Las 13 pruebas unitarias y de la compuerta SLO pasan localmente; CI también pasó lint y pruebas en GitHub Actions. En la última corrida de Actions se construyó la imagen, el escaneo Trivy pasó sin bloquear y la imagen se publicó en GHCR. La imagen de runtime elimina `npm` y `npx`, que originaban los hallazgos HIGH de la corrida anterior.

La aplicación, Prometheus y Grafana todavía deben desplegarse en un servidor con Docker. Para completar la integración real hay que configurar los *Environments* y el secreto de producción, registrar los runners y obtener una corrida exitosa hasta staging y producción. Las consultas de la compuerta SLO se probaron con respuestas simuladas de Prometheus; deben verificarse contra un Prometheus desplegado. Los niveles de servicio de la sección 4 son objetivos propuestos para aprobación del responsable del servicio.

# 10. Riesgos y mejoras futuras

| Riesgo / limitación | Mitigación o mejora |
|---------------------|---------------------|
| Pequeña interrupción al reemplazar `app` con Compose | Rollback automático; migrar a *blue-green* si el SLO sube a 99.9% |
| Runner autoalojado con acceso a Docker (superficie de ataque) | Repositorio privado, servidor dedicado, usuario sin privilegios, actualizar el runner |
| Catálogo en memoria | Incorporar base de datos y definir RPO, respaldos y migraciones versionadas en el pipeline |
| Prometheus y Grafana expuestos | Restringir por firewall/VPN o publicarlos tras un proxy con autenticación |
| Sin notificaciones | Agregar Alertmanager hacia correo o mensajería |
| Prueba de carga ligera | Sustituirla por k6 u otra herramienta cuando el tráfico lo justifique |

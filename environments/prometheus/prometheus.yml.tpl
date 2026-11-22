# Plantilla: scripts/env/provision.sh sustituye los marcadores __X__ y la deja en
# .deploy-state/<entorno>/prometheus/prometheus.yml
global:
  scrape_interval: __SCRAPE_INTERVAL__
  evaluation_interval: __SCRAPE_INTERVAL__
  external_labels:
    entorno: __ENV_NAME__

rule_files:
  - /etc/prometheus/alert.rules.yml

scrape_configs:
  - job_name: talaverashop-app
    metrics_path: /metrics
    static_configs:
      - targets: ["app:3000"]
  - job_name: prometheus
    static_configs:
      - targets: ["localhost:9090"]

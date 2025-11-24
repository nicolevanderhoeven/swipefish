# Observability Stack Implementation Summary

This document summarizes the observability stack implementation for Swipefish.

## What Was Implemented

### Backend Instrumentation (OpenTelemetry)

1. **OpenTelemetry SDK Setup** (`backend/src/instrumentation.ts`)
   - Automatic instrumentation for Express, HTTP, and PostgreSQL
   - OTLP exporter for traces (sends to Tempo)
   - Prometheus metrics exporter (exposes `/metrics` endpoint)
   - Resource attributes configuration

2. **Manual Instrumentation** (`backend/src/rooms.ts`)
   - Manual spans for Socket.io events:
     - `socket.io.connection` - Client connections
     - `socket.io.create-room` - Room creation
     - `socket.io.join-room` - Player joining rooms
     - `socket.io.remove-player` - Player leaving rooms
     - `socket.io.disconnect` - Client disconnections
   - Structured logging with trace correlation IDs
   - Error tracking with span recording

3. **Dependencies Added** (`backend/package.json`)
   - `@opentelemetry/api`
   - `@opentelemetry/sdk-node`
   - `@opentelemetry/auto-instrumentations-node`
   - `@opentelemetry/exporter-otlp-http`
   - `@opentelemetry/exporter-prometheus`
   - `@opentelemetry/resources`
   - `@opentelemetry/semantic-conventions`
   - `@opentelemetry/sdk-metrics`
   - `prom-client`

### Frontend Instrumentation (Grafana Faro)

1. **Faro SDK Setup** (`frontend/src/instrumentation.ts`)
   - Automatic RUM (Real User Monitoring) instrumentation
   - Error tracking
   - Performance monitoring
   - OpenTelemetry integration for distributed tracing

2. **Dependencies Added** (`frontend/package.json`)
   - `@grafana/faro-web-sdk`
   - `@grafana/faro-web-tracing`

### Kubernetes Observability Stack

1. **Prometheus** (`k8s/prometheus-*.yaml`)
   - Deployment with persistent storage (20Gi)
   - Service with LoadBalancer for Grafana Cloud access
   - Configuration to scrape backend metrics on port 9464
   - 30-day retention

2. **Loki** (`k8s/loki-*.yaml`)
   - Deployment with persistent storage (50Gi)
   - Service with LoadBalancer for Grafana Cloud access
   - Configuration for log aggregation
   - 7-day retention

3. **Tempo** (`k8s/tempo-*.yaml`)
   - Deployment with persistent storage (20Gi)
   - Service with LoadBalancer for Grafana Cloud access
   - OTLP receiver on ports 4317 (gRPC) and 4318 (HTTP)
   - 1-hour retention

4. **Pyroscope** (`k8s/pyroscope-*.yaml`)
   - Deployment with persistent storage (10Gi)
   - Service with LoadBalancer for Grafana Cloud access
   - Continuous profiling endpoint

5. **Storage** (`k8s/observability-storage.yaml`)
   - PersistentVolumeClaims for all components
   - Uses `do-block-storage` storage class (DigitalOcean)

6. **Namespace** (`k8s/observability-namespace.yaml`)
   - Separate namespace for observability components

### Configuration Updates

1. **Backend Deployment** (`k8s/backend-deployment.yaml`)
   - Added metrics port (9464)
   - Added observability environment variables:
     - `OTEL_SERVICE_NAME`
     - `OTEL_EXPORTER_OTLP_ENDPOINT`
     - `OTEL_RESOURCE_ATTRIBUTES`
     - `PROMETHEUS_PORT`
     - `LOKI_ENDPOINT`

2. **ConfigMap** (`k8s/configmap.yaml`)
   - Added observability configuration values

## Next Steps

### 1. Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd frontend
npm install
```

### 2. Deploy Observability Stack

Follow the instructions in `k8s/OBSERVABILITY_SETUP.md` to:
- Deploy all observability components to Kubernetes
- Get LoadBalancer IPs
- Configure Grafana Cloud data sources

### 3. Configure Log Collection

For log collection, you have two options:

**Option A: Use Promtail (Recommended)**
- Deploy Promtail as a DaemonSet to collect logs from all pods
- Promtail will automatically collect stdout/stderr logs
- Configure Promtail to send logs to Loki

**Option B: Use kubectl logs**
- Manually collect logs using `kubectl logs`
- Send to Loki via API or script

### 4. Test Instrumentation

1. **Backend Metrics**: Check that metrics are exposed:
   ```bash
   kubectl port-forward deployment/backend 9464:9464 -n swipefish
   curl http://localhost:9464/metrics
   ```

2. **Traces**: Verify traces are being sent to Tempo by checking Tempo UI

3. **Logs**: Verify structured logs are being generated (check pod logs)

4. **Frontend**: Verify Faro is initialized (check browser console)

### 5. Create Dashboards

In Grafana Cloud, create dashboards for:
- Application overview
- Socket.io performance
- Room management metrics
- Database performance
- Error tracking
- Frontend RUM (if using Faro)

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Grafana Cloud                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Grafana (Shared Instance)                      │  │
│  │  - Dashboards                                    │  │
│  │  - Data Sources:                                │  │
│  │    • Prometheus (K8s)                           │  │
│  │    • Loki (K8s)                                  │  │
│  │    • Tempo (K8s)                                 │  │
│  │    • Pyroscope (K8s)                             │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                        │
                        │ (HTTP/HTTPS)
                        │
┌─────────────────────────────────────────────────────────┐
│              Kubernetes Cluster                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Observability Namespace                         │  │
│  │  • Prometheus (LoadBalancer)                     │  │
│  │  • Loki (LoadBalancer)                           │  │
│  │  • Tempo (LoadBalancer)                          │  │
│  │  • Pyroscope (LoadBalancer)                      │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Swipefish Namespace                             │  │
│  │  • Backend (OpenTelemetry)                       │  │
│  │    - Metrics → Prometheus                        │  │
│  │    - Traces → Tempo                             │  │
│  │    - Logs → Loki (via Promtail)                 │  │
│  │  • Frontend (Faro)                                │  │
│  │    - RUM → Grafana Cloud                        │  │
│  │    - Traces → Tempo                             │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Environment Variables

### Backend

- `OTEL_SERVICE_NAME`: Service name for traces (default: `swipefish-backend`)
- `OTEL_EXPORTER_OTLP_ENDPOINT`: Tempo endpoint (default: `http://localhost:4318`)
- `OTEL_RESOURCE_ATTRIBUTES`: Resource attributes (default: `app=swipefish`)
- `PROMETHEUS_PORT`: Metrics port (default: `9464`)
- `LOKI_ENDPOINT`: Loki endpoint (for future log shipping)

### Frontend

- `VITE_FARO_ENDPOINT`: Faro collector endpoint (optional)
- `VITE_FARO_APP_NAME`: Application name (default: `swipefish-frontend`)
- `VITE_OTEL_EXPORTER_OTLP_ENDPOINT`: OTLP endpoint for traces

## Notes

- The OpenTelemetry import error in the linter is expected until `npm install` is run
- Logs are structured as JSON with trace correlation IDs for easy querying in Loki
- All observability services use LoadBalancer for external access (consider Ingress with auth for production)
- Storage classes may need to be adjusted based on your Kubernetes cluster provider


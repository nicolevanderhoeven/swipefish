# Observability Stack Setup Guide

This guide explains how to set up the observability stack for Swipefish with Grafana Cloud.

## Architecture

- **Backends (Kubernetes)**: Prometheus, Loki, Tempo, Pyroscope
- **Visualization (Grafana Cloud)**: Shared Grafana instance

## Prerequisites

1. Kubernetes cluster with access
2. Grafana Cloud account (https://grafana.com/auth/sign-up/create-cloud)
3. `kubectl` configured to access your cluster

## Step 1: Deploy Observability Stack to Kubernetes

Deploy all observability components:

```bash
# Create observability namespace
kubectl apply -f observability-namespace.yaml

# Deploy storage (PVCs)
kubectl apply -f observability-storage.yaml

# Deploy Prometheus
kubectl apply -f prometheus-configmap.yaml
kubectl apply -f prometheus-deployment.yaml

# Deploy Loki
kubectl apply -f loki-configmap.yaml
kubectl apply -f loki-deployment.yaml

# Deploy Tempo
kubectl apply -f tempo-configmap.yaml
kubectl apply -f tempo-deployment.yaml

# Deploy Pyroscope
kubectl apply -f pyroscope-deployment.yaml
```

Wait for all pods to be ready:

```bash
kubectl wait --for=condition=ready pod -l app=prometheus -n observability --timeout=300s
kubectl wait --for=condition=ready pod -l app=loki -n observability --timeout=300s
kubectl wait --for=condition=ready pod -l app=tempo -n observability --timeout=300s
kubectl wait --for=condition=ready pod -l app=pyroscope -n observability --timeout=300s
```

## Step 2: Get LoadBalancer IPs

Get the external IPs for the services (needed for Grafana Cloud):

```bash
# Prometheus
kubectl get svc prometheus -n observability

# Loki
kubectl get svc loki -n observability

# Tempo
kubectl get svc tempo -n observability

# Pyroscope
kubectl get svc pyroscope -n observability
```

Note the `EXTERNAL-IP` values. These will be used to configure Grafana Cloud data sources.

## Step 3: Configure Grafana Cloud Data Sources

1. Log in to Grafana Cloud: https://grafana.com/auth/sign-in

2. Navigate to your Grafana instance

3. Go to **Configuration** → **Data Sources** → **Add data source**

### Add Prometheus

- **Name**: `Prometheus (Swipefish)`
- **Type**: Prometheus
- **URL**: `http://<PROMETHEUS_EXTERNAL_IP>:9090`
- **Access**: Server (default)
- Click **Save & Test**

### Add Loki

- **Name**: `Loki (Swipefish)`
- **Type**: Loki
- **URL**: `http://<LOKI_EXTERNAL_IP>:3100`
- **Access**: Server (default)
- Click **Save & Test**

### Add Tempo

- **Name**: `Tempo (Swipefish)`
- **Type**: Tempo
- **URL**: `http://<TEMPO_EXTERNAL_IP>:3200`
- **Access**: Server (default)
- Click **Save & Test**

### Add Pyroscope

- **Name**: `Pyroscope (Swipefish)`
- **Type**: Pyroscope
- **URL**: `http://<PYROSCOPE_EXTERNAL_IP>:4040`
- **Access**: Server (default)
- Click **Save & Test**

## Step 4: Configure Backend Application

The backend is already configured to send telemetry data to the observability stack. Verify the configuration in `k8s/configmap.yaml`:

- `OTEL_EXPORTER_OTLP_ENDPOINT`: Points to Tempo for traces
- `LOKI_ENDPOINT`: Points to Loki for logs
- `PROMETHEUS_PORT`: Port for metrics endpoint

## Step 5: Configure Frontend Application

Update frontend environment variables (in your build process or ConfigMap):

- `VITE_FARO_ENDPOINT`: Grafana Cloud Faro endpoint (optional, if using Grafana Cloud for frontend)
- `VITE_FARO_APP_NAME`: `swipefish-frontend`
- `VITE_OTEL_EXPORTER_OTLP_ENDPOINT`: `http://<TEMPO_EXTERNAL_IP>:4318` (for browser-based traces)

## Step 6: Create Dashboards

In Grafana Cloud, create dashboards for:

1. **Application Overview**
   - Metrics from Prometheus
   - Logs from Loki
   - Traces from Tempo

2. **Socket.io Performance**
   - Connection count
   - Events per second
   - Latency metrics

3. **Room Management**
   - Room creation rate
   - Player counts
   - Error rates

4. **Database Performance**
   - Query duration
   - Connection pool metrics

5. **Frontend RUM** (if using Faro)
   - Page load times
   - Error rates
   - User sessions

6. **Error Tracking**
   - Errors by type
   - Trace correlation

## Security Considerations

### Option 1: Basic Auth (Recommended for Production)

Add authentication to the services using Ingress with basic auth:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: prometheus-ingress
  namespace: observability
  annotations:
    nginx.ingress.kubernetes.io/auth-type: basic
    nginx.ingress.kubernetes.io/auth-secret: prometheus-auth
spec:
  rules:
  - host: prometheus.yourdomain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: prometheus
            port:
              number: 9090
```

Create the auth secret:

```bash
htpasswd -c auth prometheus
kubectl create secret generic prometheus-auth --from-file=auth -n observability
```

### Option 2: VPN/Tunnel

For maximum security, use a VPN or tunnel to connect Grafana Cloud to your Kubernetes cluster privately.

## Troubleshooting

### Check Pod Status

```bash
kubectl get pods -n observability
```

### Check Service Status

```bash
kubectl get svc -n observability
```

### View Logs

```bash
# Prometheus
kubectl logs -f deployment/prometheus -n observability

# Loki
kubectl logs -f deployment/loki -n observability

# Tempo
kubectl logs -f deployment/tempo -n observability

# Pyroscope
kubectl logs -f deployment/pyroscope -n observability
```

### Test Connectivity from Grafana Cloud

From Grafana Cloud, test each data source connection. If connections fail:

1. Verify LoadBalancer IPs are accessible
2. Check firewall rules
3. Verify service endpoints are correct
4. Check pod logs for errors

### Verify Backend Instrumentation

Check that the backend is exposing metrics:

```bash
# Port-forward to backend
kubectl port-forward deployment/backend 9464:9464 -n swipefish

# In another terminal, check metrics
curl http://localhost:9464/metrics
```

## Maintenance

### Storage Retention

- **Prometheus**: 30 days (configured in deployment)
- **Loki**: 7 days (configured in configmap)
- **Tempo**: 1 hour (configured in configmap)
- **Pyroscope**: Based on storage capacity

### Backup

Regularly backup PersistentVolumeClaims if needed:

```bash
# Example: Backup Prometheus data
kubectl exec -n observability deployment/prometheus -- tar czf /tmp/prometheus-backup.tar.gz /prometheus
kubectl cp observability/prometheus-xxx:/tmp/prometheus-backup.tar.gz ./prometheus-backup.tar.gz
```

### Scaling

For production, consider:
- Increasing replica counts for high availability
- Using StatefulSets for stateful components
- Adding resource limits based on usage
- Implementing horizontal pod autoscaling

## Next Steps

1. Set up alerting rules in Grafana Cloud
2. Create custom dashboards for your specific use cases
3. Configure log aggregation for application logs
4. Set up continuous profiling analysis
5. Implement distributed tracing across services


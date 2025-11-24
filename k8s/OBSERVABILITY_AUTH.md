# Adding Authentication to Observability Services

Currently, the observability services (Prometheus, Loki, Tempo) are exposed via LoadBalancer with **no authentication**. They are publicly accessible.

## Quick Setup: Basic Auth

### Step 1: Create Basic Auth Secret

Create a username/password for authentication:

```bash
# Install htpasswd if not available (macOS: brew install httpd, Linux: apt-get install apache2-utils)
htpasswd -c auth observability

# Enter a password when prompted
# This creates a file called 'auth'

# Create the Kubernetes secret
kubectl create secret generic observability-auth \
  --from-file=auth \
  -n observability
```

### Step 2: Change Services to ClusterIP

Update the services to use ClusterIP instead of LoadBalancer, then use Ingress:

```bash
# Update services to ClusterIP
kubectl patch svc prometheus -n observability -p '{"spec":{"type":"ClusterIP"}}'
kubectl patch svc loki -n observability -p '{"spec":{"type":"ClusterIP"}}'
kubectl patch svc tempo -n observability -p '{"spec":{"type":"ClusterIP"}}'
```

### Step 3: Deploy Ingress with Basic Auth

1. Update `k8s/observability-ingress.yaml` with your domain names (or use the LoadBalancer IPs)
2. Apply the ingress:

```bash
kubectl apply -f k8s/observability-ingress.yaml
```

### Step 4: Configure Grafana Cloud

When adding data sources in Grafana Cloud, use:
- **URL**: Your Ingress domain (e.g., `http://prometheus.yourdomain.com`)
- **Basic Auth**: Enable and enter the username/password you created

## Alternative: Keep LoadBalancer + IP Whitelist

If you want to keep using LoadBalancer directly:

1. **Restrict by IP**: Configure firewall rules to only allow Grafana Cloud IPs
   - Grafana Cloud IP ranges: Check Grafana Cloud documentation for their IP ranges
   - DigitalOcean Firewall: Create firewall rules to restrict access

2. **Use Grafana Cloud's Private Network**: If available, use private networking

## Current Status

**No authentication is configured** - services are publicly accessible at:
- Prometheus: `http://188.166.135.203:9090`
- Loki: `http://161.35.244.183:3100`
- Tempo: `http://24.144.78.1:3200`

## Recommendation

For production, use **Option 1 (Basic Auth via Ingress)** as it's the simplest and most secure approach that works well with Grafana Cloud.


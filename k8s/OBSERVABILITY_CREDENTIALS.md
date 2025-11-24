# Observability Services - Authentication Credentials

## Basic Auth Credentials

**Username**: `observability`  
**Password**: See Kubernetes secret (not stored in this file for security)

⚠️ **Important**: The password is stored in the Kubernetes secret `observability-auth`. To retrieve it, check your password manager or recreate the secret.

To get the password hash from the secret:
```bash
kubectl get secret observability-auth -n observability -o jsonpath='{.data.auth}' | base64 -d
```

⚠️ **Security Note**: The password was set during initial setup. If you don't remember it, recreate the secret with a new password (see "Changing the Password" section below).

## Service URLs

The services are now accessible via Ingress with basic authentication:

| Service | URL | Port |
|---------|-----|------|
| **Prometheus** | `http://prometheus-observability.swipe.fish` | 80 |
| **Loki** | `http://loki-observability.swipe.fish` | 80 |
| **Tempo** | `http://tempo-observability.swipe.fish` | 80 |

## DNS Configuration

You need to add DNS A records pointing to your Ingress LoadBalancer IP:

```bash
# Get the Ingress IP
kubectl get ingress -n observability -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'

# Add DNS records:
# prometheus-observability.swipe.fish -> <INGRESS_IP>
# loki-observability.swipe.fish -> <INGRESS_IP>
# tempo-observability.swipe.fish -> <INGRESS_IP>
```

## Configuring Grafana Cloud

When adding data sources in Grafana Cloud:

1. **URL**: Use the Ingress URLs above (e.g., `http://prometheus-observability.swipe.fish`)
2. **Access**: Select "Server (default)"
3. **Basic Auth**: Enable
   - **User**: `observability`
   - **Password**: (Retrieve from your password manager or Kubernetes secret - see above)

## Changing the Password

To change the password:

```bash
# Generate new password hash
htpasswd -nb observability <new-password> | cut -d: -f2

# Or create new auth file
htpasswd -c /tmp/new-auth observability

# Update the secret
kubectl create secret generic observability-auth \
  --from-file=auth=/tmp/new-auth \
  -n observability \
  --dry-run=client -o yaml | kubectl apply -f -

# Restart ingress pods to pick up new secret (if needed)
kubectl rollout restart deployment -n ingress-nginx
```

## Testing Authentication

Test the authentication:

```bash
# Test Prometheus (replace PASSWORD with actual password)
curl -u observability:PASSWORD http://prometheus-observability.swipe.fish/-/healthy

# Test Loki
curl -u observability:PASSWORD http://loki-observability.swipe.fish/ready

# Test Tempo
curl -u observability:PASSWORD http://tempo-observability.swipe.fish/ready
```


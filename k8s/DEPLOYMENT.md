# Deployment Guide for swipe.fish

## Prerequisites

1. ✅ Kubernetes cluster on DigitalOcean (already set up)
2. ✅ Domain `swipe.fish` registered and DNS access
3. Docker images built and pushed to a registry
4. Ingress controller installed
5. SSL/TLS certificates configured

## Step-by-Step Deployment

### 1. Install Ingress Controller (if not already installed)

For DigitalOcean, you have two options:

#### Option A: DigitalOcean Load Balancer (Recommended)
DigitalOcean automatically provisions a Load Balancer when you create an Ingress. No manual installation needed.

#### Option B: NGINX Ingress Controller
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.2/deploy/static/provider/cloud/deploy.yaml
```

### 2. Set up SSL/TLS

#### Option A: DigitalOcean Managed Certificates (Easiest)
1. In DigitalOcean dashboard → Networking → Certificates → Create Certificate
2. Choose "Let's Encrypt" → Enter `swipe.fish` and `*.swipe.fish`
3. Note the certificate ID
4. Update `ingress.yaml` to use DO certificate annotation

#### Option B: cert-manager (More control)
```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.2/cert-manager.yaml

# Wait for cert-manager to be ready
kubectl wait --for=condition=ready pod -l app.kubernetes.io/instance=cert-manager -n cert-manager --timeout=300s

# Create ClusterIssuer for Let's Encrypt
kubectl apply -f cert-manager-issuer.yaml
```

### 3. Configure DNS

Point your domain to the Load Balancer IP:

1. **Get the Load Balancer IP** (after creating ingress):
   ```bash
   kubectl get ingress -n swipefish -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'
   ```

2. **Update DNS records** at your domain registrar:
   - Type: `A`
   - Name: `@` (or `swipe.fish`)
   - Value: `<Load Balancer IP>`
   - TTL: 300 (or default)

### 4. Build and Push Docker Images

#### Option A: DigitalOcean Container Registry
```bash
# Login to DO registry
doctl registry login

# Get your registry URL (format: registry.digitalocean.com/<registry-name>)
REGISTRY=$(doctl registry get --format Name | head -1)
REGISTRY_URL="registry.digitalocean.com/${REGISTRY}"

# Build and push backend
cd backend
docker build -t ${REGISTRY_URL}/swipefish-backend:latest .
docker push ${REGISTRY_URL}/swipefish-backend:latest

# Build and push frontend (with Socket.io URL)
cd ../frontend
docker build --build-arg VITE_SOCKET_URL=wss://swipe.fish -t ${REGISTRY_URL}/swipefish-frontend:latest .
docker push ${REGISTRY_URL}/swipefish-frontend:latest
```

#### Option B: Docker Hub
```bash
# Login to Docker Hub
docker login

# Build and push backend
cd backend
docker build -t your-dockerhub-username/swipefish-backend:latest .
docker push your-dockerhub-username/swipefish-backend:latest

# Build and push frontend
cd ../frontend
docker build --build-arg VITE_SOCKET_URL=wss://swipe.fish -t your-dockerhub-username/swipefish-frontend:latest .
docker push your-dockerhub-username/swipefish-frontend:latest
```

### 5. Update Deployment Files

Update the image names in:
- `k8s/backend-deployment.yaml` (line 23)
- `k8s/frontend-deployment.yaml` (line 23)

Replace `your-registry/swipefish-backend:latest` with your actual image name.

### 6. Create/Update Secrets

```bash
# Database URL (if using StatefulSet PostgreSQL)
kubectl create secret generic swipefish-secrets \
  --from-literal=DATABASE_URL='postgresql://swipefish:your-password@postgres.swipefish.svc.cluster.local:5432/swipefish' \
  --from-literal=POSTGRES_PASSWORD='your-secure-password' \
  -n swipefish \
  --dry-run=client -o yaml | kubectl apply -f -

# Or if using DigitalOcean Managed Database:
kubectl create secret generic swipefish-secrets \
  --from-literal=DATABASE_URL='postgresql://user:password@host:5432/swipefish' \
  -n swipefish \
  --dry-run=client -o yaml | kubectl apply -f -
```

### 7. Deploy to Kubernetes

```bash
# Apply namespace
kubectl apply -f k8s/namespace.yaml

# Apply ConfigMap
kubectl apply -f k8s/configmap.yaml

# Apply secrets (already created above)
# kubectl apply -f k8s/secrets.yaml  # If you have a secrets file

# Apply PostgreSQL (if using StatefulSet)
kubectl apply -f k8s/postgres-statefulset.yaml

# Wait for PostgreSQL to be ready
kubectl wait --for=condition=ready pod -l app=postgres -n swipefish --timeout=300s

# Apply backend
kubectl apply -f k8s/backend-deployment.yaml
kubectl apply -f k8s/backend-service.yaml

# Apply frontend
kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/frontend-service.yaml

# Apply ingress (this will create the Load Balancer)
kubectl apply -f k8s/ingress.yaml
```

### 8. Verify Deployment

```bash
# Check pods
kubectl get pods -n swipefish

# Check services
kubectl get svc -n swipefish

# Check ingress and get Load Balancer IP
kubectl get ingress -n swipefish

# View logs
kubectl logs -f deployment/backend -n swipefish
kubectl logs -f deployment/frontend -n swipefish
```

### 9. Update DNS (if not done in step 3)

After the ingress is created, get the Load Balancer IP and update your DNS:

```bash
# Get Load Balancer IP
kubectl get ingress swipefish-ingress -n swipefish -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

Update your DNS A record to point to this IP.

### 10. Test

1. Wait for DNS propagation (can take a few minutes)
2. Visit `https://swipe.fish` in your browser
3. Test creating and joining rooms
4. Verify WebSocket connections work (check browser console)

## Troubleshooting

### Ingress not getting an IP
- Check if ingress controller is installed
- For DO: Check Load Balancer in DO dashboard

### SSL certificate issues
- Verify DNS is pointing to Load Balancer IP
- Check cert-manager logs: `kubectl logs -n cert-manager -l app=cert-manager`
- For DO managed certs: Check certificate status in dashboard

### WebSocket not working
- Verify ingress annotations for WebSocket support
- Check backend logs for connection errors
- Verify `VITE_SOCKET_URL` in frontend ConfigMap matches your domain

### Database connection issues
- Verify secrets are correct: `kubectl get secret swipefish-secrets -n swipefish -o yaml`
- Check PostgreSQL pod logs: `kubectl logs -f statefulset/postgres -n swipefish`
- Verify network connectivity from backend to database


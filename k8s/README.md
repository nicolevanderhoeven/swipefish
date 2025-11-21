# Kubernetes Deployment Guide

## Prerequisites

1. Kubernetes cluster on DigitalOcean
2. `kubectl` configured to connect to your cluster
3. Docker images built and pushed to a registry
4. PostgreSQL database (DigitalOcean Managed Database recommended)

## Setup Steps

### 1. Create Namespace

```bash
kubectl apply -f namespace.yaml
```

### 2. Create Secrets

**Important**: Do NOT commit actual secrets to git. Create the secret manually:

```bash
kubectl create secret generic swipefish-secrets \
  --from-literal=DATABASE_URL='postgresql://user:password@host:5432/swipefish' \
  -n swipefish
```

If using PostgreSQL StatefulSet, also add:

```bash
kubectl create secret generic swipefish-secrets \
  --from-literal=DATABASE_URL='postgresql://swipefish:password@postgres:5432/swipefish' \
  --from-literal=POSTGRES_PASSWORD='your-secure-password' \
  -n swipefish
```

### 3. Update ConfigMap

Edit `configmap.yaml` and update:
- `VITE_SOCKET_URL` with your actual domain (e.g., `wss://swipefish.example.com`)

Apply the ConfigMap:

```bash
kubectl apply -f configmap.yaml
```

### 4. Update Deployment Images

Edit both `backend-deployment.yaml` and `frontend-deployment.yaml`:
- Replace `your-registry/swipefish-backend:latest` with your actual image
- Replace `your-registry/swipefish-frontend:latest` with your actual image

### 5. Update Ingress

Edit `ingress.yaml`:
- Replace `your-domain.com` with your actual domain
- Configure TLS/SSL certificates (cert-manager or DigitalOcean managed)

### 6. Deploy

```bash
# Apply all manifests
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
kubectl apply -f backend-deployment.yaml
kubectl apply -f frontend-deployment.yaml
kubectl apply -f ingress.yaml

# Optional: If using PostgreSQL in Kubernetes
kubectl apply -f postgres-statefulset.yaml
```

### 7. Verify Deployment

```bash
# Check pods
kubectl get pods -n swipefish

# Check services
kubectl get svc -n swipefish

# Check ingress
kubectl get ingress -n swipefish

# View logs
kubectl logs -f deployment/backend -n swipefish
kubectl logs -f deployment/frontend -n swipefish
```

### 8. Database Setup

If using DigitalOcean Managed Database:
1. Create database via DO dashboard
2. Configure firewall to allow access from Kubernetes cluster
3. Update `DATABASE_URL` in secrets

If using PostgreSQL StatefulSet:
1. Wait for StatefulSet to be ready
2. The database will be automatically created

## Environment Variables

### Backend
- `DATABASE_URL`: PostgreSQL connection string (from Secrets)
- `PORT`: Server port (from ConfigMap, default: 3000)
- `NODE_ENV`: Environment (from ConfigMap)
- `CORS_ORIGIN`: CORS allowed origin (from ConfigMap)

### Frontend
- `VITE_SOCKET_URL`: WebSocket server URL (from ConfigMap, injected at build time)

## Scaling

To scale the deployments:

```bash
kubectl scale deployment/backend --replicas=3 -n swipefish
kubectl scale deployment/frontend --replicas=3 -n swipefish
```

## Troubleshooting

### Pods not starting
```bash
kubectl describe pod <pod-name> -n swipefish
kubectl logs <pod-name> -n swipefish
```

### Database connection issues
- Verify DATABASE_URL in secrets
- Check database firewall rules
- Verify network connectivity from pods

### WebSocket not working
- Check ingress annotations for WebSocket support
- Verify backend service is accessible
- Check CORS configuration


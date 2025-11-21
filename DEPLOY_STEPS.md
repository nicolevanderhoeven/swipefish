# Deployment Steps for swipe.fish

## Prerequisites
- ✅ cert-manager installed
- ✅ nginx-ingress installed
- Docker Hub account
- Email address for Let's Encrypt

## Step-by-Step Instructions

### Step 1: Login to Docker Hub
```bash
docker login
```
Enter your Docker Hub username and password when prompted.

### Step 2: Set up cert-manager ClusterIssuer
Update `k8s/cert-manager-issuer.yaml` with your email, then:
```bash
kubectl apply -f k8s/cert-manager-issuer.yaml
```

### Step 3: Build and Push Backend Image
```bash
cd backend
docker build -t YOUR_DOCKERHUB_USERNAME/swipefish-backend:latest .
docker push YOUR_DOCKERHUB_USERNAME/swipefish-backend:latest
cd ..
```

### Step 4: Build and Push Frontend Image
```bash
cd frontend
docker build --build-arg VITE_SOCKET_URL=wss://swipe.fish -t YOUR_DOCKERHUB_USERNAME/swipefish-frontend:latest .
docker push YOUR_DOCKERHUB_USERNAME/swipefish-frontend:latest
cd ..
```

### Step 5: Update Deployment Files
Replace `YOUR_DOCKERHUB_USERNAME` in:
- `k8s/backend-deployment.yaml` (line 23)
- `k8s/frontend-deployment.yaml` (line 23)

### Step 6: Create Database Secret (if not already created)
```bash
kubectl create secret generic swipefish-secrets \
  --from-literal=DATABASE_URL='postgresql://swipefish:YOUR_PASSWORD@postgres.swipefish.svc.cluster.local:5432/swipefish' \
  --from-literal=POSTGRES_PASSWORD='YOUR_PASSWORD' \
  -n swipefish
```

### Step 7: Deploy to Kubernetes
```bash
# Apply namespace
kubectl apply -f k8s/namespace.yaml

# Apply ConfigMap
kubectl apply -f k8s/configmap.yaml

# Deploy PostgreSQL
kubectl apply -f k8s/postgres-statefulset.yaml

# Wait for PostgreSQL to be ready
kubectl wait --for=condition=ready pod -l app=postgres -n swipefish --timeout=300s

# Deploy backend
kubectl apply -f k8s/backend-deployment.yaml
kubectl apply -f k8s/backend-service.yaml

# Deploy frontend
kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/frontend-service.yaml

# Deploy ingress
kubectl apply -f k8s/ingress.yaml
```

### Step 8: Get Load Balancer IP and Update DNS
```bash
# Get the Load Balancer IP
kubectl get ingress -n swipefish
```

Then update your DNS:
- Go to your domain registrar for `swipe.fish`
- Create an A record pointing to the Load Balancer IP
- Wait 5-10 minutes for DNS propagation

### Step 9: Verify
- Check certificate status: `kubectl get certificate -n swipefish`
- Visit https://swipe.fish
- Test creating and joining rooms


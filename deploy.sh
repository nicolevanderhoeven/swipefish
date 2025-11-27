#!/bin/bash
set -e

# Configuration - UPDATE THESE VALUES
DOCKER_HUB_USERNAME="nvanderhoeven"  # UPDATE THIS
EMAIL="nicole@nicolevanderhoeven.com"  # UPDATE THIS

echo "🚀 Starting deployment to swipe.fish"
echo ""

# Step 1: Login to Docker Hub
echo "📦 Step 1: Logging into Docker Hub..."
if ! docker info | grep -q "Username"; then
    echo "Please login to Docker Hub:"
    docker login
else
    echo "Already logged into Docker Hub"
fi

# Step 2: Update cert-manager issuer with email
echo ""
echo "🔐 Step 2: Setting up cert-manager ClusterIssuer..."
sed "s/your-email@example.com/${EMAIL}/g" k8s/cert-manager-issuer.yaml > k8s/cert-manager-issuer-updated.yaml
kubectl apply -f k8s/cert-manager-issuer-updated.yaml

# Step 3: Build and push backend image
echo ""
echo "🏗️  Step 3: Building backend Docker image..."
cd backend
docker build --platform=linux/amd64 -t ${DOCKER_HUB_USERNAME}/swipefish-backend:latest .
echo "📤 Pushing backend image to Docker Hub..."
docker push ${DOCKER_HUB_USERNAME}/swipefish-backend:latest
cd ..

# Step 4: Build and push frontend image
echo ""
echo "🏗️  Step 4: Building frontend Docker image..."
cd frontend
docker build --platform=linux/amd64 --build-arg VITE_SOCKET_URL=wss://swipe.fish -t ${DOCKER_HUB_USERNAME}/swipefish-frontend:latest .
echo "📤 Pushing frontend image to Docker Hub..."
docker push ${DOCKER_HUB_USERNAME}/swipefish-frontend:latest
cd ..

# Step 5: Update deployment files with Docker Hub images
echo ""
echo "📝 Step 5: Updating Kubernetes deployment files..."
sed -i.bak "s|your-registry/swipefish-backend:latest|${DOCKER_HUB_USERNAME}/swipefish-backend:latest|g" k8s/backend-deployment.yaml
sed -i.bak "s|your-registry/swipefish-frontend:latest|${DOCKER_HUB_USERNAME}/swipefish-frontend:latest|g" k8s/frontend-deployment.yaml

# Step 6: Deploy to Kubernetes
echo ""
echo "☸️  Step 6: Deploying to Kubernetes..."
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml

# Check if secrets exist, if not prompt to create them
if ! kubectl get secret swipefish-secrets -n swipefish &>/dev/null; then
    echo ""
    echo "⚠️  WARNING: Database secrets not found!"
    echo "Please create the secret first:"
    echo "kubectl create secret generic swipefish-secrets \\"
    echo "  --from-literal=DATABASE_URL='postgresql://swipefish:password@postgres.swipefish.svc.cluster.local:5432/swipefish' \\"
    echo "  --from-literal=POSTGRES_PASSWORD='your-secure-password' \\"
    echo "  -n swipefish"
    echo ""
    read -p "Press Enter after creating the secret..."
fi

# Deploy PostgreSQL (if using StatefulSet)
echo "Deploying PostgreSQL..."
kubectl apply -f k8s/postgres-statefulset.yaml

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
kubectl wait --for=condition=ready pod -l app=postgres -n swipefish --timeout=300s || echo "PostgreSQL not ready yet, continuing..."

# Deploy backend (includes service)
echo "Deploying backend..."
kubectl apply -f k8s/backend-deployment.yaml

# Deploy frontend (includes service)
echo "Deploying frontend..."
kubectl apply -f k8s/frontend-deployment.yaml

# Deploy ingress
echo "Deploying ingress..."
kubectl apply -f k8s/ingress.yaml

# Get Load Balancer IP
echo ""
echo "✅ Deployment complete!"
echo ""
echo "📋 Next steps:"
echo "1. Get the Load Balancer IP:"
echo "   kubectl get ingress -n swipefish"
echo ""
echo "2. Update your DNS:"
echo "   - Go to your domain registrar"
echo "   - Create an A record for swipe.fish"
echo "   - Point it to the Load Balancer IP from step 1"
echo ""
echo "3. Wait for DNS propagation (5-10 minutes)"
echo ""
echo "4. Check certificate status:"
echo "   kubectl get certificate -n swipefish"
echo ""
echo "5. Test your site: https://swipe.fish"


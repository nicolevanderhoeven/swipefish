# Swipefish Web App Implementation Plan

## Architecture Overview

- **Backend**: Node.js + Express + Socket.io + PostgreSQL (containerized, deployed on Kubernetes)
- **Frontend**: React + TypeScript + Vite (containerized with nginx, deployed on Kubernetes)
- **Real-time**: WebSocket connections via Socket.io
- **Database**: PostgreSQL (DigitalOcean Managed Database or StatefulSet in K8s)
- **Deployment**: Kubernetes cluster on DigitalOcean

## Project Structure

```
swipefish/
├── backend/           # Node.js + Socket.io server
│   ├── src/
│   │   ├── server.ts      # Express + Socket.io setup
│   │   ├── db.ts          # PostgreSQL connection & queries
│   │   ├── rooms.ts       # Room management logic
│   │   ├── passphrase.ts  # Fantasy word passphrase generator
│   │   └── types.ts       # TypeScript types
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json
│   └── tsconfig.json
├── frontend/          # React + TypeScript app
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── LandingPage.tsx    # Create/Join room buttons
│   │   │   ├── CreateRoom.tsx     # Room creation flow
│   │   │   └── Room.tsx           # Room view with player list
│   │   ├── components/
│   │   │   └── PlayerList.tsx     # Real-time player list
│   │   ├── hooks/
│   │   │   └── useSocket.ts       # Socket.io connection hook
│   │   └── types.ts
│   ├── Dockerfile                 # Multi-stage: build React, serve with nginx
│   ├── nginx.conf                 # nginx config for SPA
│   ├── .dockerignore
│   ├── package.json
│   └── vite.config.ts
├── k8s/               # Kubernetes manifests
│   ├── namespace.yaml             # Optional: namespace for app
│   ├── backend-deployment.yaml    # Backend Deployment + Service
│   ├── frontend-deployment.yaml   # Frontend Deployment + Service
│   ├── ingress.yaml               # Ingress with WebSocket support
│   ├── configmap.yaml             # Non-sensitive config
│   ├── secrets.yaml               # Sensitive data (template)
│   └── postgres-statefulset.yaml  # Optional: PostgreSQL in K8s
└── README.md
```

## Implementation Steps

### Backend Setup

1. **Initialize backend project**
   - Set up Node.js + TypeScript project
   - Install dependencies: `express`, `socket.io`, `pg`, `dotenv`
   - Configure TypeScript and build scripts

2. **Database schema**
   - Create `rooms` table: `id`, `passphrase`, `created_at`, `status`
   - Create `players` table: `id`, `room_id`, `name`, `socket_id`, `joined_at`
   - Set up PostgreSQL connection pool

3. **Passphrase generator**
   - Create fantasy-themed adjective and noun word lists
   - Generate unique `adjective-noun` combinations
   - Check uniqueness against database before assigning

4. **Socket.io server**
   - Set up Express server with Socket.io
   - Handle connection/disconnection
   - Room management events:
     - `create-room` → generate passphrase, create room in DB
     - `join-room` → validate passphrase, add player to room
     - `player-joined` → broadcast to all players in room
     - `player-left` → remove player, cleanup if room empty

5. **Room state management**
   - In-memory room state for active rooms
   - Sync with PostgreSQL for persistence
   - Handle room cleanup when empty

### Frontend Setup

1. **Initialize frontend project**
   - Set up React + TypeScript + Vite
   - Install dependencies: `react`, `react-dom`, `socket.io-client`
   - Configure Vite for production builds

2. **Landing page**
   - Create `LandingPage` component with two buttons:
     - "Create Room" → navigate to create flow
     - "Join Room" → show input for passphrase

3. **Socket connection hook**
   - Create `useSocket` hook to manage Socket.io connection
   - Handle connection state and reconnection logic
   - Provide socket instance to components

4. **Create room flow**
   - Connect to socket
   - Emit `create-room` event
   - Receive passphrase from server
   - Display passphrase to user
   - Navigate to room view

5. **Join room flow**
   - Show input field for passphrase
   - Validate format (adjective-noun)
   - Emit `join-room` event with passphrase
   - Handle success/error responses
   - Navigate to room view on success

6. **Room view**
   - Display room passphrase
   - Show real-time player list (using `PlayerList` component)
   - Listen for `player-joined` and `player-left` events
   - Update UI when players join/leave

7. **Mobile optimization**
   - Responsive design with mobile-first approach
   - Touch-friendly buttons and inputs
   - Optimize for small screens

### Containerization

1. **Backend Dockerfile**
   - Multi-stage build: install dependencies, build TypeScript, run server
   - Expose port 3000 (or configurable)
   - Set up health check endpoint
   - Use Node.js alpine image for smaller size

2. **Frontend Dockerfile**
   - Stage 1: Build React app with Vite
   - Stage 2: Serve with nginx
   - Configure nginx for SPA routing
   - Set up proper caching headers
   - Inject environment variables at build time

3. **Docker images**
   - Build and test images locally
   - Push to Docker Hub or DigitalOcean Container Registry
   - Tag images with versions

### Kubernetes Deployment

1. **DigitalOcean Kubernetes Cluster Setup**
   - Create DigitalOcean account (if needed)
   - Create Kubernetes cluster via DO dashboard or `doctl` CLI
   - Minimum: 2 nodes, 2GB RAM each (for development)
   - Configure `kubectl` to connect to cluster
   - Verify cluster connection with `kubectl get nodes`

2. **PostgreSQL Database**
   - **Option A (Recommended)**: DigitalOcean Managed Database
     - Create PostgreSQL database via DO dashboard
     - Get connection string
     - Configure firewall rules to allow K8s cluster access
   - **Option B**: PostgreSQL StatefulSet in Kubernetes
     - Deploy PostgreSQL using StatefulSet
     - Set up PersistentVolumeClaims for data
     - Configure backups

3. **Kubernetes Manifests**
   - **Namespace**: Create `swipefish` namespace (optional but recommended)
   - **Backend Deployment**: 
     - Socket.io server with health checks
     - Environment variables from ConfigMap/Secrets
     - Resource limits and requests
   - **Backend Service**: 
     - ClusterIP service for internal communication
     - Or LoadBalancer if direct WebSocket access needed
   - **Frontend Deployment**: 
     - nginx serving React static files
     - Environment variables for API endpoint
   - **Frontend Service**: ClusterIP service
   - **Ingress**: 
     - Route external traffic to frontend
     - WebSocket upgrade support for backend
     - SSL/TLS termination
   - **ConfigMap**: 
     - Non-sensitive configuration (ports, CORS origins, etc.)
   - **Secrets**: 
     - Database connection string
     - Other sensitive data
     - Use `kubectl create secret` (not committed to git)

4. **Ingress Configuration**
   - Set up DigitalOcean Load Balancer via Ingress
   - Configure WebSocket support (upgrade headers)
   - SSL/TLS: Use cert-manager with Let's Encrypt, or DO managed certificates
   - Route `/` to frontend, `/socket.io/` to backend

5. **Deployment Process**
   - Apply manifests: `kubectl apply -f k8s/`
   - Verify pods: `kubectl get pods -n swipefish`
   - Check services: `kubectl get svc -n swipefish`
   - View logs: `kubectl logs -f deployment/backend -n swipefish`
   - Test WebSocket connections through ingress

6. **Environment Configuration**
   - Backend: DATABASE_URL, PORT, CORS origins via ConfigMap/Secrets
   - Frontend: Socket.io server URL via ConfigMap (injected at build time)
   - Use ConfigMap for non-sensitive, Secrets for sensitive data

## Key Files to Create

### Backend
- `backend/src/passphrase.ts` - Fantasy word lists and generation logic
- `backend/src/db.ts` - PostgreSQL queries for rooms and players
- `backend/src/server.ts` - Main Socket.io server setup
- `backend/Dockerfile` - Container image for backend
- `backend/.dockerignore` - Docker ignore patterns

### Frontend
- `frontend/src/pages/LandingPage.tsx` - Initial landing page
- `frontend/src/hooks/useSocket.ts` - Socket connection management
- `frontend/src/pages/Room.tsx` - Room view with real-time updates
- `frontend/Dockerfile` - Multi-stage build (build React, serve with nginx)
- `frontend/nginx.conf` - nginx configuration for React SPA
- `frontend/.dockerignore` - Docker ignore patterns

### Kubernetes
- `k8s/namespace.yaml` - Optional namespace for organization
- `k8s/backend-deployment.yaml` - Backend Deployment and Service
- `k8s/frontend-deployment.yaml` - Frontend Deployment and Service
- `k8s/ingress.yaml` - Ingress configuration with WebSocket support
- `k8s/configmap.yaml` - Non-sensitive configuration
- `k8s/secrets.yaml` - Sensitive data (template, not committed)
- `k8s/postgres-statefulset.yaml` - Optional PostgreSQL in K8s

## Fantasy Passphrase Format

- Format: `adjective-noun` (e.g., "mystical-dragon", "ancient-wizard")
- Word lists: Fantasy-themed adjectives and nouns
- Uniqueness: Check against database before assignment
- Display: Show to user after room creation

## DigitalOcean Kubernetes Cluster Setup Guide

1. **Create DigitalOcean Account** (if needed)
   - Sign up at digitalocean.com
   - Add payment method

2. **Install doctl CLI** (optional, for command-line setup)
   ```bash
   # macOS
   brew install doctl
   doctl auth init
   ```

3. **Create Kubernetes Cluster via Dashboard**
   - Go to DigitalOcean dashboard → Kubernetes → Create Cluster
   - Choose datacenter region
   - Select node pool: 2 nodes, 2GB RAM, $12/month each (minimum for development)
   - Choose Kubernetes version (latest stable)
   - Name cluster (e.g., "swipefish-cluster")
   - Click "Create Cluster"
   - Wait 5-10 minutes for cluster creation

4. **Connect kubectl to Cluster**
   - In DO dashboard, click "Download Config File" or "Show Config"
   - Copy the kubeconfig YAML
   - Save to `~/.kube/config` or merge with existing config
   - Or use: `doctl kubernetes cluster kubeconfig save <cluster-name>`
   - Verify: `kubectl get nodes`

5. **Set up Container Registry** (optional, for storing images)
   - DO dashboard → Container Registry → Create
   - Or use Docker Hub (public/private)
   - Authenticate: `doctl registry login`

6. **Create Managed PostgreSQL Database** (recommended)
   - DO dashboard → Databases → Create Database
   - Choose PostgreSQL, select same region as K8s cluster
   - Choose plan (Basic $15/month minimum)
   - Configure firewall: Allow access from Kubernetes cluster
   - Save connection string for Secrets

7. **Deploy Application**
   - Build and push Docker images
   - Apply Kubernetes manifests
   - Configure ingress and SSL
   - Test WebSocket connections


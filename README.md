# Swipefish

A real-time multiplayer social deduction game for 3-7 players, inspired by Apples to Apples and Cards Against Humanity, themed around online dating.

## Architecture

- **Backend**: Node.js + Express + Socket.io + PostgreSQL
- **Frontend**: React + TypeScript + Vite
- **Deployment**: Kubernetes on DigitalOcean
- **Real-time**: WebSocket connections via Socket.io

## Features

- Create rooms with unique fantasy-themed passphrases (adjective-noun format)
- Join rooms using passphrases
- Real-time player synchronization
- Mobile-optimized UI
- Room management with automatic cleanup

## Project Structure

```
swipefish/
├── backend/          # Node.js + Socket.io server
├── frontend/         # React + TypeScript app
├── k8s/             # Kubernetes manifests
└── game-rules.md    # Game rules documentation
```

## Local Development

### Prerequisites

- Node.js 20+
- PostgreSQL database
- Docker (for containerization)

### Backend Setup

```bash
cd backend
npm install
npm run build
```

Create a `.env` file:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/swipefish
PORT=3000
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
```

Run the backend:

```bash
npm run dev
```

### Frontend Setup

```bash
cd frontend
npm install
```

Create a `.env` file:

```env
VITE_SOCKET_URL=http://localhost:3000
```

Run the frontend:

```bash
npm run dev
```

The frontend will be available at `http://localhost:5173`

### Database Setup

Create a PostgreSQL database:

```sql
CREATE DATABASE swipefish;
```

The backend will automatically create the required tables on first run.

## Building Docker Images

### Backend

```bash
cd backend
docker build -t swipefish-backend:latest .
```

### Frontend

```bash
cd frontend
docker build --build-arg VITE_SOCKET_URL=wss://your-domain.com -t swipefish-frontend:latest .
```

## Kubernetes Deployment

See [k8s/README.md](k8s/README.md) for detailed deployment instructions.

### Quick Start

1. Create DigitalOcean Kubernetes cluster
2. Configure `kubectl` to connect to cluster
3. Create secrets: `kubectl create secret generic swipefish-secrets --from-literal=DATABASE_URL='...' -n swipefish`
4. Update ConfigMap with your domain
5. Update deployment images with your registry
6. Apply manifests: `kubectl apply -f k8s/`

## Environment Variables

### Backend

- `DATABASE_URL`: PostgreSQL connection string
- `PORT`: Server port (default: 3000)
- `CORS_ORIGIN`: Allowed CORS origin
- `NODE_ENV`: Environment (development/production)

### Frontend

- `VITE_SOCKET_URL`: WebSocket server URL (injected at build time)

## Game Rules

See [game-rules.md](game-rules.md) for complete game rules.

## License

ISC

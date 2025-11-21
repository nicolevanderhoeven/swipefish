import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  error: string | null;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  error: null,
});

let socketInstance: Socket | null = null;

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Create singleton socket instance
    if (!socketInstance) {
      socketInstance = io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      socketInstance.on('connect', () => {
        console.log('Connected to server');
        setIsConnected(true);
        setError(null);
      });

      socketInstance.on('disconnect', (reason) => {
        console.log('Disconnected from server:', reason);
        setIsConnected(false);
        
        if (reason === 'io server disconnect') {
          socketInstance?.connect();
        }
      });

      socketInstance.on('connect_error', (err) => {
        console.error('Connection error:', err);
        setError('Failed to connect to server. Please refresh the page.');
      });

      setSocket(socketInstance);
    } else {
      // Socket already exists, just set it
      setSocket(socketInstance);
      setIsConnected(socketInstance.connected);
    }

    // Don't close socket on unmount - keep it alive
    return () => {
      // Only close if this is the last component using it
      // For now, we'll keep it alive for the app lifetime
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected, error }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within SocketProvider');
  }
  return context;
}


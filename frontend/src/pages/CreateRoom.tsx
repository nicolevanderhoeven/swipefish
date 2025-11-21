import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../contexts/SocketContext';
import { Logo } from '../components/Logo';
import { CreateRoomResponse } from '../types';
import { getPlayerName } from '../utils/playerName';
import './CreateRoom.css';

export function CreateRoom() {
  const { socket, isConnected, error: socketError } = useSocket();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleCreateRoomResponse = (response: CreateRoomResponse) => {
      setLoading(false);
      if (response.success && response.passphrase) {
        // Small delay to ensure backend has processed everything
        setTimeout(() => {
          navigate(`/room/${response.passphrase}`);
        }, 100);
      } else {
        setError(response.error || 'Failed to create room');
      }
    };

    socket.on('create-room-response', handleCreateRoomResponse);

    // Automatically create room when component mounts and socket is connected
    if (socket && isConnected && !loading && !error) {
      setLoading(true);
      const playerName = getPlayerName();
      socket.emit('create-room', {
        name: playerName.trim() || undefined,
      });
    }

    return () => {
      socket.off('create-room-response', handleCreateRoomResponse);
    };
  }, [socket, isConnected, navigate, loading, error]);

  if (socketError) {
    return (
      <div className="create-room-page">
        <Logo />
        <div className="create-room-content">
          <h1>Connection Error</h1>
          <p>{socketError}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="create-room-page">
      <Logo />
      <div className="create-room-content">
        <h1>Creating Room...</h1>
        {error && (
          <>
            <div className="error-message">{error}</div>
            <button
              className="back-button"
              onClick={() => navigate('/')}
            >
              Go Back
            </button>
          </>
        )}
        {!error && <p>Please wait while we create your room...</p>}
      </div>
    </div>
  );
}


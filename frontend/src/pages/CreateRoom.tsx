import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket';
import { CreateRoomResponse } from '../types';
import './CreateRoom.css';

export function CreateRoom() {
  const { socket, isConnected, error: socketError } = useSocket();
  const [loading, setLoading] = useState(false);
  const [passphrase, setPassphrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleCreateRoomResponse = (response: CreateRoomResponse) => {
      setLoading(false);
      if (response.success && response.passphrase) {
        setPassphrase(response.passphrase);
        // Navigate to room after a short delay
        setTimeout(() => {
          navigate(`/room/${response.passphrase}`);
        }, 2000);
      } else {
        setError(response.error || 'Failed to create room');
      }
    };

    socket.on('create-room-response', handleCreateRoomResponse);

    return () => {
      socket.off('create-room-response', handleCreateRoomResponse);
    };
  }, [socket, isConnected, navigate]);

  const handleCreateRoom = () => {
    if (!socket || !isConnected) {
      setError('Not connected to server');
      return;
    }

    setLoading(true);
    setError(null);
    socket.emit('create-room');
  };

  if (socketError) {
    return (
      <div className="create-room-page">
        <div className="create-room-content">
          <h1>Connection Error</h1>
          <p>{socketError}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  if (passphrase) {
    return (
      <div className="create-room-page">
        <div className="create-room-content">
          <h1>Room Created!</h1>
          <div className="passphrase-display">
            <p className="passphrase-label">Share this passphrase:</p>
            <p className="passphrase-value">{passphrase}</p>
          </div>
          <p className="redirect-message">Redirecting to room...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="create-room-page">
      <div className="create-room-content">
        <h1>Create Room</h1>
        {error && <div className="error-message">{error}</div>}
        <button
          className="create-button"
          onClick={handleCreateRoom}
          disabled={loading || !isConnected}
        >
          {loading ? 'Creating...' : 'Create Room'}
        </button>
        <button
          className="back-button"
          onClick={() => navigate('/')}
        >
          Back
        </button>
      </div>
    </div>
  );
}


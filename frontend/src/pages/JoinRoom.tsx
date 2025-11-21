import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../contexts/SocketContext';
import { Logo } from '../components/Logo';
import { JoinRoomResponse } from '../types';
import { getPlayerName } from '../utils/playerName';
import './JoinRoom.css';

export function JoinRoom() {
  const { socket, isConnected, error: socketError } = useSocket();
  const [passphrase, setPassphrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleJoinRoomResponse = (response: JoinRoomResponse) => {
      setLoading(false);
      if (response.success && response.room) {
        navigate(`/room/${response.room.room.passphrase}`);
      } else {
        setError(response.error || 'Failed to join room');
      }
    };

    socket.on('join-room-response', handleJoinRoomResponse);

    return () => {
      socket.off('join-room-response', handleJoinRoomResponse);
    };
  }, [socket, isConnected, navigate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!socket || !isConnected) {
      setError('Not connected to server');
      return;
    }

    const trimmedPassphrase = passphrase.trim();
    if (!trimmedPassphrase) {
      setError('Passphrase is required');
      return;
    }

    setLoading(true);
    setError(null);
    const playerName = getPlayerName();
    socket.emit('join-room', {
      passphrase: trimmedPassphrase,
      name: playerName.trim() || undefined,
    });
  };

  if (socketError) {
    return (
      <div className="join-room-page">
        <Logo />
        <div className="join-room-content">
          <h1>Connection Error</h1>
          <p>{socketError}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="join-room-page">
      <Logo />
      <div className="join-room-content">
        <h1>Join Room</h1>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="passphrase">Room Passphrase</label>
            <input
              id="passphrase"
              type="text"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="e.g., mystical-dragon"
              disabled={loading}
              autoComplete="off"
              autoFocus
            />
          </div>
          {error && <div className="error-message">{error}</div>}
          <button
            type="submit"
            className="join-button"
            disabled={loading || !isConnected || !passphrase.trim()}
          >
            {loading ? 'Joining...' : 'Join Room'}
          </button>
        </form>
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


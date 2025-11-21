import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket';
import { PlayerList } from '../components/PlayerList';
import { RoomState, PlayerJoinedEvent, PlayerLeftEvent, JoinRoomResponse } from '../types';
import './Room.css';

export function Room() {
  const { passphrase } = useParams<{ passphrase: string }>();
  const { socket, isConnected, error: socketError } = useSocket();
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!socket || !isConnected || !passphrase) return;

    // Join the room
    socket.emit('join-room', { passphrase });

    const handleJoinRoomResponse = (response: JoinRoomResponse) => {
      if (response.success && response.room) {
        setRoomState(response.room);
        setError(null);
      } else {
        setError(response.error || 'Failed to join room');
      }
    };

    const handlePlayerJoined = (event: PlayerJoinedEvent) => {
      setRoomState(event.room);
    };

    const handlePlayerLeft = (event: PlayerLeftEvent) => {
      setRoomState(event.room);
    };

    socket.on('join-room-response', handleJoinRoomResponse);
    socket.on('player-joined', handlePlayerJoined);
    socket.on('player-left', handlePlayerLeft);

    return () => {
      socket.off('join-room-response', handleJoinRoomResponse);
      socket.off('player-joined', handlePlayerJoined);
      socket.off('player-left', handlePlayerLeft);
    };
  }, [socket, isConnected, passphrase]);

  if (socketError) {
    return (
      <div className="room-page">
        <div className="room-content">
          <h1>Connection Error</h1>
          <p>{socketError}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  if (error && !roomState) {
    return (
      <div className="room-page">
        <div className="room-content">
          <h1>Error</h1>
          <p>{error}</p>
          <button onClick={() => navigate('/')}>Go Home</button>
        </div>
      </div>
    );
  }

  if (!roomState) {
    return (
      <div className="room-page">
        <div className="room-content">
          <p>Loading room...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="room-page">
      <div className="room-content">
        <h1 className="room-title">Room: {roomState.room.passphrase}</h1>
        
        {error && <div className="error-message">{error}</div>}
        
        <PlayerList
          players={roomState.players}
          currentSocketId={socket?.id}
        />
        
        <div className="room-actions">
          <button
            className="back-button"
            onClick={() => navigate('/')}
          >
            Leave Room
          </button>
        </div>
      </div>
    </div>
  );
}


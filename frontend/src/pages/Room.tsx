import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../contexts/SocketContext';
import { Logo } from '../components/Logo';
import { PlayerList } from '../components/PlayerList';
import { RoomState, PlayerJoinedEvent, PlayerLeftEvent, JoinRoomResponse } from '../types';
import { getPlayerName } from '../utils/playerName';
import './Room.css';

export function Room() {
  const { passphrase } = useParams<{ passphrase: string }>();
  const { socket, isConnected, error: socketError } = useSocket();
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!socket || !isConnected || !passphrase) return;

    let hasJoined = false;

    const handleJoinRoomResponse = (response: JoinRoomResponse) => {
      hasJoined = true;
      if (response.success && response.room) {
        setRoomState(response.room);
        setError(null);
      } else {
        setError(response.error || 'Failed to join room');
      }
    };

    const handlePlayerJoined = (event: PlayerJoinedEvent) => {
      console.log('Room component: Received player-joined event', event);
      setRoomState(event.room);
    };

    const handlePlayerLeft = (event: PlayerLeftEvent) => {
      setRoomState(event.room);
    };

    socket.on('join-room-response', handleJoinRoomResponse);
    socket.on('player-joined', handlePlayerJoined);
    socket.on('player-left', handlePlayerLeft);

    // Always join the room (with a small delay to ensure socket is ready)
    // This ensures the socket is in the socket.io room to receive broadcasts
    // Even if the player already created the room, we need to rejoin to ensure
    // we're in the socket.io room for receiving player-joined/player-left events
    const joinTimeout = setTimeout(() => {
      if (!hasJoined) {
        console.log(`Room component: Joining room with passphrase ${passphrase}`);
        const playerName = getPlayerName();
        socket.emit('join-room', {
          passphrase,
          name: playerName.trim() || undefined,
        });
      } else {
        // Even if we've already joined, we should rejoin to ensure socket.io room membership
        // This is safe because the backend handles duplicate joins gracefully
        console.log(`Room component: Rejoining room to ensure socket.io room membership`);
        const playerName = getPlayerName();
        socket.emit('join-room', {
          passphrase,
          name: playerName.trim() || undefined,
        });
      }
    }, 100);

    return () => {
      clearTimeout(joinTimeout);
      socket.off('join-room-response', handleJoinRoomResponse);
      socket.off('player-joined', handlePlayerJoined);
      socket.off('player-left', handlePlayerLeft);
    };
  }, [socket, isConnected, passphrase]);

  const handleLeaveRoom = () => {
    if (socket) {
      socket.emit('leave-room');
    }
    navigate('/');
  };

  if (socketError) {
    return (
      <div className="room-page">
        <Logo onLeaveRoom={handleLeaveRoom} />
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
        <Logo onLeaveRoom={handleLeaveRoom} />
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
        <Logo onLeaveRoom={handleLeaveRoom} />
        <div className="room-content">
          <p>Loading room...</p>
        </div>
      </div>
    );
  }

  const copyPassphrase = () => {
    if (roomState?.room.passphrase) {
      navigator.clipboard.writeText(roomState.room.passphrase);
      // You could add a toast notification here if desired
    }
  };

  return (
    <div className="room-page">
      <Logo onLeaveRoom={handleLeaveRoom} />
      <div className="room-content">
        <h1 className="room-title">Room</h1>
        
        <div className="passphrase-section">
          <p className="passphrase-label">Room Passphrase (share this to invite players):</p>
          <div className="passphrase-container">
            <p className="passphrase-value">{roomState.room.passphrase}</p>
            <button className="copy-button" onClick={copyPassphrase} title="Copy to clipboard">
              📋
            </button>
          </div>
        </div>
        
        {error && <div className="error-message">{error}</div>}
        
        <PlayerList
          players={roomState.players}
          currentSocketId={socket?.id}
        />
        
        <div className="room-actions">
          <button
            className="back-button"
            onClick={() => {
              // Emit leave-room event before navigating
              if (socket) {
                socket.emit('leave-room');
              }
              navigate('/');
            }}
          >
            Leave Room
          </button>
        </div>
      </div>
    </div>
  );
}


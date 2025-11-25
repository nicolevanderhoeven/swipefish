import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../contexts/SocketContext';
import { Logo } from '../components/Logo';
import { PlayerList } from '../components/PlayerList';
import { RoomState, PlayerJoinedEvent, PlayerLeftEvent, JoinRoomResponse, RoomStateSyncResponse, GameStartedEvent, StartGameResponse, RoleAssignmentEvent, PlayerRole } from '../types';
import { getPlayerName } from '../utils/playerName';
import './Room.css';

export function Room() {
  const { passphrase } = useParams<{ passphrase: string }>();
  const { socket, isConnected, error: socketError } = useSocket();
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [playerRole, setPlayerRole] = useState<PlayerRole | null>(null);
  const navigate = useNavigate();

  // Use useCallback to stabilize handler functions so they can be properly removed
  const handleJoinRoomResponse = useCallback((response: JoinRoomResponse) => {
    if (response.success && response.room) {
      console.log('Room component: Updating room state from join-room-response', response.room);
      setRoomState(response.room);
      setError(null);
    } else {
      setError(response.error || 'Failed to join room');
    }
  }, []);

  const handlePlayerJoined = useCallback((event: PlayerJoinedEvent) => {
    console.log('Room component: Received player-joined event', event);
    console.log('Room component: Event room state:', event.room);
    console.log('Room component: Players in event:', event.room.players);
    // Use functional update to ensure React detects the change
    setRoomState((prevState) => {
      // Always update to the new state from the event
      // This ensures React detects the change even if the object reference is similar
      console.log('Room component: Previous state players:', prevState?.players.length || 0);
      console.log('Room component: New state players:', event.room.players.length);
      return event.room;
    });
  }, []);

  const handlePlayerLeft = useCallback((event: PlayerLeftEvent) => {
    console.log('Room component: Received player-left event', event);
    // Use functional update to ensure React detects the change
    setRoomState((prevState) => {
      console.log('Room component: Previous state players:', prevState?.players.length || 0);
      console.log('Room component: New state players:', event.room.players.length);
      return event.room;
    });
  }, []);

  const handleRoomStateSync = useCallback((response: RoomStateSyncResponse) => {
    if (response.success && response.room) {
      const syncedRoom = response.room; // Capture in local variable for type narrowing
      console.log('Room component: Received room-state-sync', syncedRoom);
      setRoomState((prevState) => {
        // Only update if the state actually changed (different player count or different player IDs)
        const prevPlayerIds = prevState?.players.map(p => p.id).sort().join(',') || '';
        const newPlayerIds = syncedRoom.players.map(p => p.id).sort().join(',');
        if (prevPlayerIds !== newPlayerIds || (prevState?.players.length ?? 0) !== syncedRoom.players.length) {
          console.log('Room component: Room state changed, updating from sync');
          return syncedRoom;
        }
        return prevState;
      });
    } else {
      console.log('Room component: Room state sync failed', response.error);
    }
  }, []);

  const handleGameStarted = useCallback((event: GameStartedEvent) => {
    console.log('Room component: Received game-started event', event);
    setRoomState(event.room);
    setIsStartingGame(false);
    setError(null);
  }, []);

  const handleStartGameResponse = useCallback((response: StartGameResponse) => {
    if (response.success && response.room) {
      console.log('Room component: Start game successful', response.room);
      setRoomState(response.room);
      setIsStartingGame(false);
      setError(null);
    } else {
      console.log('Room component: Start game failed', response.error);
      setError(response.error || 'Failed to start game');
      setIsStartingGame(false);
    }
  }, []);

  const handleRoleAssigned = useCallback((event: RoleAssignmentEvent) => {
    console.log('Room component: Received role assignment', event.role);
    setPlayerRole(event.role);
  }, []);

  useEffect(() => {
    if (!socket || !isConnected || !passphrase) return;

    // Set up event listeners FIRST, before joining, to ensure we don't miss any events
    socket.on('join-room-response', handleJoinRoomResponse);
    socket.on('player-joined', handlePlayerJoined);
    socket.on('player-left', handlePlayerLeft);
    socket.on('room-state-sync', handleRoomStateSync);
    socket.on('game-started', handleGameStarted);
    socket.on('start-game-response', handleStartGameResponse);
    socket.on('role-assigned', handleRoleAssigned);

    // Always emit join-room when the component loads to ensure:
    // 1. The socket is in the socket.io room (even if it reconnected)
    // 2. We get the latest room state from the database
    // 3. The backend knows we're still in the room
    const joinTimeout = setTimeout(() => {
      console.log(`Room component: Joining room with passphrase ${passphrase}`);
      const playerName = getPlayerName();
      socket.emit('join-room', {
        passphrase,
        name: playerName.trim() || undefined,
      });
    }, 100);

    return () => {
      clearTimeout(joinTimeout);
      // Remove event listeners using the stable callback references
      socket.off('join-room-response', handleJoinRoomResponse);
      socket.off('player-joined', handlePlayerJoined);
      socket.off('player-left', handlePlayerLeft);
      socket.off('room-state-sync', handleRoomStateSync);
      socket.off('game-started', handleGameStarted);
      socket.off('start-game-response', handleStartGameResponse);
      socket.off('role-assigned', handleRoleAssigned);
    };
  }, [socket, isConnected, passphrase, handleJoinRoomResponse, handlePlayerJoined, handlePlayerLeft, handleRoomStateSync, handleGameStarted, handleStartGameResponse, handleRoleAssigned]);

  // Periodic room state sync - self-healing mechanism
  useEffect(() => {
    if (!socket || !isConnected || !roomState) return;

    // Request room state sync every 1 second
    // This provides near-instant state correction if events are missed
    // Load considerations: ~1 request/second per player is minimal for small-scale games
    const syncInterval = setInterval(() => {
      if (socket && roomState?.room.id) {
        console.log(`Room component: Requesting room state sync for room ${roomState.room.id}`);
        socket.emit('sync-room-state', { roomId: roomState.room.id });
      }
    }, 1000); // 1 second

    return () => {
      clearInterval(syncInterval);
    };
  }, [socket, isConnected, roomState]);

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

  const handleStartGame = () => {
    if (!socket || !roomState || isStartingGame) return;
    
    setIsStartingGame(true);
    setError(null);
    socket.emit('start-game', { roomId: roomState.room.id });
  };

  const MIN_PLAYERS = 3;
  const canStartGame = roomState?.room.status === 'waiting' && roomState.players.length >= MIN_PLAYERS;
  const playerCount = roomState?.players.length || 0;

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

        {roomState.room.status === 'waiting' && (
          <div className="game-status-section">
            <p className="player-count">
              {playerCount} / {MIN_PLAYERS} players
              {playerCount < MIN_PLAYERS && (
                <span className="player-count-warning">
                  {' '}(need {MIN_PLAYERS - playerCount} more)
                </span>
              )}
            </p>
          </div>
        )}

        {roomState.room.status === 'active' && (
          <div className="game-status-section">
            <p className="game-active-message">🎮 Game is in progress!</p>
            {playerRole && (
              <div className="role-display">
                <p className="role-label">Your Role:</p>
                <p className={`role-value role-${playerRole}`}>
                  {playerRole === 'swiper' && '👤 Swiper'}
                  {playerRole === 'swipefish' && '🐟 Swipefish'}
                  {playerRole === 'match' && '💘 Match'}
                </p>
              </div>
            )}
          </div>
        )}
        
        <div className="room-actions">
          {roomState.room.status === 'waiting' && (
            <button
              className="start-game-button"
              onClick={handleStartGame}
              disabled={!canStartGame || isStartingGame}
            >
              {isStartingGame ? 'Starting...' : 'Start Game'}
            </button>
          )}
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


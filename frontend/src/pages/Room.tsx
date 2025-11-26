import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../contexts/SocketContext';
import { Logo } from '../components/Logo';
import { PlayerList } from '../components/PlayerList';
import { RoomState, PlayerJoinedEvent, PlayerLeftEvent, JoinRoomResponse, RoomStateSyncResponse, GameStartedEvent, StartGameResponse, RoleAssignmentEvent, PlayerRole } from '../types';
import { getPlayerName } from '../utils/playerName';
import { getPersonaImagePath } from '../utils/personaImage';
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
      
      // Explicitly check for persona fields and log them prominently
      const room = syncedRoom.room;
      const personaNumber = (room as any).swiper_persona_number || (room as any).swiperPersonaNumber;
      const personaName = (room as any).swiper_persona_name || (room as any).swiperPersonaName;
      const personaTagline = (room as any).swiper_persona_tagline || (room as any).swiperPersonaTagline;
      
      console.warn('🔍 SAFARI PERSONA CHECK:', {
        hasPersonaNumber: !!personaNumber,
        hasPersonaName: !!personaName,
        hasPersonaTagline: !!personaTagline,
        personaNumber: personaNumber,
        personaName: personaName,
        personaTagline: personaTagline,
        allRoomKeys: Object.keys(room),
        roomStatus: room.status,
      });
      
      console.log('Room component: Sync - Room.room object:', syncedRoom.room);
      console.log('Room component: Sync - Full room object JSON:', JSON.stringify(syncedRoom.room, null, 2));
      console.log('Room component: Sync - Persona fields:', {
        personaNumber: syncedRoom.room.swiper_persona_number,
        personaName: syncedRoom.room.swiper_persona_name,
        personaTagline: syncedRoom.room.swiper_persona_tagline,
      });
      console.log('Room component: Sync - All room keys:', Object.keys(syncedRoom.room));
      setRoomState((prevState) => {
        // Check if state changed: player count, player IDs, room status, or persona data
        const prevPlayerIds = prevState?.players.map(p => p.id).sort().join(',') || '';
        const newPlayerIds = syncedRoom.players.map(p => p.id).sort().join(',');
        const prevStatus = prevState?.room.status || 'waiting';
        const newStatus = syncedRoom.room.status;
        const playerCountChanged = (prevState?.players.length ?? 0) !== syncedRoom.players.length;
        const playerIdsChanged = prevPlayerIds !== newPlayerIds;
        const statusChanged = prevStatus !== newStatus;
        
        // Check if persona data changed or appeared
        const prevPersonaNumber = prevState?.room.swiper_persona_number || null;
        const newPersonaNumber = syncedRoom.room.swiper_persona_number || null;
        const prevPersonaName = prevState?.room.swiper_persona_name || null;
        const newPersonaName = syncedRoom.room.swiper_persona_name || null;
        const prevPersonaTagline = prevState?.room.swiper_persona_tagline || null;
        const newPersonaTagline = syncedRoom.room.swiper_persona_tagline || null;
        const personaChanged = prevPersonaNumber !== newPersonaNumber || prevPersonaName !== newPersonaName || prevPersonaTagline !== newPersonaTagline;
        
        // Always update if persona data exists in sync but not in current state
        const hasPersonaInSync = !!(newPersonaNumber && newPersonaName && newPersonaTagline);
        const hasPersonaInState = !!(prevPersonaNumber && prevPersonaName && prevPersonaTagline);
        const personaAppeared = hasPersonaInSync && !hasPersonaInState;
        
        // Always update if persona appeared or if any other field changed
        // This ensures persona data is always applied when it's present in sync
        // Also update if persona exists in sync (even if it also exists in state) to ensure it's always fresh
        if (playerIdsChanged || playerCountChanged || statusChanged || personaChanged || personaAppeared || hasPersonaInSync) {
          console.log('Room component: Room state changed, updating from sync', {
            playerIdsChanged,
            playerCountChanged,
            statusChanged,
            personaChanged,
            personaAppeared,
            prevStatus,
            newStatus,
            prevPersonaName,
            newPersonaName,
            hasPersonaInSync,
            hasPersonaInState,
          });
          
          // If game status changed to active and we don't have a role yet, 
          // the backend will send it via role-assigned event during sync
          if (statusChanged && newStatus === 'active' && !playerRole) {
            console.log('Room component: Game became active, waiting for role assignment');
          }
          
          // If game status changed back to waiting, clear role
          if (statusChanged && newStatus !== 'active') {
            setPlayerRole(null);
          }
          
          return syncedRoom;
        }
        return prevState;
      });
    } else {
      console.log('Room component: Room state sync failed', response.error);
    }
  }, [playerRole]);

  const handleGameStarted = useCallback((event: GameStartedEvent) => {
    console.log('Room component: Received game-started event', event);
    console.log('Room component: Room object:', event.room);
    console.log('Room component: Room.room object:', event.room.room);
    console.log('Room component: Full room.room JSON:', JSON.stringify(event.room.room, null, 2));
    console.log('Room component: Persona fields:', {
      personaNumber: event.room.room.swiper_persona_number,
      personaName: event.room.room.swiper_persona_name,
      personaTagline: event.room.room.swiper_persona_tagline,
    });
    console.log('Room component: All room keys:', Object.keys(event.room.room));
    console.log('Room component: Has persona number?', !!event.room.room.swiper_persona_number);
    console.log('Room component: Has persona name?', !!event.room.room.swiper_persona_name);
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

  // Extract persona data for rendering (computed outside JSX for Safari compatibility)
  // Using explicit property access to avoid Safari issues with optional chaining
  const personaData = useMemo(() => {
    console.warn('🔧 useMemo RUNNING - roomState:', roomState ? 'EXISTS' : 'NULL');
    
    if (!roomState) {
      console.warn('🔧 useMemo: No roomState, returning null');
      return null;
    }
    
    console.warn('🔧 useMemo: roomStatus =', roomState.room.status);
    
    if (roomState.room.status !== 'active') {
      console.warn('🔧 useMemo: Status not active, returning null');
      return null;
    }
    
    // Use explicit property access - Safari can be finicky with type assertions
    const room = roomState.room;
    const personaNumber = (room as any).swiper_persona_number || (room as any).swiperPersonaNumber || null;
    const personaName = (room as any).swiper_persona_name || (room as any).swiperPersonaName || null;
    const personaTagline = (room as any).swiper_persona_tagline || (room as any).swiperPersonaTagline || null;
    
    console.warn('🔧 useMemo: Extracted values:', {
      personaNumber,
      personaName,
      personaTagline,
      personaNumberType: typeof personaNumber,
      personaNameType: typeof personaName,
      personaTaglineType: typeof personaTagline,
    });
    
    // Explicit check for all three fields - be more lenient
    const hasPersona = personaNumber && personaName && personaTagline;
    
    console.warn('🎯 PERSONA COMPUTATION RESULT:', {
      playerRole,
      personaNumber,
      personaName,
      personaTagline,
      hasPersona,
      roomStatus: roomState.room.status,
      allKeys: Object.keys(roomState.room),
      willReturn: hasPersona ? 'PERSONA OBJECT' : 'NULL',
    });
    
    // Also log directly to DOM for Safari debugging
    if (typeof window !== 'undefined' && window.document) {
      const debugDiv = document.getElementById('safari-debug');
      if (debugDiv) {
        debugDiv.textContent = `Persona: ${hasPersona ? 'FOUND' : 'MISSING'} - ${personaName || 'NO NAME'} - Status: ${roomState.room.status}`;
        debugDiv.style.background = hasPersona ? 'lime' : 'red';
      }
    }
    
    if (hasPersona) {
      const result = {
        personaNumber: String(personaNumber),
        personaName: String(personaName),
        personaTagline: String(personaTagline),
      };
      console.warn('✅ useMemo: Returning persona object:', result);
      return result;
    }
    
    console.warn('❌ useMemo: Returning null (no persona)');
    return null;
  }, [roomState, playerRole]);

  const handleStartGame = () => {
    if (!socket || !roomState || isStartingGame) return;
    
    setIsStartingGame(true);
    setError(null);
    socket.emit('start-game', { roomId: roomState.room.id });
  };

  const MIN_PLAYERS = 3;
  const canStartGame = roomState?.room.status === 'waiting' && roomState.players.length >= MIN_PLAYERS;
  const playerCount = roomState?.players.length || 0;

  // Force render debug info immediately
  useEffect(() => {
    const debugDiv = document.getElementById('safari-debug');
    if (debugDiv) {
      const hasPersona = personaData !== null && personaData !== undefined;
      debugDiv.textContent = `SAFARI DEBUG: Persona=${hasPersona ? 'YES' : 'NO'} | Status=${roomState?.room.status || 'unknown'}`;
      debugDiv.style.display = 'block';
    }
  }, [personaData, roomState]);

  return (
    <div className="room-page">
      <Logo onLeaveRoom={handleLeaveRoom} />
      <div 
        id="safari-debug" 
        style={{ 
          position: 'fixed', 
          top: '40px',
          left: 0, 
          right: 0,
          background: 'lime', 
          padding: '10px', 
          zIndex: 99999, 
          fontSize: '14px',
          fontWeight: 'bold',
          border: '3px solid blue',
          display: 'block'
        }}
      >
        REACT DEBUG: Persona={personaData ? 'YES' : 'NO'} | Status={roomState?.room.status || 'unknown'}
      </div>
      <div className="room-content" style={{ marginTop: '100px' }}>
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
            {(() => {
              console.warn('🎨 RENDERING CHECK: personaData =', personaData);
              console.warn('🎨 RENDERING CHECK: personaData !== null =', personaData !== null);
              console.warn('🎨 RENDERING CHECK: personaData !== undefined =', personaData !== undefined);
              console.warn('🎨 RENDERING CHECK: roomStatus =', roomState.room.status);
              
              if (personaData !== null && personaData !== undefined) {
                console.warn('✅ RENDERING: Showing persona card');
                return (
                  <div className="swiper-persona-card" data-testid="swiper-persona-card" style={{ border: '5px solid green' }}>
                    <p className="swiper-persona-label">Swiper's Persona:</p>
                    <div className="swiper-persona-content">
                      <img
                        src={getPersonaImagePath(
                          personaData.personaNumber || '',
                          personaData.personaName || ''
                        )}
                        alt={personaData.personaName || ''}
                        className="swiper-persona-image"
                        onError={(e) => {
                          console.error('❌ Persona image failed to load!');
                          // Hide image if it fails to load
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                        onLoad={() => {
                          console.warn('✅ Persona image loaded successfully!');
                        }}
                      />
                      <p className="swiper-persona-name">{personaData.personaName || ''}</p>
                      <p className="swiper-persona-tagline">"{personaData.personaTagline || ''}"</p>
                    </div>
                  </div>
                );
              } else {
                console.warn('❌ RENDERING: Persona data is null/undefined. Showing debug box.');
                return (
                  <div style={{ padding: '20px', background: '#ffcccc', margin: '20px 0', border: '5px solid red', fontSize: '18px', fontWeight: 'bold' }}>
                    ⚠️ DEBUG: Persona data is null/undefined. personaData = {JSON.stringify(personaData)}
                  </div>
                );
              }
            })()}
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


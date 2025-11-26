import { Server, Socket } from 'socket.io';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import {
  createRoom,
  findRoomByPassphrase,
  checkPassphraseExists,
  addPlayerToRoom,
  getRoomWithPlayers,
  removePlayer,
  cleanupEmptyRooms,
  getPlayersInRoom,
  ensurePoolInitialized,
  updateRoomStatus,
  updatePlayerRole,
  clearPlayerRolesInRoom,
  updateSwiperRole,
} from './db';
import { selectRandomRole } from './roles';
import { generatePassphrase } from './passphrase';
import { RoomState, GameStartedEvent, PlayerRole, RoleAssignmentEvent } from './types';

const tracer = trace.getTracer('swipefish-rooms', '1.0.0');

// Helper function for structured logging with trace context
function logWithTrace(level: 'info' | 'error' | 'warn', message: string, metadata?: Record<string, any>): void {
  const span = trace.getActiveSpan();
  const traceId = span?.spanContext().traceId;
  const spanId = span?.spanContext().spanId;
  
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    traceId,
    spanId,
    ...metadata,
  };
  
  const logString = JSON.stringify(logEntry);
  if (level === 'error') {
    console.error(logString);
  } else if (level === 'warn') {
    console.warn(logString);
  } else {
    console.log(logString);
  }
}

// In-memory room state for active rooms
const activeRooms = new Map<string, RoomState>();

async function removePlayerFromRoom(socketId: string, io: Server, socket?: Socket): Promise<void> {
  const span = tracer.startSpan('socket.io.remove-player', {
    attributes: {
      'socket.id': socketId,
    },
  });
  
  try {
    // Find which room this player is in by checking database (single source of truth)
    // First, find the player in the database to get their room_id
    const dbPool = ensurePoolInitialized();
  
  let roomId: string | null = null;
  
  try {
    const playerResult = await dbPool.query(
      'SELECT room_id FROM players WHERE socket_id = $1 LIMIT 1',
      [socketId]
    );
    
    if (playerResult.rows.length === 0) {
      // Player not in any room
      span.setAttributes({ 'player.found': false });
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      logWithTrace('info', 'Player not found in any room', { socketId });
      return;
    }
    
    roomId = playerResult.rows[0].room_id;
    if (roomId) {
      span.setAttributes({ 'room.id': roomId, 'player.found': true });
    }
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    logWithTrace('error', 'Error finding player room', { 
      socketId, 
      error: error instanceof Error ? error.message : String(error) 
    });
    return;
  }

  if (!roomId) {
    span.end();
    return;
  }

  // Remove player from database FIRST (single source of truth)
  await removePlayer(socketId);
  logWithTrace('info', 'Removed player from database', { socketId, roomId });

  // Fetch FRESH room state from database (single source of truth)
  const freshRoomState = await getRoomWithPlayers(roomId);
  
  if (!freshRoomState) {
    logWithTrace('warn', 'Room not found after removing player', { roomId });
    activeRooms.delete(roomId);
    span.setAttributes({ 'room.found': false });
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
    return;
  }
  
  logWithTrace('info', 'Room state after removing player', { 
    roomId, 
    playerCount: freshRoomState.players.length,
    remainingPlayers: freshRoomState.players.map(p => ({ socketId: p.socket_id, name: p.name })),
  });

  // Update in-memory cache with fresh data
  activeRooms.set(roomId, freshRoomState);

  // Format room state for JSON serialization (convert dates to strings)
  const formattedRoomState: RoomState = {
    room: {
      ...freshRoomState.room,
      created_at: freshRoomState.room.created_at instanceof Date 
        ? freshRoomState.room.created_at.toISOString() 
        : (freshRoomState.room.created_at as any),
    },
    players: freshRoomState.players.map(p => ({
      ...p,
      joined_at: p.joined_at instanceof Date 
        ? p.joined_at.toISOString() 
        : (p.joined_at as any),
    })),
  };

  const playerLeftEvent = {
    socketId: socketId,
    room: formattedRoomState as any,
  };
  
  // CRITICAL FIX: Ensure all remaining players' sockets are in the socket.io room
  // This handles cases where sockets reconnected but didn't rejoin the room
  // We do this AFTER removing the player so we only ensure remaining players are in the room
  for (const player of freshRoomState.players) {
    const targetSocket = io.sockets.sockets.get(player.socket_id);
    if (targetSocket) {
      // Ensure this socket is in the room
      targetSocket.join(roomId);
      logWithTrace('info', 'Ensured socket is in room', { socketId: player.socket_id, roomId });
    } else {
      logWithTrace('warn', 'Player in database but socket not connected', { socketId: player.socket_id });
    }
  }
  
  // Get list of sockets in room after ensuring all remaining players are in it
  const socketsInRoom = await io.in(roomId).fetchSockets();
  logWithTrace('info', 'Sockets in room after ensuring membership', { 
    roomId, 
    socketCount: socketsInRoom.length,
    socketIds: socketsInRoom.map(s => s.id),
    playerCount: freshRoomState.players.length,
  });
  
  // Multi-layered delivery strategy for maximum reliability:
  // 1. Broadcast to all sockets in socket.io room (primary method)
  // 2. Direct emission to each remaining player's socket (fallback)
  // This ensures delivery even if socket.io room membership is out of sync
  
  // Strategy 1: Broadcast to socket.io room
  io.to(roomId).emit('player-left', playerLeftEvent);
  logWithTrace('info', 'Broadcasted player-left event to room', { roomId, socketCount: socketsInRoom.length });
  
  // Strategy 2: Direct emission to each remaining player (fallback)
  // This ensures delivery even if socket isn't in socket.io room
  let directEmissionCount = 0;
  for (const player of freshRoomState.players) {
    const targetSocket = io.sockets.sockets.get(player.socket_id);
    if (targetSocket) {
      targetSocket.emit('player-left', playerLeftEvent);
      directEmissionCount++;
    }
  }
  logWithTrace('info', 'Sent player-left event directly to players', { roomId, directEmissionCount });

  // Remove socket from socket.io room AFTER broadcasting
  if (socket) {
    socket.leave(roomId);
    logWithTrace('info', 'Socket left socket.io room', { socketId, roomId });
  }

  // Only clean up if room is actually empty
  if (freshRoomState.players.length === 0) {
    activeRooms.delete(roomId);
    logWithTrace('info', 'Room is now empty, removed from memory', { roomId });
    // Only cleanup empty rooms in database if room is actually empty
    await cleanupEmptyRooms();
  } else {
    logWithTrace('info', 'Room still has players, not cleaning up', { 
      roomId, 
      playerCount: freshRoomState.players.length 
    });
  }
  
  span.setAttributes({
    'room.players.remaining': freshRoomState.players.length,
    'room.cleaned': freshRoomState.players.length === 0,
  });
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    logWithTrace('error', 'Error removing player from room', { 
      socketId, 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  }
}

export function initializeRoomHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const connectionSpan = tracer.startSpan('socket.io.connection', {
      attributes: {
        'socket.id': socket.id,
        'socket.transport': socket.conn.transport.name,
      },
    });
    
    logWithTrace('info', 'Client connected', { socketId: socket.id });
    
    context.with(trace.setSpan(context.active(), connectionSpan), () => {
      connectionSpan.end();
    });

    socket.on('create-room', async (data: { name?: string } = {}) => {
      const span = tracer.startSpan('socket.io.create-room', {
        attributes: {
          'socket.id': socket.id,
          'player.name': data.name || 'anonymous',
        },
      });
      
      try {
        const { name } = data;
        logWithTrace('info', 'Create room request', { socketId: socket.id, playerName: name || 'none' });
        
        // Generate unique passphrase
        let passphrase: string;
        let attempts = 0;
        do {
          passphrase = generatePassphrase();
          attempts++;
          if (attempts > 100) {
            socket.emit('create-room-response', {
              success: false,
              error: 'Failed to generate unique passphrase',
            });
            return;
          }
        } while (await checkPassphraseExists(passphrase));

        // Create room in database
        const room = await createRoom(passphrase);

        // Add creator as first player (with name if provided)
        await addPlayerToRoom(room.id, socket.id, name?.trim() || undefined);

        // Fetch FRESH room state from database (single source of truth)
        const freshRoomState = await getRoomWithPlayers(room.id);
        
        if (!freshRoomState) {
          console.error('Failed to load room state after creation');
          socket.emit('create-room-response', {
            success: false,
            error: 'Failed to create room',
          });
          return;
        }

        // Update in-memory cache with fresh data
        activeRooms.set(room.id, freshRoomState);

        // Join socket room for this game room
        socket.join(room.id);
        console.log(`Socket ${socket.id} joined socket.io room ${room.id} after creating room`);
        
        // Verify socket is in the room
        const socketsInRoomAfterCreate = await io.in(room.id).fetchSockets();
        console.log(`Room ${room.id} has ${socketsInRoomAfterCreate.length} sockets after creation:`, socketsInRoomAfterCreate.map(s => s.id));

        // Format room state for JSON serialization
        const formattedRoomState: RoomState = {
          room: {
            ...freshRoomState.room,
            created_at: freshRoomState.room.created_at instanceof Date 
              ? freshRoomState.room.created_at.toISOString() 
              : (freshRoomState.room.created_at as any),
          },
          players: freshRoomState.players.map(p => ({
            ...p,
            joined_at: p.joined_at instanceof Date 
              ? p.joined_at.toISOString() 
              : (p.joined_at as any),
          })),
        };

        // Send response with fresh room state
        span.setAttributes({
          'room.id': room.id,
          'room.passphrase': passphrase,
          'room.players.count': freshRoomState.players.length,
        });
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        
        socket.emit('create-room-response', {
          success: true,
          passphrase,
          room: formattedRoomState as any,
        });
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ 
          code: SpanStatusCode.ERROR, 
          message: error instanceof Error ? error.message : 'Failed to create room' 
        });
        span.end();
        
        logWithTrace('error', 'Error creating room', { 
          socketId: socket.id, 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        socket.emit('create-room-response', {
          success: false,
          error: 'Failed to create room',
        });
      }
    });

    socket.on('join-room', async (data: { passphrase: string; name?: string }) => {
      const passphrase = data.passphrase;
      const span = tracer.startSpan('socket.io.join-room', {
        attributes: {
          'socket.id': socket.id,
          'room.passphrase': passphrase,
          'player.name': data.name || 'anonymous',
        },
      });
      
      try {
        const { name } = data;
        logWithTrace('info', 'Join room request', { socketId: socket.id, passphrase });

        if (!passphrase) {
          socket.emit('join-room-response', {
            success: false,
            error: 'Passphrase is required',
          });
          return;
        }

        // Find room by passphrase
        const room = await findRoomByPassphrase(passphrase);

        if (!room) {
          logWithTrace('warn', 'Room not found for passphrase', { passphrase });
          socket.emit('join-room-response', {
            success: false,
            error: 'Room not found',
          });
          return;
        }

        // Fetch fresh room state to ensure we have the latest status
        const freshRoomState = await getRoomWithPlayers(room.id);
        if (!freshRoomState) {
          logWithTrace('error', 'Failed to load room state', { roomId: room.id, passphrase });
          socket.emit('join-room-response', {
            success: false,
            error: 'Failed to load room state',
          });
          return;
        }

        logWithTrace('info', 'Found room for passphrase', { 
          roomId: room.id, 
          passphrase, 
          roomStatus: freshRoomState.room.status 
        });

        // Check if game is already in progress (status is 'active' or 'finished')
        if (freshRoomState.room.status === 'active' || freshRoomState.room.status === 'finished') {
          // Check if this player is already in the room (reconnection case)
          const existingPlayers = await getPlayersInRoom(room.id);
          const isExistingPlayer = existingPlayers.some(p => p.socket_id === socket.id);
          
          logWithTrace('info', 'Game in progress, checking if player exists', { 
            roomId: room.id, 
            status: freshRoomState.room.status,
            socketId: socket.id,
            isExistingPlayer,
            existingPlayerCount: existingPlayers.length
          });
          
          if (!isExistingPlayer) {
            logWithTrace('warn', 'Attempted to join room with game in progress', { 
              roomId: room.id, 
              passphrase,
              status: freshRoomState.room.status,
              socketId: socket.id
            });
            socket.emit('join-room-response', {
              success: false,
              error: 'Game already in progress. New players cannot join.',
            });
            span.setStatus({ code: SpanStatusCode.ERROR, message: 'Game already in progress' });
            span.end();
            return;
          }
          // If player already exists, allow reconnection
          logWithTrace('info', 'Allowing reconnection for existing player', { 
            roomId: room.id, 
            socketId: socket.id 
          });
        }

        // Add player to database FIRST (single source of truth)
        const player = await addPlayerToRoom(room.id, socket.id, name?.trim() || undefined);
        console.log(`Added player ${player.id} to room ${room.id}`);

        // Fetch FRESH room state from database (single source of truth)
        // Note: We may have already fetched this above, but fetch again to ensure we have the latest state
        const updatedRoomState = await getRoomWithPlayers(room.id);
        
        if (!updatedRoomState) {
          console.error(`Failed to load room state from database for room ${room.id}`);
          socket.emit('join-room-response', {
            success: false,
            error: 'Failed to load room state',
          });
          return;
        }

        // Update in-memory cache with fresh data from database
        activeRooms.set(room.id, updatedRoomState);
        console.log(`Updated room state from database. Total players: ${updatedRoomState.players.length}`);

        // Check if player is already in room (for broadcast logic)
        const alreadyInRoom = updatedRoomState.players.find((p) => p.socket_id === socket.id);
        if (!alreadyInRoom) {
          console.log(`Warning: Player ${socket.id} not found in fresh room state after adding`);
        }

        // Join socket room (if not already in it)
        // Note: socket.join() is idempotent, so it's safe to call multiple times
        socket.join(room.id);
        console.log(`Socket ${socket.id} joined socket.io room ${room.id}`);
        
        // Verify socket is in the room by checking room membership
        const socketsInRoom = await io.in(room.id).fetchSockets();
        console.log(`Room ${room.id} now has ${socketsInRoom.length} sockets:`, socketsInRoom.map(s => s.id));
        
        // Also log which players are in the database for this room
        const dbPlayerSocketIds = freshRoomState.players.map(p => p.socket_id);
        console.log(`Players in database for room ${room.id}:`, dbPlayerSocketIds);
        console.log(`Sockets in socket.io room:`, socketsInRoom.map(s => s.id));
        console.log(`Missing sockets (in DB but not in socket.io room):`, dbPlayerSocketIds.filter(id => !socketsInRoom.find(s => s.id === id)));

        // Format fresh room state for JSON serialization (convert dates to strings)
        const formattedRoomState: RoomState = {
          room: {
            ...updatedRoomState.room,
            created_at: updatedRoomState.room.created_at instanceof Date 
              ? updatedRoomState.room.created_at.toISOString() 
              : (updatedRoomState.room.created_at as any),
          },
          players: updatedRoomState.players.map(p => ({
            ...p,
            joined_at: p.joined_at instanceof Date 
              ? p.joined_at.toISOString() 
              : (p.joined_at as any),
          })),
        };

        // Notify the joining player with fresh state
        socket.emit('join-room-response', {
          success: true,
          room: formattedRoomState as any,
        });
        console.log(`Sent join-room-response to ${socket.id} with ${updatedRoomState.players.length} players`);

        // Broadcast to ALL players in the room (including Player 1 if they're still connected)
        // Find the player that just joined for the broadcast
        const joinedPlayer = updatedRoomState.players.find((p) => p.socket_id === socket.id);
        
        // Get list of sockets in room before broadcasting to verify who will receive it
        const socketsInRoomForBroadcast = await io.in(room.id).fetchSockets();
        console.log(`About to broadcast player-joined to room ${room.id}. Sockets in room: ${socketsInRoomForBroadcast.length}`, socketsInRoomForBroadcast.map(s => s.id));
        
        // Also check which players are in the database but might not have sockets in the room
        const allPlayerSocketIds = freshRoomState.players.map(p => p.socket_id);
        console.log(`All player socket IDs in database: ${allPlayerSocketIds.join(', ')}`);
        
        // CRITICAL FIX: Ensure all connected players' sockets are in the socket.io room
        // If a player's socket is connected but not in the room, join them to the room
        // This handles the case where P1's socket reconnected but didn't rejoin the room
        for (const player of updatedRoomState.players) {
          if (player.socket_id === socket.id) {
            continue; // Skip the joining player
          }
          const targetSocket = io.sockets.sockets.get(player.socket_id);
          if (targetSocket) {
            // Check if this socket is in the room
            const socketInRoom = socketsInRoomForBroadcast.find(s => s.id === player.socket_id);
            if (!socketInRoom) {
              // Socket is connected but not in the room - join them
              targetSocket.join(room.id);
              console.log(`Rejoined socket ${player.socket_id} to room ${room.id} (was connected but not in room)`);
            }
          }
        }
        
        // Re-fetch sockets in room after rejoining any disconnected sockets
        const socketsInRoomAfterRejoin = await io.in(room.id).fetchSockets();
        console.log(`Sockets in room after rejoin: ${socketsInRoomAfterRejoin.length}`, socketsInRoomAfterRejoin.map(s => s.id));
        
        if (joinedPlayer) {
          console.log(`Broadcasting player-joined event to room ${room.id} for player ${socket.id} (name: ${joinedPlayer.name || 'none'})`);
          
          const playerJoinedEvent = {
            player: {
              ...joinedPlayer,
              joined_at: joinedPlayer.joined_at instanceof Date 
                ? joinedPlayer.joined_at.toISOString() 
                : (joinedPlayer.joined_at as any),
            },
            room: formattedRoomState as any,
          };
          
          // Multi-layered delivery strategy for maximum reliability:
          // 1. Broadcast to all sockets in socket.io room (primary method)
          // 2. Direct emission to each existing player's socket (fallback)
          // This ensures delivery even if socket.io room membership is out of sync
          
          // Strategy 1: Broadcast to socket.io room
          io.to(room.id).emit('player-joined', playerJoinedEvent);
          const socketsToNotify = socketsInRoomAfterRejoin.filter(s => s.id !== socket.id);
          console.log(`Broadcasted player-joined event to room ${room.id} (${socketsToNotify.length} sockets in room)`);
          
          // Strategy 2: Direct emission to each existing player (fallback)
          // This ensures delivery even if socket isn't in socket.io room
          let directEmissionCount = 0;
          for (const player of updatedRoomState.players) {
            if (player.socket_id === socket.id) {
              continue; // Skip the joining player
            }
            const targetSocket = io.sockets.sockets.get(player.socket_id);
            if (targetSocket) {
              targetSocket.emit('player-joined', playerJoinedEvent);
              directEmissionCount++;
            }
          }
          console.log(`Also sent player-joined event directly to ${directEmissionCount} existing players (fallback)`);
        } else {
          console.log(`Warning: Could not find joined player ${socket.id} in room state, but broadcasting anyway`);
          // Broadcast anyway with the fresh room state so all players stay in sync
          const playerJoinedEvent = {
            player: {
              id: 'unknown',
              room_id: room.id,
              name: null,
              socket_id: socket.id,
              joined_at: new Date().toISOString(),
            },
            room: formattedRoomState as any,
          };
          
          // Send directly to all other players
          let sentCount = 0;
          for (const player of updatedRoomState.players) {
            if (player.socket_id === socket.id) {
              continue;
            }
            const targetSocket = io.sockets.sockets.get(player.socket_id);
            if (targetSocket) {
              targetSocket.emit('player-joined', playerJoinedEvent);
              sentCount++;
            }
          }
          
          // Also broadcast to the room as a fallback
          io.to(room.id).emit('player-joined', playerJoinedEvent);
          
          logWithTrace('warn', 'Broadcasted player-joined event (unknown player)', { 
            roomId: room.id, 
            sentCount 
          });
        }
        
        span.setAttributes({
          'room.id': room.id,
          'room.players.count': updatedRoomState.players.length,
        });
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ 
          code: SpanStatusCode.ERROR, 
          message: error instanceof Error ? error.message : 'Failed to join room' 
        });
        span.end();
        
        logWithTrace('error', 'Error joining room', { 
          socketId: socket.id, 
          passphrase,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        socket.emit('join-room-response', {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to join room',
        });
      }
    });

    socket.on('leave-room', async () => {
      try {
        console.log(`Leave-room event received from ${socket.id}`);
        await removePlayerFromRoom(socket.id, io, socket);
      } catch (error) {
        console.error('Error leaving room:', error);
      }
    });

    socket.on('sync-room-state', async (data: { roomId: string }) => {
      try {
        const { roomId } = data;
        if (!roomId) {
          console.log(`sync-room-state: Missing roomId from ${socket.id}`);
          return;
        }

        // Fetch fresh room state from database (single source of truth)
        const freshRoomState = await getRoomWithPlayers(roomId);
        
        if (!freshRoomState) {
          console.log(`sync-room-state: Room ${roomId} not found for ${socket.id}`);
          socket.emit('room-state-sync', {
            success: false,
            error: 'Room not found',
          });
          return;
        }

        // Ensure socket is in the room
        socket.join(roomId);

        // Format room state for JSON serialization
        const formattedRoomState: RoomState = {
          room: {
            ...freshRoomState.room,
            created_at: freshRoomState.room.created_at instanceof Date 
              ? freshRoomState.room.created_at.toISOString() 
              : (freshRoomState.room.created_at as any),
          },
          players: freshRoomState.players.map(p => ({
            ...p,
            joined_at: p.joined_at instanceof Date 
              ? p.joined_at.toISOString() 
              : (p.joined_at as any),
          })),
        };

        // Send current room state to requesting socket
        socket.emit('room-state-sync', {
          success: true,
          room: formattedRoomState as any,
        });

        // If game is active, also send role assignment if it exists
        // Roles are now stored in the database, so read from player.role
        if (freshRoomState.room.status === 'active') {
          // Find the player with this socket_id
          let player = freshRoomState.players.find(p => p.socket_id === socket.id);
          
          // If player not found by socket_id, they may have reconnected
          // Try to match them to a player with a stale socket_id who has a role
          if (!player && freshRoomState.players.length > 0) {
            // Get all connected sockets in this room
            const socketsInRoom = await io.in(roomId).fetchSockets();
            const connectedSocketIds = new Set(socketsInRoom.map(s => s.id));
            
            // Find players whose socket_ids are not connected (stale) but have roles
            const playersWithStaleSockets = freshRoomState.players.filter(p => 
              !connectedSocketIds.has(p.socket_id) && p.role
            );
            
            // Find connected sockets that don't have a matching player record
            const unmatchedSockets = socketsInRoom.filter(s => 
              !freshRoomState.players.some(p => p.socket_id === s.id)
            );
            
            // If this socket is unmatched and there are players with stale sockets, try to match
            if (unmatchedSockets.some(s => s.id === socket.id) && playersWithStaleSockets.length > 0) {
              // Find the index of this socket in the unmatched list
              const socketIndex = unmatchedSockets.findIndex(s => s.id === socket.id);
              // Match to the stale player at the same index (or first one if index is out of bounds)
              const stalePlayer = playersWithStaleSockets[Math.min(socketIndex, playersWithStaleSockets.length - 1)];
              try {
                // Update socket_id in database
                const dbPool = ensurePoolInitialized();
                await dbPool.query(
                  'UPDATE players SET socket_id = $1 WHERE id = $2',
                  [socket.id, stalePlayer.id]
                );
                // Refresh room state to get updated player
                const updatedState = await getRoomWithPlayers(roomId);
                if (updatedState) {
                  player = updatedState.players.find(p => p.id === stalePlayer.id);
                  logWithTrace('info', 'Matched unmatched socket to stale player', {
                    roomId,
                    playerId: stalePlayer.id,
                    socketId: socket.id,
                    role: stalePlayer.role,
                  });
                }
              } catch (error) {
                logWithTrace('error', 'Error matching socket to player', {
                  roomId,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
          }
          
          if (player) {
            const role = player.role as PlayerRole | null | undefined;
            if (role) {
              const roleAssignmentEvent: RoleAssignmentEvent = { role };
              socket.emit('role-assigned', roleAssignmentEvent);
              logWithTrace('info', 'Sent role assignment during sync', {
                roomId,
                playerId: player.id,
                socketId: socket.id,
                role,
              });
            } else {
              logWithTrace('warn', 'No role found for player during sync', {
                roomId,
                playerId: player.id,
                socketId: socket.id,
              });
            }
          } else {
            logWithTrace('warn', 'Player not found in room during sync', {
              roomId,
              socketId: socket.id,
              playersInRoom: freshRoomState.players.map(p => ({ id: p.id, socketId: p.socket_id, role: p.role })),
            });
          }
        }

        console.log(`Sent room-state-sync to ${socket.id} for room ${roomId} (${freshRoomState.players.length} players)`);
      } catch (error) {
        console.error('Error syncing room state:', error);
        socket.emit('room-state-sync', {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to sync room state',
        });
      }
    });

    // Function to assign roles to players
    function assignRoles(players: { id: string; socket_id: string }[]): Map<string, PlayerRole> {
      const roleAssignments = new Map<string, PlayerRole>();
      const shuffled = [...players].sort(() => Math.random() - 0.5);
      
      // Always assign: 1 Swiper, 1 Swipefish, rest are Matches
      if (shuffled.length > 0) {
        roleAssignments.set(shuffled[0].socket_id, 'swiper');
      }
      if (shuffled.length > 1) {
        roleAssignments.set(shuffled[1].socket_id, 'swipefish');
      }
      // Remaining players are Matches
      for (let i = 2; i < shuffled.length; i++) {
        roleAssignments.set(shuffled[i].socket_id, 'match');
      }
      
      return roleAssignments;
    }

    socket.on('start-game', async (data: { roomId: string }) => {
      const span = tracer.startSpan('socket.io.start-game', {
        attributes: {
          'socket.id': socket.id,
          'room.id': data.roomId || 'unknown',
        },
      });
      
      try {
        const { roomId } = data;
        logWithTrace('info', 'Start game request', { socketId: socket.id, roomId });

        if (!roomId) {
          socket.emit('start-game-response', {
            success: false,
            error: 'Room ID is required',
          });
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Missing room ID' });
          span.end();
          return;
        }

        // Fetch fresh room state from database (single source of truth)
        const freshRoomState = await getRoomWithPlayers(roomId);
        
        if (!freshRoomState) {
          logWithTrace('warn', 'Room not found for start-game', { roomId });
          socket.emit('start-game-response', {
            success: false,
            error: 'Room not found',
          });
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Room not found' });
          span.end();
          return;
        }

        // Validate room status
        if (freshRoomState.room.status !== 'waiting') {
          logWithTrace('warn', 'Cannot start game - room not in waiting status', { 
            roomId, 
            currentStatus: freshRoomState.room.status 
          });
          socket.emit('start-game-response', {
            success: false,
            error: `Game cannot be started. Room status is: ${freshRoomState.room.status}`,
          });
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Invalid room status' });
          span.end();
          return;
        }

        // Validate minimum players (need at least 3: 1 Judge + 1 Swipefish + 1 other)
        const MIN_PLAYERS = 3;
        if (freshRoomState.players.length < MIN_PLAYERS) {
          logWithTrace('warn', 'Cannot start game - insufficient players', { 
            roomId, 
            playerCount: freshRoomState.players.length,
            minRequired: MIN_PLAYERS 
          });
          socket.emit('start-game-response', {
            success: false,
            error: `Need at least ${MIN_PLAYERS} players to start. Currently have ${freshRoomState.players.length}.`,
          });
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Insufficient players' });
          span.end();
          return;
        }

        // Update room status to 'active'
        await updateRoomStatus(roomId, 'active');
        logWithTrace('info', 'Updated room status to active', { roomId });

        // Select and store a random role card for the Swiper
        const selectedRole = selectRandomRole();
        await updateSwiperRole(roomId, selectedRole.roleNumber, selectedRole.role, selectedRole.tagline);
        logWithTrace('info', 'Selected and stored Swiper role card', {
          roomId,
          roleNumber: selectedRole.roleNumber,
          role: selectedRole.role,
          tagline: selectedRole.tagline,
        });

        // Fetch fresh room state after update
        const updatedRoomState = await getRoomWithPlayers(roomId);
        
        if (!updatedRoomState) {
          console.error(`Failed to load room state after starting game for room ${roomId}`);
          socket.emit('start-game-response', {
            success: false,
            error: 'Failed to start game',
          });
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Failed to load room state' });
          span.end();
          return;
        }

        // Update in-memory cache
        activeRooms.set(roomId, updatedRoomState);

        // Format room state for JSON serialization
        const formattedRoomState: RoomState = {
          room: {
            ...updatedRoomState.room,
            created_at: updatedRoomState.room.created_at instanceof Date 
              ? updatedRoomState.room.created_at.toISOString() 
              : (updatedRoomState.room.created_at as any),
          },
          players: updatedRoomState.players.map(p => ({
            ...p,
            joined_at: p.joined_at instanceof Date 
              ? p.joined_at.toISOString() 
              : (p.joined_at as any),
          })),
        };

        // Ensure all players' sockets are in the room before broadcasting
        const socketsInRoom = await io.in(roomId).fetchSockets();
        for (const player of updatedRoomState.players) {
          const targetSocket = io.sockets.sockets.get(player.socket_id);
          if (targetSocket) {
            targetSocket.join(roomId);
          }
        }

        // Clear any existing roles for this room
        await clearPlayerRolesInRoom(roomId);
        
        // Assign roles to players: 1 Swiper, 1 Swipefish, X-2 Matches
        const newRoleAssignments = assignRoles(updatedRoomState.players);
        
        // Store role assignments in database (persistent across reconnections and server restarts)
        for (const player of updatedRoomState.players) {
          const role = newRoleAssignments.get(player.socket_id);
          if (role) {
            await updatePlayerRole(player.id, role);
            logWithTrace('info', 'Assigned and stored role in database', {
              roomId,
              playerId: player.id,
              socketId: player.socket_id,
              role,
            });
          }
        }
        
        // Refresh room state to get roles from database
        const roomStateWithRoles = await getRoomWithPlayers(roomId);
        if (!roomStateWithRoles) {
          logWithTrace('error', 'Failed to load room state with roles', { roomId });
        } else {
          logWithTrace('info', 'Assigned roles to players', {
            roomId,
            playerCount: roomStateWithRoles.players.length,
            roles: roomStateWithRoles.players.map(p => ({ playerId: p.id, role: p.role })),
          });
        }
        
        // Send role assignment to each player individually
        for (const player of updatedRoomState.players) {
          const role = newRoleAssignments.get(player.socket_id);
          if (role) {
            const targetSocket = io.sockets.sockets.get(player.socket_id);
            if (targetSocket) {
              const roleAssignmentEvent: RoleAssignmentEvent = { role };
              targetSocket.emit('role-assigned', roleAssignmentEvent);
              logWithTrace('info', 'Sent role assignment to player', {
                roomId,
                playerId: player.id,
                socketId: player.socket_id,
                role,
              });
            } else {
              // Socket not found - will be sent via game-started fallback and sync
              logWithTrace('warn', 'Socket not found for initial role assignment, will retry', {
                roomId,
                playerId: player.id,
                socketId: player.socket_id,
                role,
              });
            }
          } else {
            logWithTrace('warn', 'No role assigned for player', {
              roomId,
              playerId: player.id,
              socketId: player.socket_id,
            });
          }
        }

        // Create game started event
        const gameStartedEvent: GameStartedEvent = {
          room: formattedRoomState as any,
        };

        // Broadcast to all players in the room AND send directly to each player
        // This ensures delivery even if socket.io room membership is out of sync
        io.to(roomId).emit('game-started', gameStartedEvent);
        
        // Refresh room state to get roles from database before sending fallback
        const roomStateWithRolesForFallback = await getRoomWithPlayers(roomId);
        const playersWithRoles = roomStateWithRolesForFallback?.players || updatedRoomState.players;
        
        // Also send directly to each player as a fallback, along with their role
        for (const dbPlayer of playersWithRoles) {
          const targetSocket = io.sockets.sockets.get(dbPlayer.socket_id);
          if (targetSocket) {
            // Send game-started event
            targetSocket.emit('game-started', gameStartedEvent);
            
            // Also send role assignment if it exists (in case they missed the initial role-assigned event)
            // Get role from database
            const role = dbPlayer.role as PlayerRole | null | undefined;
            if (role) {
              const roleAssignmentEvent: RoleAssignmentEvent = { role };
              targetSocket.emit('role-assigned', roleAssignmentEvent);
              logWithTrace('info', 'Sent role assignment with game-started fallback', {
                roomId,
                playerId: dbPlayer.id,
                socketId: dbPlayer.socket_id,
                role,
              });
            }
          } else {
            // Log if socket not found - this player will get role via sync
            logWithTrace('warn', 'Socket not found when sending game-started, will sync later', {
              roomId,
              playerId: dbPlayer.id,
              socketId: dbPlayer.socket_id,
            });
          }
        }
        
        logWithTrace('info', 'Broadcasted game-started event', { 
          roomId, 
          playerCount: updatedRoomState.players.length 
        });

        // Also send direct response to the player who started the game
        socket.emit('start-game-response', {
          success: true,
          room: formattedRoomState as any,
        });

        span.setAttributes({
          'room.id': roomId,
          'room.players.count': updatedRoomState.players.length,
        });
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ 
          code: SpanStatusCode.ERROR, 
          message: error instanceof Error ? error.message : 'Failed to start game' 
        });
        span.end();
        
        logWithTrace('error', 'Error starting game', { 
          socketId: socket.id, 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        socket.emit('start-game-response', {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to start game',
        });
      }
    });

    socket.on('disconnect', async () => {
      const span = tracer.startSpan('socket.io.disconnect', {
        attributes: {
          'socket.id': socket.id,
        },
      });
      
      try {
        await removePlayerFromRoom(socket.id, io, socket);
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        logWithTrace('info', 'Client disconnected', { socketId: socket.id });
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        logWithTrace('error', 'Error handling disconnect', { 
          socketId: socket.id, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });
  });
}

export function getActiveRoom(roomId: string): RoomState | undefined {
  return activeRooms.get(roomId);
}


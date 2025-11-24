import { Server, Socket } from 'socket.io';
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
} from './db';
import { generatePassphrase } from './passphrase';
import { RoomState } from './types';

// In-memory room state for active rooms
const activeRooms = new Map<string, RoomState>();

async function removePlayerFromRoom(socketId: string, io: Server, socket?: Socket): Promise<void> {
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
      console.log(`Player ${socketId} not found in any room`);
      return;
    }
    
    roomId = playerResult.rows[0].room_id;
  } catch (error) {
    console.error('Error finding player room:', error);
    return;
  }

  if (!roomId) {
    return;
  }

  // Remove player from database FIRST (single source of truth)
  await removePlayer(socketId);
  console.log(`Removed player ${socketId} from database`);

  // Fetch FRESH room state from database (single source of truth)
  const freshRoomState = await getRoomWithPlayers(roomId);
  
  if (!freshRoomState) {
    console.log(`Room ${roomId} not found after removing player`);
    activeRooms.delete(roomId);
    return;
  }
  
  console.log(`Room ${roomId} has ${freshRoomState.players.length} players after removing ${socketId}`);
  if (freshRoomState.players.length > 0) {
    console.log(`Remaining players:`, freshRoomState.players.map(p => ({ socketId: p.socket_id, name: p.name })));
  }

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
      console.log(`Ensured socket ${player.socket_id} is in room ${roomId}`);
    } else {
      console.log(`Warning: Player ${player.socket_id} is in database but socket is not connected`);
    }
  }
  
  // Get list of sockets in room after ensuring all remaining players are in it
  const socketsInRoom = await io.in(roomId).fetchSockets();
  console.log(`Sockets in room after ensuring membership: ${socketsInRoom.length}`, socketsInRoom.map(s => s.id));
  console.log(`Remaining players in database: ${freshRoomState.players.length}`, freshRoomState.players.map(p => ({ socketId: p.socket_id, name: p.name })));
  
  // Multi-layered delivery strategy for maximum reliability:
  // 1. Broadcast to all sockets in socket.io room (primary method)
  // 2. Direct emission to each remaining player's socket (fallback)
  // This ensures delivery even if socket.io room membership is out of sync
  
  // Strategy 1: Broadcast to socket.io room
  io.to(roomId).emit('player-left', playerLeftEvent);
  console.log(`Broadcasted player-left event to room ${roomId} (${socketsInRoom.length} sockets in room)`);
  
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
  console.log(`Also sent player-left event directly to ${directEmissionCount} remaining players (fallback)`);

  // Remove socket from socket.io room AFTER broadcasting
  if (socket) {
    socket.leave(roomId);
    console.log(`Socket ${socketId} left socket.io room ${roomId}`);
  }

  // Only clean up if room is actually empty
  if (freshRoomState.players.length === 0) {
    activeRooms.delete(roomId);
    console.log(`Room ${roomId} is now empty, removed from memory`);
    // Only cleanup empty rooms in database if room is actually empty
    await cleanupEmptyRooms();
  } else {
    console.log(`Room ${roomId} still has ${freshRoomState.players.length} players, not cleaning up`);
  }
}

export function initializeRoomHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('create-room', async (data: { name?: string } = {}) => {
      try {
        const { name } = data;
        console.log(`Create room request from ${socket.id} with name: ${name || 'none'}`);
        
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
        socket.emit('create-room-response', {
          success: true,
          passphrase,
          room: formattedRoomState as any,
        });
      } catch (error) {
        console.error('Error creating room:', error);
        socket.emit('create-room-response', {
          success: false,
          error: 'Failed to create room',
        });
      }
    });

    socket.on('join-room', async (data: { passphrase: string; name?: string }) => {
      try {
        const { passphrase, name } = data;

        console.log(`Join room request from ${socket.id} with passphrase: ${passphrase}`);

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
          console.log(`Room not found for passphrase: ${passphrase}`);
          socket.emit('join-room-response', {
            success: false,
            error: 'Room not found',
          });
          return;
        }

        console.log(`Found room ${room.id} for passphrase: ${passphrase}`);

        // Add player to database FIRST (single source of truth)
        const player = await addPlayerToRoom(room.id, socket.id, name?.trim() || undefined);
        console.log(`Added player ${player.id} to room ${room.id}`);

        // Fetch FRESH room state from database (single source of truth)
        const freshRoomState = await getRoomWithPlayers(room.id);
        
        if (!freshRoomState) {
          console.error(`Failed to load room state from database for room ${room.id}`);
          socket.emit('join-room-response', {
            success: false,
            error: 'Failed to load room state',
          });
          return;
        }

        // Update in-memory cache with fresh data from database
        activeRooms.set(room.id, freshRoomState);
        console.log(`Updated room state from database. Total players: ${freshRoomState.players.length}`);

        // Check if player is already in room (for broadcast logic)
        const alreadyInRoom = freshRoomState.players.find((p) => p.socket_id === socket.id);
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

        // Notify the joining player with fresh state
        socket.emit('join-room-response', {
          success: true,
          room: formattedRoomState as any,
        });
        console.log(`Sent join-room-response to ${socket.id} with ${freshRoomState.players.length} players`);

        // Broadcast to ALL players in the room (including Player 1 if they're still connected)
        // Find the player that just joined for the broadcast
        const joinedPlayer = freshRoomState.players.find((p) => p.socket_id === socket.id);
        
        // Get list of sockets in room before broadcasting to verify who will receive it
        const socketsInRoomForBroadcast = await io.in(room.id).fetchSockets();
        console.log(`About to broadcast player-joined to room ${room.id}. Sockets in room: ${socketsInRoomForBroadcast.length}`, socketsInRoomForBroadcast.map(s => s.id));
        
        // Also check which players are in the database but might not have sockets in the room
        const allPlayerSocketIds = freshRoomState.players.map(p => p.socket_id);
        console.log(`All player socket IDs in database: ${allPlayerSocketIds.join(', ')}`);
        
        // CRITICAL FIX: Ensure all connected players' sockets are in the socket.io room
        // If a player's socket is connected but not in the room, join them to the room
        // This handles the case where P1's socket reconnected but didn't rejoin the room
        for (const player of freshRoomState.players) {
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
          
          // ARCHITECTURAL SIMPLIFICATION: Single source of truth approach
          // Database = source of truth for room state (who SHOULD be in the room)
          // Socket.io room = delivery mechanism (who CAN receive events)
          // Event payload = current room state from database (what everyone should see)
          //
          // Strategy: Broadcast to ALL sockets in socket.io room
          // Don't try to match socket_ids - just send to everyone in the room
          // The event payload contains the authoritative room state from database
          // This is simpler and more resilient than trying to match socket_ids
          
          // Skip the joining socket (they already got join-room-response)
          const socketsToNotify = socketsInRoomAfterRejoin.filter(s => s.id !== socket.id);
          
          // Broadcast to all sockets in the room (except the joining socket)
          // The event payload contains the room state from database (single source of truth)
          io.to(room.id).emit('player-joined', playerJoinedEvent);
          
          console.log(`Broadcasted player-joined event to room ${room.id} with ${freshRoomState.players.length} total players. Sent to ${socketsToNotify.length} sockets in room (room state from database).`);
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
          for (const player of freshRoomState.players) {
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
          
          console.log(`Broadcasted player-joined event (unknown player) to room ${room.id}. Sent directly to ${sentCount} sockets.`);
        }
      } catch (error) {
        console.error('Error joining room:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
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

    socket.on('disconnect', async () => {
      try {
        await removePlayerFromRoom(socket.id, io, socket);
        console.log(`Client disconnected: ${socket.id}`);
      } catch (error) {
        console.error('Error handling disconnect:', error);
      }
    });
  });
}

export function getActiveRoom(roomId: string): RoomState | undefined {
  return activeRooms.get(roomId);
}


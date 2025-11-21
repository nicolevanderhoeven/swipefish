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

  // Get room state BEFORE removing player to see who else is in the room
  const roomStateBeforeRemoval = await getRoomWithPlayers(roomId);
  console.log(`Room ${roomId} has ${roomStateBeforeRemoval?.players.length || 0} players before removing ${socketId}`);
  if (roomStateBeforeRemoval) {
    console.log(`Players before removal:`, roomStateBeforeRemoval.players.map(p => ({ socketId: p.socket_id, name: p.name })));
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

  // Get list of sockets in room before broadcasting to verify who will receive it
  const socketsInRoomForBroadcast = await io.in(roomId).fetchSockets();
  console.log(`About to broadcast player-left to room ${roomId}. Sockets in room: ${socketsInRoomForBroadcast.length}`, socketsInRoomForBroadcast.map(s => s.id));
  console.log(`Remaining players in database: ${freshRoomState.players.length}`, freshRoomState.players.map(p => ({ socketId: p.socket_id, name: p.name })));
  
  // Broadcast player left to all remaining players in the room (BEFORE removing socket from room)
  // Use io.to() to send to ALL sockets in the room
  // The leaving socket will receive it but that's okay - it can ignore it
  console.log(`Broadcasting player-left event to room ${roomId} (${freshRoomState.players.length} remaining players)`);
  
  // Send to ALL sockets in the room using io.to()
  // This ensures all players (including Player 2) receive the event
  io.to(roomId).emit('player-left', {
    socketId: socketId,
    room: formattedRoomState as any,
  });
  console.log(`Broadcasted player-left event using io.to() to room ${roomId}. Room now has ${freshRoomState.players.length} players. Broadcast sent to ${socketsInRoomForBroadcast.length} sockets.`);

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
        
        if (joinedPlayer) {
          console.log(`Broadcasting player-joined event to room ${room.id} for player ${socket.id} (name: ${joinedPlayer.name || 'none'})`);
          // Use io.to() which sends to ALL sockets in the room (not just excluding the sender)
          io.to(room.id).emit('player-joined', {
            player: {
              ...joinedPlayer,
              joined_at: joinedPlayer.joined_at instanceof Date 
                ? joinedPlayer.joined_at.toISOString() 
                : (joinedPlayer.joined_at as any),
            },
            room: formattedRoomState as any,
          });
          console.log(`Broadcasted player-joined event to room ${room.id} with ${freshRoomState.players.length} total players`);
        } else {
          console.log(`Warning: Could not find joined player ${socket.id} in room state, but broadcasting anyway`);
          // Broadcast anyway with the fresh room state so all players stay in sync
          io.to(room.id).emit('player-joined', {
            player: {
              id: 'unknown',
              room_id: room.id,
              name: null,
              socket_id: socket.id,
              joined_at: new Date().toISOString(),
            },
            room: formattedRoomState as any,
          });
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


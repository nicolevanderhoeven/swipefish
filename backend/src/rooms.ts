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

  // Get list of remaining players BEFORE removing (so we know who to notify)
  const remainingPlayersBeforeRemoval = roomStateBeforeRemoval?.players.filter(p => p.socket_id !== socketId) || [];

  // Get list of sockets in room BEFORE removing the leaving socket
  // This ensures we capture all sockets that should receive the event
  const socketsInRoomBeforeRemoval = await io.in(roomId).fetchSockets();
  console.log(`Sockets in room before removal: ${socketsInRoomBeforeRemoval.length}`, socketsInRoomBeforeRemoval.map(s => s.id));

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

  console.log(`About to broadcast player-left to room ${roomId}. Sockets in room before removal: ${socketsInRoomBeforeRemoval.length}`, socketsInRoomBeforeRemoval.map(s => s.id));
  console.log(`Remaining players in database: ${freshRoomState.players.length}`, freshRoomState.players.map(p => ({ socketId: p.socket_id, name: p.name })));
  
  // Broadcast player left to all remaining players
  // Send directly to each player's socket by socket ID (from database)
  // This ensures all players receive the event even if their socket isn't in the socket.io room
  console.log(`Broadcasting player-left event to room ${roomId} (${freshRoomState.players.length} remaining players)`);
  
  const playerLeftEvent = {
    socketId: socketId,
    room: formattedRoomState as any,
  };
  
  // Send directly to each remaining player's socket from the database
  let sentCount = 0;
  for (const player of freshRoomState.players) {
    const targetSocket = io.sockets.sockets.get(player.socket_id);
    if (targetSocket) {
      targetSocket.emit('player-left', playerLeftEvent);
      sentCount++;
      console.log(`Sent player-left event directly to socket ${player.socket_id}`);
    } else {
      console.log(`Warning: Socket ${player.socket_id} not found (may have disconnected)`);
    }
  }
  
  // Also send to all sockets in the socket.io room (even if not in database)
  // This handles cases where a socket is in the room but not in the database
  // (e.g., if they were cleaned up but are still connected)
  // Use the sockets we captured BEFORE removal to ensure we get everyone
  for (const socketInRoom of socketsInRoomBeforeRemoval) {
    // Skip the leaving socket
    if (socketInRoom.id === socketId) {
      continue;
    }
    // Skip if we already sent to this socket (from database list)
    if (freshRoomState.players.some(p => p.socket_id === socketInRoom.id)) {
      continue;
    }
    // Send to this socket even though it's not in the database
    socketInRoom.emit('player-left', playerLeftEvent);
    sentCount++;
    console.log(`Sent player-left event to socket ${socketInRoom.id} (in room but not in database)`);
  }
  
  // Also send to players from BEFORE removal (in case they were in DB but got cleaned up)
  // This is a fallback to ensure we notify everyone who was in the room
  for (const player of remainingPlayersBeforeRemoval) {
    // Skip if we already sent to this socket
    if (freshRoomState.players.some(p => p.socket_id === player.socket_id)) {
      continue;
    }
    if (socketsInRoomBeforeRemoval.some(s => s.id === player.socket_id)) {
      continue; // Already sent above
    }
    const targetSocket = io.sockets.sockets.get(player.socket_id);
    if (targetSocket) {
      targetSocket.emit('player-left', playerLeftEvent);
      sentCount++;
      console.log(`Sent player-left event to socket ${player.socket_id} (was in DB before removal)`);
    }
  }
  
  // Also broadcast to the room as a final fallback
  io.to(roomId).emit('player-left', playerLeftEvent);
  
  console.log(`Broadcasted player-left event to room ${roomId}. Room now has ${freshRoomState.players.length} players. Sent directly to ${sentCount} sockets, also broadcast to room (${socketsInRoomBeforeRemoval.length} sockets in room before removal).`);

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
          
          // According to best practices: Use multi-layered event delivery
          // 1. Send directly to sockets from database
          // 2. Send to all sockets in socket.io room (even if not in database)
          // 3. Broadcast to room as final fallback
          
          let sentCount = 0;
          const sentToSocketIds = new Set<string>();
          
          // Strategy 1: Send directly to sockets from database
          for (const player of freshRoomState.players) {
            // Don't send to the joining player (they already got join-room-response)
            if (player.socket_id === socket.id) {
              continue;
            }
            const targetSocket = io.sockets.sockets.get(player.socket_id);
            if (targetSocket) {
              targetSocket.emit('player-joined', playerJoinedEvent);
              sentToSocketIds.add(player.socket_id);
              sentCount++;
              console.log(`Sent player-joined event directly to socket ${player.socket_id} (from database)`);
            } else {
              console.log(`Warning: Socket ${player.socket_id} not found (may have disconnected, but keeping in database in case they reconnect)`);
            }
          }
          
          // Strategy 2: Send to ALL sockets in the socket.io room (even if not in database)
          // CRITICAL: This ensures P1 receives the event even if their socket is in the room
          // but their socket_id in the database is stale (from a previous connection)
          // This is the key fix per best practices - we must send to all room sockets
          // Use the updated room socket list after rejoining any disconnected sockets
          for (const socketInRoom of socketsInRoomAfterRejoin) {
            // Skip the joining socket (they already got join-room-response)
            if (socketInRoom.id === socket.id) {
              continue;
            }
            // Skip if we already sent to this socket (from database list above)
            if (sentToSocketIds.has(socketInRoom.id)) {
              continue;
            }
            // Send to this socket even though it's not in the database
            // This handles the case where P1 reconnected with a new socket_id
            // but their old socket_id is still in the database
            socketInRoom.emit('player-joined', playerJoinedEvent);
            sentToSocketIds.add(socketInRoom.id);
            sentCount++;
            console.log(`Sent player-joined event to socket ${socketInRoom.id} (in room but not in database - ensures P1 gets event)`);
          }
          
          
          // Also broadcast to the room as a final fallback
          io.to(room.id).emit('player-joined', playerJoinedEvent);
          
          console.log(`Broadcasted player-joined event to room ${room.id} with ${freshRoomState.players.length} total players. Sent directly to ${sentCount} sockets, also broadcast to room (${socketsInRoomAfterRejoin.length} sockets in room after rejoin).`);
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


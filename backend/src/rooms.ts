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
} from './db';
import { generatePassphrase } from './passphrase';
import { RoomState } from './types';

// In-memory room state for active rooms
const activeRooms = new Map<string, RoomState>();

async function removePlayerFromRoom(socketId: string, io: Server, socket?: Socket): Promise<void> {
  // Find which room this player is in
  let roomId: string | null = null;
  let roomState: RoomState | null = null;

  for (const [id, state] of activeRooms.entries()) {
    const playerIndex = state.players.findIndex((p) => p.socket_id === socketId);
    if (playerIndex !== -1) {
      roomId = id;
      roomState = state;
      break;
    }
  }

  if (!roomId || !roomState) {
    // Player not in any room, just remove from database
    await removePlayer(socketId);
    return;
  }

  // Remove player from database
  await removePlayer(socketId);
  console.log(`Removed player ${socketId} from database`);

  // Remove player from in-memory state
  const playerIndex = roomState.players.findIndex((p) => p.socket_id === socketId);
  if (playerIndex !== -1) {
    roomState.players.splice(playerIndex, 1);
    console.log(`Removed player from in-memory state. Remaining players: ${roomState.players.length}`);
  }

  // Format room state for JSON serialization (convert dates to strings)
  const formattedRoomState: RoomState = {
    room: {
      ...roomState.room,
      created_at: roomState.room.created_at instanceof Date 
        ? roomState.room.created_at.toISOString() 
        : (roomState.room.created_at as any),
    },
    players: roomState.players.map(p => ({
      ...p,
      joined_at: p.joined_at instanceof Date 
        ? p.joined_at.toISOString() 
        : (p.joined_at as any),
    })),
  };

  // Broadcast player left to all remaining players in the room (BEFORE removing socket from room)
  console.log(`Broadcasting player-left event to room ${roomId} (${roomState.players.length} remaining players)`);
  io.to(roomId).emit('player-left', {
    socketId: socketId,
    room: formattedRoomState as any,
  });
  console.log(`Broadcasted player-left event. Room now has ${roomState.players.length} players`);

  // Remove socket from socket.io room AFTER broadcasting
  if (socket) {
    socket.leave(roomId);
    console.log(`Socket ${socketId} left socket.io room ${roomId}`);
  }

  // Clean up empty rooms
  if (roomState.players.length === 0) {
    activeRooms.delete(roomId);
    console.log(`Room ${roomId} is now empty, removed from memory`);
  }

  // Periodic cleanup of empty rooms in database
  await cleanupEmptyRooms();
}

export function initializeRoomHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('create-room', async () => {
      try {
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

        // Add creator as first player
        const player = await addPlayerToRoom(room.id, socket.id);

        // Add to in-memory state
        const roomState: RoomState = {
          room,
          players: [player],
        };
        activeRooms.set(room.id, roomState);

        // Join socket room for this game room
        socket.join(room.id);

        // Send response with full room state
        socket.emit('create-room-response', {
          success: true,
          passphrase,
          room: roomState,
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

        // Add player to database
        const player = await addPlayerToRoom(room.id, socket.id, name);
        console.log(`Added player ${player.id} to room ${room.id}`);

        // Update in-memory state
        let roomState = activeRooms.get(room.id);
        if (!roomState) {
          console.log(`Room ${room.id} not in memory, loading from database`);
          const dbRoomState = await getRoomWithPlayers(room.id);
          if (dbRoomState) {
            roomState = dbRoomState;
            activeRooms.set(room.id, roomState);
            console.log(`Loaded room state from database with ${roomState.players.length} players`);
          } else {
            console.error(`Failed to load room state from database for room ${room.id}`);
            socket.emit('join-room-response', {
              success: false,
              error: 'Failed to load room state',
            });
            return;
          }
        }

        // Add player to room state if not already present
        const alreadyInRoom = roomState.players.find((p) => p.socket_id === socket.id);
        if (!alreadyInRoom) {
          roomState.players.push(player);
          console.log(`Added player to in-memory state. Total players: ${roomState.players.length}`);
        } else {
          console.log(`Player ${socket.id} already in room state`);
        }

        // Join socket room
        socket.join(room.id);
        console.log(`Socket ${socket.id} joined socket.io room ${room.id}`);

        // Format room state for JSON serialization (convert dates to strings)
        const formattedRoomState: RoomState = {
          room: {
            ...roomState.room,
            created_at: roomState.room.created_at instanceof Date 
              ? roomState.room.created_at.toISOString() 
              : (roomState.room.created_at as any),
          },
          players: roomState.players.map(p => ({
            ...p,
            joined_at: p.joined_at instanceof Date 
              ? p.joined_at.toISOString() 
              : (p.joined_at as any),
          })),
        };

        // Notify the joining player
        socket.emit('join-room-response', {
          success: true,
          room: formattedRoomState as any,
        });
        console.log(`Sent join-room-response to ${socket.id}`);

        // Only broadcast if this is a new player joining (not the creator)
        if (!alreadyInRoom) {
          // Format room state for JSON serialization
          const formattedRoomStateForBroadcast: RoomState = {
            room: {
              ...roomState.room,
              created_at: roomState.room.created_at instanceof Date 
                ? roomState.room.created_at.toISOString() 
                : (roomState.room.created_at as any),
            },
            players: roomState.players.map(p => ({
              ...p,
              joined_at: p.joined_at instanceof Date 
                ? p.joined_at.toISOString() 
                : (p.joined_at as any),
            })),
          };
          
          io.to(room.id).emit('player-joined', {
            player: {
              ...player,
              joined_at: player.joined_at instanceof Date 
                ? player.joined_at.toISOString() 
                : (player.joined_at as any),
            },
            room: formattedRoomStateForBroadcast as any,
          });
          console.log(`Broadcasted player-joined event to room ${room.id}`);
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


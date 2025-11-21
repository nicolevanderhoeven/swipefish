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

        // Add to in-memory state
        const roomState: RoomState = {
          room,
          players: [],
        };
        activeRooms.set(room.id, roomState);

        socket.emit('create-room-response', {
          success: true,
          passphrase,
        });

        // Join socket room for this game room
        socket.join(room.id);
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
          socket.emit('join-room-response', {
            success: false,
            error: 'Room not found',
          });
          return;
        }

        // Add player to database
        const player = await addPlayerToRoom(room.id, socket.id, name);

        // Update in-memory state
        let roomState = activeRooms.get(room.id);
        if (!roomState) {
          const dbRoomState = await getRoomWithPlayers(room.id);
          if (dbRoomState) {
            roomState = dbRoomState;
            activeRooms.set(room.id, roomState);
          } else {
            socket.emit('join-room-response', {
              success: false,
              error: 'Failed to load room state',
            });
            return;
          }
        }

        // Add player to room state if not already present
        if (!roomState.players.find((p) => p.socket_id === socket.id)) {
          roomState.players.push(player);
        }

        // Join socket room
        socket.join(room.id);

        // Notify the joining player
        socket.emit('join-room-response', {
          success: true,
          room: roomState,
        });

        // Broadcast to all players in the room
        io.to(room.id).emit('player-joined', {
          player,
          room: roomState,
        });
      } catch (error) {
        console.error('Error joining room:', error);
        socket.emit('join-room-response', {
          success: false,
          error: 'Failed to join room',
        });
      }
    });

    socket.on('disconnect', async () => {
      try {
        // Remove player from database
        await removePlayer(socket.id);

        // Update in-memory state
        for (const [roomId, roomState] of activeRooms.entries()) {
          const playerIndex = roomState.players.findIndex((p) => p.socket_id === socket.id);
          if (playerIndex !== -1) {
            roomState.players.splice(playerIndex, 1);

            // Broadcast player left
            io.to(roomId).emit('player-left', {
              socketId: socket.id,
              room: roomState,
            });

            // Clean up empty rooms
            if (roomState.players.length === 0) {
              activeRooms.delete(roomId);
            }
            break;
          }
        }

        // Periodic cleanup of empty rooms in database
        await cleanupEmptyRooms();

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


# Architectural Simplification: Single Source of Truth

## Problem Statement

The current architecture has fundamental issues:
1. **Socket ID mismatch**: Database stores `socket_id`, but socket IDs change on reconnection
2. **Room membership sync issues**: Socket.io rooms and database can get out of sync
3. **Complex delivery logic**: Multiple strategies (direct by ID, room sockets, broadcast) are error-prone
4. **No single source of truth**: Unclear who should receive events

## Solution: Simplified Architecture

### Core Principle: Separation of Concerns

- **Database = Source of Truth for Room State** (who SHOULD be in the room)
- **Socket.io Room = Delivery Mechanism** (who CAN receive events)
- **Event Payload = Current Room State from Database** (what everyone should see)

### Key Changes

1. **Always broadcast to ALL sockets in socket.io room**
   - Don't try to match socket_ids between database and socket.io
   - Just send to everyone in the room
   - The event payload contains the authoritative room state from database

2. **Ensure sockets are in room before broadcasting**
   - Before broadcasting, ensure all connected players' sockets are in the socket.io room
   - This guarantees delivery to all intended recipients

3. **Simplified event delivery**
   - Single strategy: Broadcast to socket.io room
   - Event contains fresh room state from database
   - Frontend updates based on event payload

### Implementation

```typescript
// When broadcasting player-joined:
// 1. Get fresh room state from database (single source of truth)
const roomState = await getRoomWithPlayers(roomId);

// 2. Ensure all connected players' sockets are in the room
for (const player of roomState.players) {
  const socket = io.sockets.sockets.get(player.socket_id);
  if (socket) {
    socket.join(roomId); // Ensure in room
  }
}

// 3. Format the event with room state from database
const event = {
  room: formatRoomState(roomState), // From database - single source of truth
  player: joinedPlayer,
};

// 4. Broadcast to ALL sockets in socket.io room
// Don't try to match socket_ids - just send to everyone
io.to(roomId).emit('player-joined', event);
```

### Benefits

1. **Single source of truth**: Database always has the correct room state
2. **Simpler logic**: One delivery method instead of multiple strategies
3. **More resilient**: Works even if socket_ids don't match
4. **Easier to debug**: Clear separation between state and delivery
5. **Reliable delivery**: All sockets in room receive events

### Migration Status

✅ Implemented:
- Database as source of truth (already done)
- Simplified broadcasting to use socket.io room
- Removed complex socket_id matching logic
- Ensure all sockets join room when they emit join-room
- Ensure sockets are in room before broadcasting


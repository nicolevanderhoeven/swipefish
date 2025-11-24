# Real-Time Synchronization Architecture

## Problem Statement

When a player leaves a room, other players may not see the update due to:
1. **Socket.io room membership drift**: Sockets can disconnect/reconnect, losing room membership
2. **Socket ID changes**: On reconnection, sockets get new IDs, causing database/socket.io mismatches
3. **Timing issues**: Events broadcast before sockets rejoin rooms

## Current Solution: Multi-Layered Delivery

### Implementation

We use a **dual-strategy approach** to ensure reliable event delivery:

1. **Primary**: Broadcast to socket.io room
   - Fast and efficient for normal cases
   - Requires sockets to be in the room

2. **Fallback**: Direct socket emission
   - Ensures delivery even if socket.io room membership is out of sync
   - Uses database as source of truth for who should receive events

### Key Fix in `removePlayerFromRoom`

```typescript
// 1. Remove player from database (single source of truth)
await removePlayer(socketId);

// 2. Get fresh room state (without the leaving player)
const freshRoomState = await getRoomWithPlayers(roomId);

// 3. CRITICAL: Ensure all remaining players' sockets are in socket.io room
for (const player of freshRoomState.players) {
  const targetSocket = io.sockets.sockets.get(player.socket_id);
  if (targetSocket) {
    targetSocket.join(roomId); // Rejoin if needed
  }
}

// 4. Multi-layered delivery
io.to(roomId).emit('player-left', event); // Primary
for (const player of freshRoomState.players) {
  targetSocket.emit('player-left', event); // Fallback
}
```

## Architectural Alternatives

### 1. WebSockets (Current) ✅

**Pros:**
- Low latency (real-time)
- Bidirectional communication
- Efficient for frequent updates
- Well-supported libraries (Socket.io)

**Cons:**
- Connection state management complexity
- Socket ID changes on reconnection
- Room membership can drift
- Requires fallback strategies

**Best for:** Real-time games, collaborative apps, live updates

### 2. Server-Sent Events (SSE)

**Pros:**
- Simpler than WebSockets (HTTP-based)
- Automatic reconnection handling
- Unidirectional (server → client) is fine for many use cases

**Cons:**
- Unidirectional (client must use HTTP for actions)
- Less efficient for bidirectional communication
- Browser connection limits

**Best for:** Live feeds, notifications, one-way updates

### 3. Polling

**Pros:**
- Extremely simple
- Works everywhere
- No connection state issues

**Cons:**
- Higher latency
- Higher server load
- Not real-time

**Best for:** Simple apps, low-frequency updates

### 4. Hybrid: WebSockets + Periodic Sync

**Approach:**
- Use WebSockets for real-time updates
- Periodically sync room state (every 5-10 seconds)
- Handles edge cases and drift

**Implementation:**
```typescript
// Client-side: Request room state periodically
setInterval(() => {
  socket.emit('sync-room-state', { roomId });
}, 5000);

// Server-side: Send current room state
socket.on('sync-room-state', async ({ roomId }) => {
  const roomState = await getRoomWithPlayers(roomId);
  socket.emit('room-state-sync', roomState);
});
```

**Pros:**
- Handles all edge cases
- Self-healing
- Redundant delivery ensures no missed updates

**Cons:**
- Slightly more complex
- Extra network traffic

### 5. State Management with Versioning

**Approach:**
- Each room state has a version number
- Clients request updates if their version is stale
- Server sends diffs or full state

**Pros:**
- Handles missed updates elegantly
- Can detect conflicts
- Works well with optimistic UI

**Cons:**
- More complex implementation
- Requires version tracking

## How Other Apps Handle This

### Discord/Slack
- WebSockets for real-time
- Periodic state sync
- Reconnection handling with session tokens
- Client-side state reconciliation

### Google Docs
- Operational Transform (OT) or CRDTs
- Version vectors for conflict resolution
- Periodic full sync as fallback

### Multiplayer Games (e.g., Among Us)
- Authoritative server model
- Client prediction with server reconciliation
- Periodic state snapshots
- Heartbeat/keepalive to detect disconnections

## Recommendations for Swipe.fish

### Current Approach (Recommended)
✅ **WebSockets with multi-layered delivery** - Good balance of simplicity and reliability

### Potential Enhancements

1. **Add periodic room state sync** (every 10 seconds)
   - Self-healing for edge cases
   - Low overhead
   - Simple to implement

2. **Add heartbeat/ping mechanism**
   - Detect stale connections
   - Clean up disconnected players proactively

3. **Client-side reconnection handling**
   - On reconnect, immediately rejoin room
   - Request latest room state

4. **Consider session tokens**
   - Map multiple socket IDs to same player
   - Handle reconnections more gracefully

## Testing the Fix

To verify the fix works:

1. P1 creates room
2. P2 joins room (both see 2 players)
3. P1 leaves room
4. **Expected**: P2 sees only P2 in room
5. **Also test**: P2 disconnects/reconnects, then P1 leaves

The fix ensures:
- Remaining players' sockets are in socket.io room before broadcast
- Direct socket emission as fallback
- Database is single source of truth


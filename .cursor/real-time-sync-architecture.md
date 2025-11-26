# Real-Time Synchronization Architecture

## Problem Statement

When a player leaves a room, other players may not see the update due to:
1. **Socket.io room membership drift**: Sockets can disconnect/reconnect, losing room membership
2. **Socket ID changes**: On reconnection, sockets get new IDs, causing database/socket.io mismatches
3. **Timing issues**: Events broadcast before sockets rejoin rooms

When assigning roles to players, similar issues occur:
1. **Socket ID mismatches**: Players reconnect with new socket IDs, roles can't be matched
2. **In-memory storage**: Roles stored in memory are lost if not immediately delivered
3. **Complex matching logic**: Trying to match sockets to players is error-prone

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

## Role Assignment Implementation

### Problem
When assigning roles to players at game start, some players didn't receive their roles due to:
- Socket ID mismatches (players reconnecting with new socket IDs)
- Timing issues (roles sent before all sockets were ready)
- In-memory storage (roles lost if not matched immediately)

### Solution: Database-Backed Role Storage

**Key Decision**: Store roles in the database, not in memory.

```typescript
// ✅ GOOD: Store in database
await updatePlayerRole(playerId, role);

// ❌ BAD: Store in memory
roleAssignments.set(roomId, roleMap);
```

**Why Database Storage:**
1. **Persistence**: Roles survive server restarts and reconnections
2. **Single Source of Truth**: Database is authoritative, just like rooms/players
3. **Simpler Sync**: Read directly from `player.role` during sync, no complex matching
4. **Consistency**: Same pattern as other game state (rooms, players)

### Implementation Pattern

```typescript
// 1. Assign roles and store in database
for (const player of players) {
  const role = assignRole(player);
  await updatePlayerRole(player.id, role); // Store in DB
}

// 2. Send roles via socket events (with fallbacks)
for (const player of players) {
  socket.emit('role-assigned', { role: player.role });
}

// 3. During sync, read from database
if (room.status === 'active') {
  const player = players.find(p => p.socket_id === socket.id);
  if (player?.role) {
    socket.emit('role-assigned', { role: player.role });
  }
}
```

### Best Practices Learned

1. **Use Stable Identifiers**
   - Store roles by `player.id` (stable), not `socket_id` (changes on reconnect)
   - When matching reconnected players, update their `socket_id` in the database
   - Database foreign keys use stable IDs (`player.id`), not ephemeral ones (`socket_id`)

2. **Database as Single Source of Truth**
   - All game state should be in the database (rooms, players, roles)
   - Memory caches are for performance, not persistence
   - Always read fresh from database during sync
   - If it's important enough to sync, it should be in the database

3. **Dual Delivery Strategy**
   - Send roles via dedicated `role-assigned` event (primary)
   - Also include in `game-started` fallback (secondary)
   - Periodic sync picks up missed roles automatically (tertiary)
   - Multiple delivery paths ensure reliability

4. **Handle Reconnections Gracefully**
   - When player not found by `socket_id` during sync:
     - Find players with stale (disconnected) socket_ids
     - Match unmatched sockets to stale players (by index if multiple)
     - Update `socket_id` in database immediately
     - Read role from database and send
   - This pattern works for any state that needs to survive reconnections

5. **Periodic Sync is Essential**
   - Sync every 1 second ensures missed events are recovered quickly
   - Self-healing mechanism catches edge cases
   - Low overhead for small-scale games (~1 request/second per player)
   - Include all relevant state in sync response (room status, player list, roles)

6. **Schema Design Principles**
   - Add columns to existing tables when data belongs to that entity (e.g., `role` in `players` table)
   - Use nullable columns for optional/transient state
   - Migration-friendly: use `ADD COLUMN IF NOT EXISTS` for backward compatibility

## Recommendations for Swipe.fish

### Current Approach (Recommended)
✅ **WebSockets with multi-layered delivery + periodic sync** - Good balance of simplicity and reliability

### Implemented Features

1. **Periodic room state sync** (every 1 second) ✅
   - Self-healing for edge cases
   - Near-instant state correction
   - Low overhead for small-scale games (~1 request/second per player)
   - Automatically recovers missed role assignments

2. **Database-backed role storage** ✅
   - Roles stored in `players.role` column
   - Persistent across reconnections and server restarts
   - Read directly from database during sync
   - Consistent with other game state storage

3. **Multi-layered event delivery** ✅
   - Broadcast to socket.io room (primary)
   - Direct socket emission (fallback)
   - Periodic sync (self-healing)

### Potential Enhancements

1. **Add heartbeat/ping mechanism**
   - Detect stale connections
   - Clean up disconnected players proactively

2. **Client-side reconnection handling**
   - On reconnect, immediately rejoin room
   - Request latest room state

3. **Consider session tokens**
   - Map multiple socket IDs to same player
   - Handle reconnections more gracefully

## Testing the Fix

### Player Join/Leave Sync
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

### Role Assignment Sync
To verify role assignment works:

1. P1, P2, P3 join room
2. P3 starts game
3. **Expected**: All 3 players see game is active
4. **Expected**: All 3 players receive their role (Swiper, Swipefish, Match)
5. **Also test**: One player disconnects/reconnects after game starts
6. **Expected**: Reconnected player receives their role via periodic sync

The implementation ensures:
- Roles stored in database (persistent)
- Roles sent via socket events (real-time)
- Roles recovered via periodic sync (self-healing)
- Socket ID updates handled gracefully (reconnection support)


import { Pool, QueryResult } from 'pg';
import { Room, Player } from './types';

let pool: Pool | null = null;

export function initDatabase(connectionString: string): void {
  if (pool) {
    console.log('Database already initialized, reusing existing pool');
    return;
  }

  // For internal cluster connections, disable SSL
  // Only use SSL if explicitly required in connection string
  const useSSL = connectionString.includes('sslmode=require') || connectionString.includes('ssl=true');
  
  pool = new Pool({
    connectionString,
    ssl: useSSL ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    // Don't set pool to null on error - let it try to reconnect
  });

  pool.on('connect', () => {
    console.log('Database client connected');
  });

  console.log('Database pool initialized');
}

export function ensurePoolInitialized(): Pool {
  if (!pool) {
    console.error('Database pool is null! Attempting to reinitialize...');
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl) {
      initDatabase(databaseUrl);
    } else {
      throw new Error('Database not initialized and DATABASE_URL not available');
    }
  }
  if (!pool) {
    throw new Error('Failed to initialize database pool');
  }
  return pool;
}

export async function createTables(): Promise<void> {
  const dbPool = ensurePoolInitialized();

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      passphrase VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      status VARCHAR(50) DEFAULT 'waiting'
    )
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      name VARCHAR(255),
      socket_id VARCHAR(255) NOT NULL,
      joined_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(room_id, socket_id)
    )
  `);

  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS idx_players_room_id ON players(room_id)
  `);

  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rooms_passphrase ON rooms(passphrase)
  `);
}

export async function createRoom(passphrase: string): Promise<Room> {
  const dbPool = ensurePoolInitialized();

  const result = await dbPool.query<Room>(
    'INSERT INTO rooms (passphrase) VALUES ($1) RETURNING *',
    [passphrase]
  );

  return result.rows[0];
}

export async function findRoomByPassphrase(passphrase: string): Promise<Room | null> {
  const dbPool = ensurePoolInitialized();

  try {
    const result = await dbPool.query<Room>(
      'SELECT * FROM rooms WHERE passphrase = $1',
      [passphrase]
    );

    return result.rows[0] || null;
  } catch (error) {
    console.error('Error finding room by passphrase:', error);
    throw error;
  }
}

export async function checkPassphraseExists(passphrase: string): Promise<boolean> {
  const dbPool = ensurePoolInitialized();

  const result = await dbPool.query(
    'SELECT 1 FROM rooms WHERE passphrase = $1 LIMIT 1',
    [passphrase]
  );

  return result.rows.length > 0;
}

export async function addPlayerToRoom(roomId: string, socketId: string, name?: string, io?: any): Promise<Player> {
  const dbPool = ensurePoolInitialized();

  // Check if player already exists with this socket_id
  const existingPlayer = await dbPool.query<Player>(
    'SELECT * FROM players WHERE room_id = $1 AND socket_id = $2',
    [roomId, socketId]
  );

  if (existingPlayer.rows.length > 0) {
    // Player already exists with this socket_id - only update name if a new name is explicitly provided
    if (name !== undefined && name !== null && name.trim() !== '') {
      const result = await dbPool.query<Player>(
        'UPDATE players SET name = $1 WHERE room_id = $2 AND socket_id = $3 RETURNING *',
        [name.trim(), roomId, socketId]
      );
      return result.rows[0];
    }
    // Return existing player without updating name
    return existingPlayer.rows[0];
  }

  // Check if there's a player in this room with a disconnected socket (reconnection case)
  // Only do this if we have access to io to check socket existence
  if (io) {
    const allPlayersInRoom = await dbPool.query<Player>(
      'SELECT * FROM players WHERE room_id = $1',
      [roomId]
    );

    // Find players with disconnected sockets
    for (const oldPlayer of allPlayersInRoom.rows) {
      const oldSocket = io.sockets.sockets.get(oldPlayer.socket_id);
      if (!oldSocket && oldPlayer.socket_id !== socketId) {
        // This player's socket is disconnected, and it's not the current socket
        // This is likely a reconnection - update their socket_id
        console.log(`Updating player ${oldPlayer.id} socket_id from ${oldPlayer.socket_id} to ${socketId} (reconnection)`);
        const updateResult = await dbPool.query<Player>(
          `UPDATE players SET socket_id = $1, name = COALESCE($2, name) WHERE room_id = $3 AND id = $4 RETURNING *`,
          [socketId, name?.trim() || null, roomId, oldPlayer.id]
        );
        return updateResult.rows[0];
      }
    }
  }

  // New player - insert with name
  const result = await dbPool.query<Player>(
    `INSERT INTO players (room_id, socket_id, name) 
     VALUES ($1, $2, $3) 
     RETURNING *`,
    [roomId, socketId, name || null]
  );

  return result.rows[0];
}

export async function getPlayersInRoom(roomId: string): Promise<Player[]> {
  const dbPool = ensurePoolInitialized();

  const result = await dbPool.query<Player>(
    'SELECT * FROM players WHERE room_id = $1 ORDER BY joined_at',
    [roomId]
  );

  return result.rows;
}

export async function removePlayer(socketId: string): Promise<void> {
  const dbPool = ensurePoolInitialized();

  await dbPool.query('DELETE FROM players WHERE socket_id = $1', [socketId]);
}

export async function getRoomWithPlayers(roomId: string): Promise<{ room: Room; players: Player[] } | null> {
  const dbPool = ensurePoolInitialized();

  const roomResult = await dbPool.query<Room>(
    'SELECT * FROM rooms WHERE id = $1',
    [roomId]
  );

  if (roomResult.rows.length === 0) return null;

  const players = await getPlayersInRoom(roomId);

  return {
    room: roomResult.rows[0],
    players,
  };
}

export async function cleanupEmptyRooms(): Promise<void> {
  const dbPool = ensurePoolInitialized();

  await dbPool.query(`
    DELETE FROM rooms 
    WHERE id NOT IN (SELECT DISTINCT room_id FROM players)
    AND status = 'waiting'
  `);
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}


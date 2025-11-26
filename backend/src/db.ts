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
      status VARCHAR(50) DEFAULT 'waiting',
      swiper_persona_number VARCHAR(10),
      swiper_persona_name VARCHAR(255),
      swiper_persona_tagline TEXT
    )
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      name VARCHAR(255),
      socket_id VARCHAR(255) NOT NULL,
      joined_at TIMESTAMP DEFAULT NOW(),
      role VARCHAR(50),
      UNIQUE(room_id, socket_id)
    )
  `);
  
  // Add role column if it doesn't exist (for existing databases)
  await dbPool.query(`
    ALTER TABLE players 
    ADD COLUMN IF NOT EXISTS role VARCHAR(50)
  `);

  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS idx_players_room_id ON players(room_id)
  `);

  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS idx_rooms_passphrase ON rooms(passphrase)
  `);

  // Add swiper persona columns if they don't exist (for existing databases)
  await dbPool.query(`
    ALTER TABLE rooms 
    ADD COLUMN IF NOT EXISTS swiper_persona_number VARCHAR(10)
  `);

  await dbPool.query(`
    ALTER TABLE rooms 
    ADD COLUMN IF NOT EXISTS swiper_persona_name VARCHAR(255)
  `);

  await dbPool.query(`
    ALTER TABLE rooms 
    ADD COLUMN IF NOT EXISTS swiper_persona_tagline TEXT
  `);

  // Migration: Copy data from old swiper_role_* columns to new swiper_persona_* columns if they exist
  // This handles the transition from "role" to "persona" naming
  try {
    // Check if old columns exist by trying to select from them
    const checkOldColumns = await dbPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'rooms' 
        AND column_name IN ('swiper_role_number', 'swiper_role_name', 'swiper_role_tagline')
    `);
    
    if (checkOldColumns.rows.length > 0) {
      // Old columns exist, migrate data
      const migrationResult = await dbPool.query(`
        UPDATE rooms 
        SET swiper_persona_number = swiper_role_number,
            swiper_persona_name = swiper_role_name,
            swiper_persona_tagline = swiper_role_tagline
        WHERE (swiper_persona_number IS NULL OR swiper_persona_name IS NULL OR swiper_persona_tagline IS NULL)
          AND (swiper_role_number IS NOT NULL OR swiper_role_name IS NOT NULL OR swiper_role_tagline IS NOT NULL)
      `);
      console.log(`Migration: Migrated ${migrationResult.rowCount} rooms from swiper_role_* to swiper_persona_*`);
    } else {
      console.log('Migration: Old swiper_role_* columns not found, skipping migration');
    }
  } catch (error) {
    // Ignore errors if old columns don't exist (fresh database)
    console.log('Migration: Error checking for old columns, skipping migration:', error);
  }
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

export async function addPlayerToRoom(roomId: string, socketId: string, name?: string): Promise<Player> {
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

  // NOTE: We don't handle reconnections here because it's too complex to determine
  // if a new socket_id is a reconnection or a new player. Instead, we'll create
  // a new player entry for each socket_id. Old disconnected players will be cleaned up
  // when they leave or when the room is cleaned up.

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

  // Explicitly select all columns including persona fields to ensure they're included
  const roomResult = await dbPool.query<Room>(
    `SELECT 
      id, 
      passphrase, 
      created_at, 
      status, 
      swiper_persona_number, 
      swiper_persona_name, 
      swiper_persona_tagline 
    FROM rooms WHERE id = $1`,
    [roomId]
  );

  if (roomResult.rows.length === 0) return null;

  const players = await getPlayersInRoom(roomId);

  return {
    room: roomResult.rows[0],
    players,
  };
}

export async function updateRoomStatus(roomId: string, status: 'waiting' | 'active' | 'finished'): Promise<void> {
  const dbPool = ensurePoolInitialized();

  await dbPool.query(
    'UPDATE rooms SET status = $1 WHERE id = $2',
    [status, roomId]
  );
}

export async function updatePlayerRole(playerId: string, role: 'swiper' | 'swipefish' | 'match' | null): Promise<void> {
  const dbPool = ensurePoolInitialized();

  await dbPool.query(
    'UPDATE players SET role = $1 WHERE id = $2',
    [role, playerId]
  );
}

export async function clearPlayerRolesInRoom(roomId: string): Promise<void> {
  const dbPool = ensurePoolInitialized();

  await dbPool.query(
    'UPDATE players SET role = NULL WHERE room_id = $1',
    [roomId]
  );
}

export async function updateSwiperPersona(roomId: string, personaNumber: string, personaName: string, personaTagline: string): Promise<void> {
  const dbPool = ensurePoolInitialized();

  console.log('DEBUG: updateSwiperPersona called with:', { roomId, personaNumber, personaName, personaTagline });

  const result = await dbPool.query(
    'UPDATE rooms SET swiper_persona_number = $1, swiper_persona_name = $2, swiper_persona_tagline = $3 WHERE id = $4 RETURNING swiper_persona_number, swiper_persona_name, swiper_persona_tagline',
    [personaNumber, personaName, personaTagline, roomId]
  );

  console.log('DEBUG: updateSwiperPersona result:', result.rows[0]);
  
  if (result.rowCount === 0) {
    console.error('ERROR: updateSwiperPersona - No rows updated for roomId:', roomId);
  }
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


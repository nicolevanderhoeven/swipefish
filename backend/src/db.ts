import { Pool, QueryResult } from 'pg';
import { Room, Player } from './types';

let pool: Pool | null = null;

export function initDatabase(connectionString: string): void {
  pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
  });
}

export async function createTables(): Promise<void> {
  if (!pool) throw new Error('Database not initialized');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      passphrase VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      status VARCHAR(50) DEFAULT 'waiting'
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      name VARCHAR(255),
      socket_id VARCHAR(255) NOT NULL,
      joined_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(room_id, socket_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_players_room_id ON players(room_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_rooms_passphrase ON rooms(passphrase)
  `);
}

export async function createRoom(passphrase: string): Promise<Room> {
  if (!pool) throw new Error('Database not initialized');

  const result = await pool.query<Room>(
    'INSERT INTO rooms (passphrase) VALUES ($1) RETURNING *',
    [passphrase]
  );

  return result.rows[0];
}

export async function findRoomByPassphrase(passphrase: string): Promise<Room | null> {
  if (!pool) throw new Error('Database not initialized');

  const result = await pool.query<Room>(
    'SELECT * FROM rooms WHERE passphrase = $1',
    [passphrase]
  );

  return result.rows[0] || null;
}

export async function checkPassphraseExists(passphrase: string): Promise<boolean> {
  if (!pool) throw new Error('Database not initialized');

  const result = await pool.query(
    'SELECT 1 FROM rooms WHERE passphrase = $1 LIMIT 1',
    [passphrase]
  );

  return result.rows.length > 0;
}

export async function addPlayerToRoom(roomId: string, socketId: string, name?: string): Promise<Player> {
  if (!pool) throw new Error('Database not initialized');

  const result = await pool.query<Player>(
    `INSERT INTO players (room_id, socket_id, name) 
     VALUES ($1, $2, $3) 
     ON CONFLICT (room_id, socket_id) 
     DO UPDATE SET name = COALESCE(EXCLUDED.name, players.name)
     RETURNING *`,
    [roomId, socketId, name || null]
  );

  return result.rows[0];
}

export async function getPlayersInRoom(roomId: string): Promise<Player[]> {
  if (!pool) throw new Error('Database not initialized');

  const result = await pool.query<Player>(
    'SELECT * FROM players WHERE room_id = $1 ORDER BY joined_at',
    [roomId]
  );

  return result.rows;
}

export async function removePlayer(socketId: string): Promise<void> {
  if (!pool) throw new Error('Database not initialized');

  await pool.query('DELETE FROM players WHERE socket_id = $1', [socketId]);
}

export async function getRoomWithPlayers(roomId: string): Promise<{ room: Room; players: Player[] } | null> {
  if (!pool) throw new Error('Database not initialized');

  const roomResult = await pool.query<Room>(
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
  if (!pool) throw new Error('Database not initialized');

  await pool.query(`
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


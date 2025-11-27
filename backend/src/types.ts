export interface Room {
  id: string;
  passphrase: string;
  created_at: Date;
  status: 'waiting' | 'active' | 'finished';
  swiper_persona_number?: string | null;
  swiper_persona_name?: string | null;
  swiper_persona_tagline?: string | null;
}

export interface Player {
  id: string;
  room_id: string;
  name: string;
  socket_id: string;
  joined_at: Date;
  role?: PlayerRole | null;
}

export interface RoomState {
  room: Room;
  players: Player[];
}

export interface CreateRoomResponse {
  success: boolean;
  passphrase?: string;
  error?: string;
}

export interface JoinRoomResponse {
  success: boolean;
  room?: RoomState;
  error?: string;
}

export interface GameStartedEvent {
  room: RoomState;
}

export interface StartGameResponse {
  success: boolean;
  room?: RoomState;
  error?: string;
}

export type PlayerRole = 'swiper' | 'swipefish' | 'match';

export interface RoleAssignmentEvent {
  role: PlayerRole;
}


export interface Room {
  id: string;
  passphrase: string;
  created_at: string;
  status: 'waiting' | 'active' | 'finished';
  swiper_persona_number?: string | null;
  swiper_persona_name?: string | null;
  swiper_persona_tagline?: string | null;
}

export interface Player {
  id: string;
  room_id: string;
  name: string | null;
  socket_id: string;
  joined_at: string;
  role?: PlayerRole | null;
}

export interface RoomState {
  room: Room;
  players: Player[];
}

export interface CreateRoomResponse {
  success: boolean;
  passphrase?: string;
  room?: RoomState;
  error?: string;
}

export interface JoinRoomResponse {
  success: boolean;
  room?: RoomState;
  error?: string;
}

export interface PlayerJoinedEvent {
  player: Player;
  room: RoomState;
}

export interface PlayerLeftEvent {
  socketId: string;
  room: RoomState;
}

export interface RoomStateSyncResponse {
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


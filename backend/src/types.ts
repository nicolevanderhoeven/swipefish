export interface Room {
  id: string;
  passphrase: string;
  created_at: Date;
  status: 'waiting' | 'active' | 'finished';
}

export interface Player {
  id: string;
  room_id: string;
  name: string;
  socket_id: string;
  joined_at: Date;
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


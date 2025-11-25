import { Player } from '../types';
import './PlayerList.css';

interface PlayerListProps {
  players: Player[];
  currentSocketId?: string;
}

export function PlayerList({ players, currentSocketId }: PlayerListProps) {
  if (players.length === 0) {
    return (
      <div className="player-list">
        <p className="empty-message">Waiting for players to join...</p>
      </div>
    );
  }

  return (
    <div className="player-list">
      <h3 className="player-list-title">Players ({players.length}/7)</h3>
      <ul className="player-list-items">
        {players.map((player) => (
          <li
            key={player.id}
            className={`player-item ${player.socket_id === currentSocketId ? 'player-item-current' : ''}`}
          >
            {player.name || `Player ${player.id.slice(0, 8)}`}
            {player.socket_id === currentSocketId && (
              <span className="player-badge">You</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}


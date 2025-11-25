import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPlayerName, setPlayerName, isFantasyName, getFreshFantasyName } from '../utils/playerName';
import './LandingPage.css';

export function LandingPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');

  useEffect(() => {
    // Check if user has explicitly set a name
    const isUserSet = localStorage.getItem('swipefish_player_name_user_set') === 'true';
    
    if (isUserSet) {
      // User has set a name, use it
      setName(getPlayerName());
    } else {
      // Clear any previously stored fantasy name and generate a fresh random one for this page load
      localStorage.removeItem('swipefish_player_name');
      const freshName = getFreshFantasyName();
      setName(freshName);
      // Store it temporarily so it's consistent across pages in this session
      // (but will be cleared on next landing page visit)
      localStorage.setItem('swipefish_player_name', freshName);
    }
  }, []);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setName(newName);
    setPlayerName(newName);
  };

  return (
    <div className="landing-page">
      <div className="landing-content">
        <img 
          src="/img/swipefish_logo.png" 
          alt="Swipefish Logo" 
          className="landing-logo"
        />
        <h1 className="landing-title">Swipefish</h1>
        <p className="landing-subtitle">Dating, deception, and disastrously mismatched profiles</p>
        
        <div className="landing-form">
          <div className="form-group">
            <label htmlFor="player-name">Your Name (Optional)</label>
            <input
              id="player-name"
              type="text"
              value={name}
              onChange={handleNameChange}
              placeholder="Enter your name"
              autoComplete="name"
              className={`landing-input ${isFantasyName(name) ? 'landing-input-fantasy' : ''}`}
            />
          </div>
        </div>
        
        <div className="landing-buttons">
          <button
            className="landing-button landing-button-primary"
            onClick={() => navigate('/create-room')}
          >
            Create Room
          </button>
          <button
            className="landing-button landing-button-secondary"
            onClick={() => navigate('/join-room')}
          >
            Join Room
          </button>
        </div>
      </div>
    </div>
  );
}


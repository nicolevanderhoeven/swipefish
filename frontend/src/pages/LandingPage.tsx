import { useNavigate } from 'react-router-dom';
import './LandingPage.css';

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="landing-page">
      <div className="landing-content">
        <h1 className="landing-title">Swipefish</h1>
        <p className="landing-subtitle">A social deduction game for 3 players</p>
        
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


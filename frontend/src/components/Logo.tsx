import { useNavigate } from 'react-router-dom';
import { useSocket } from '../contexts/SocketContext';
import './Logo.css';

interface LogoProps {
  onLeaveRoom?: () => void;
}

export function Logo({ onLeaveRoom }: LogoProps) {
  const navigate = useNavigate();
  const { socket } = useSocket();

  const handleClick = () => {
    // If there's a custom leave handler, use it
    if (onLeaveRoom) {
      onLeaveRoom();
    } else {
      // Otherwise, emit leave-room event if socket is connected
      if (socket) {
        socket.emit('leave-room');
      }
      navigate('/');
    }
  };

  return (
    <img
      src="/img/swipefish_logo.png"
      alt="Swipefish Logo"
      className="logo-header"
      onClick={handleClick}
    />
  );
}


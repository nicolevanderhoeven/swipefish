const PLAYER_NAME_KEY = 'swipefish_player_name';
const PLAYER_NAME_USER_SET_KEY = 'swipefish_player_name_user_set';

// Fantasy names to choose from
const FANTASY_NAMES = [
  'Aetherius',
  'Celestia',
  'Drakon',
  'Elysia',
  'Fenrir',
  'Glimmer',
  'Helios',
  'Iris',
  'Jade',
  'Kael',
  'Luna',
  'Mystic',
  'Nyx',
  'Orion',
  'Phoenix',
  'Quinn',
  'Raven',
  'Sage',
  'Thorne',
  'Vex',
  'Wren',
  'Zephyr',
];

/**
 * Get a random fantasy name
 */
function getRandomFantasyName(): string {
  return FANTASY_NAMES[Math.floor(Math.random() * FANTASY_NAMES.length)];
}

/**
 * Get the player name from localStorage if user-set, or generate and store a new random fantasy name
 * The fantasy name is stored temporarily for the session, but regenerated on each page load
 * if the user hasn't explicitly set a name
 */
export function getPlayerName(): string {
  const isUserSet = localStorage.getItem(PLAYER_NAME_USER_SET_KEY) === 'true';
  const stored = localStorage.getItem(PLAYER_NAME_KEY);
  
  // If user explicitly set a name, use it
  if (isUserSet && stored) {
    return stored;
  }
  
  // If there's a stored name but it's not user-set, use it (for session consistency)
  // This allows the same fantasy name to be used across pages in the same session
  if (stored) {
    return stored;
  }
  
  // Otherwise, generate and store a new random fantasy name for this session
  const fantasyName = getRandomFantasyName();
  localStorage.setItem(PLAYER_NAME_KEY, fantasyName);
  // Don't set PLAYER_NAME_USER_SET_KEY - this marks it as auto-generated
  return fantasyName;
}

/**
 * Get a fresh random fantasy name (for landing page initialization)
 * This generates a new name each time, but doesn't persist it until user interacts
 */
export function getFreshFantasyName(): string {
  return getRandomFantasyName();
}

/**
 * Set the player name in localStorage and mark it as user-set
 */
export function setPlayerName(name: string): void {
  const trimmedName = name.trim();
  if (trimmedName) {
    localStorage.setItem(PLAYER_NAME_KEY, trimmedName);
    localStorage.setItem(PLAYER_NAME_USER_SET_KEY, 'true');
  } else {
    // If cleared, remove the user-set flag so a new fantasy name will be generated
    localStorage.removeItem(PLAYER_NAME_USER_SET_KEY);
    localStorage.removeItem(PLAYER_NAME_KEY);
  }
}

/**
 * Check if a name is one of the fantasy names
 */
export function isFantasyName(name: string): boolean {
  return FANTASY_NAMES.includes(name.trim());
}

/**
 * Clear the player name from localStorage
 */
export function clearPlayerName(): void {
  localStorage.removeItem(PLAYER_NAME_KEY);
  localStorage.removeItem(PLAYER_NAME_USER_SET_KEY);
}


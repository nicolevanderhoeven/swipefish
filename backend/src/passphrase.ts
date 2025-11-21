// Fantasy-themed adjectives
const adjectives = [
  'mystical', 'ancient', 'shadowy', 'crystal', 'ethereal', 'forgotten',
  'enchanted', 'dragon', 'magical', 'celestial', 'dark', 'golden',
  'silver', 'crimson', 'azure', 'emerald', 'obsidian', 'prismatic',
  'arcane', 'divine', 'infernal', 'lunar', 'solar', 'stellar',
  'void', 'chaotic', 'orderly', 'temporal', 'spatial', 'elemental',
  'frost', 'flame', 'storm', 'thunder', 'lightning', 'cosmic',
  'abyssal', 'celestial', 'demonic', 'angelic', 'necrotic', 'holy'
];

// Fantasy-themed nouns
const nouns = [
  'dragon', 'wizard', 'knight', 'mage', 'druid', 'rogue',
  'phoenix', 'griffin', 'unicorn', 'basilisk', 'wyvern', 'serpent',
  'tower', 'castle', 'realm', 'kingdom', 'empire', 'sanctum',
  'crystal', 'orb', 'staff', 'sword', 'shield', 'amulet',
  'forest', 'mountain', 'cavern', 'temple', 'shrine', 'ruins',
  'star', 'moon', 'sun', 'comet', 'nebula', 'galaxy',
  'spell', 'ritual', 'curse', 'blessing', 'charm', 'enchantment',
  'portal', 'gateway', 'rift', 'void', 'abyss', 'dimension'
];

/**
 * Generates a random fantasy-themed passphrase in the format adjective-noun
 */
export function generatePassphrase(): string {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adjective}-${noun}`;
}

/**
 * Validates passphrase format (adjective-noun)
 */
export function validatePassphraseFormat(passphrase: string): boolean {
  const parts = passphrase.split('-');
  if (parts.length !== 2) return false;
  
  const [adj, noun] = parts;
  return adjectives.includes(adj) && nouns.includes(noun);
}


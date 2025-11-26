/**
 * Constructs the image filename for a persona card.
 * Pattern: P{number}_{Persona_Name}.png
 * Example: P001_Crypto_Bro.png, P002_Life_Coach_At_23.png
 */
export function getPersonaImageFilename(personaNumber: string, personaName: string): string {
  // Convert persona name to filename format:
  // - Remove parentheses but keep their contents
  // - Replace spaces with underscores
  // - Remove other special characters except underscores
  let sanitized = personaName
    .replace(/\(/g, '') // Remove opening parentheses
    .replace(/\)/g, '') // Remove closing parentheses
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/[^a-zA-Z0-9_]/g, '') // Remove special characters
    .replace(/_+/g, '_') // Replace multiple underscores with single
    .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
  
  return `${personaNumber}_${sanitized}.png`;
}

/**
 * Gets the full image path for a persona card.
 * Images are served from /img/personas/ in the public folder.
 */
export function getPersonaImagePath(personaNumber: string, personaName: string): string {
  const filename = getPersonaImageFilename(personaNumber, personaName);
  return `/img/personas/${filename}`;
}


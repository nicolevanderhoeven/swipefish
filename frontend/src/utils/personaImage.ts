/**
 * Utility functions for persona image paths
 */

/**
 * Generates the filename for a persona image based on persona number and name
 * Format: P###_Name.png (e.g., P001_Crypto_Bro.png)
 */
export function getPersonaImageFilename(personaNumber: string, personaName: string): string {
  // Remove any spaces and special characters from persona name for filename
  const sanitizedName = personaName
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  
  return `${personaNumber}_${sanitizedName}.png`;
}

/**
 * Gets the full path to a persona image
 * Images are served from /img/personas/ in the public directory
 */
export function getPersonaImagePath(personaNumber: string, personaName: string): string {
  const filename = getPersonaImageFilename(personaNumber, personaName);
  return `/img/personas/${filename}`;
}


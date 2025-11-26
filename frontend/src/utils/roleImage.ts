/**
 * Constructs the image filename for a role card.
 * Pattern: R{number}_{Role_Name}.png
 * Example: R001_Crypto_Bro.png, R002_Life_Coach_At_23.png
 */
export function getRoleImageFilename(roleNumber: string, roleName: string): string {
  // Convert role name to filename format:
  // - Remove parentheses but keep their contents
  // - Replace spaces with underscores
  // - Remove other special characters except underscores
  let sanitized = roleName
    .replace(/\(/g, '') // Remove opening parentheses
    .replace(/\)/g, '') // Remove closing parentheses
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/[^a-zA-Z0-9_]/g, '') // Remove special characters
    .replace(/_+/g, '_') // Replace multiple underscores with single
    .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
  
  return `${roleNumber}_${sanitized}.png`;
}

/**
 * Gets the full image path for a role card.
 * Images are served from /img/roles/ in the public folder.
 */
export function getRoleImagePath(roleNumber: string, roleName: string): string {
  const filename = getRoleImageFilename(roleNumber, roleName);
  return `/img/roles/${filename}`;
}


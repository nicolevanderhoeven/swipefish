import * as fs from 'fs';
import * as path from 'path';

export interface RoleCard {
  roleNumber: string;
  role: string;
  tagline: string;
}

let cachedRoles: RoleCard[] | null = null;

/**
 * Parses a CSV field, handling quoted fields with escaped quotes.
 * Returns the parsed field value and the index after the field.
 */
function parseCsvField(line: string, startIndex: number): { value: string; nextIndex: number } {
  let i = startIndex;
  
  // Skip leading whitespace
  while (i < line.length && line[i] === ' ') {
    i++;
  }
  
  // Check if field is quoted
  if (i < line.length && line[i] === '"') {
    // Quoted field - find the closing quote
    i++; // Skip opening quote
    let value = '';
    while (i < line.length) {
      if (line[i] === '"') {
        // Check if it's an escaped quote (two quotes in a row)
        if (i + 1 < line.length && line[i + 1] === '"') {
          value += '"';
          i += 2;
        } else {
          // End of quoted field
          i++;
          // Skip to comma or end
          while (i < line.length && line[i] !== ',') {
            i++;
          }
          if (i < line.length) {
            i++; // Skip comma
          }
          return { value, nextIndex: i };
        }
      } else {
        value += line[i];
        i++;
      }
    }
    // Reached end of line without closing quote - return what we have
    return { value, nextIndex: i };
  } else {
    // Unquoted field - read until comma or end of line
    let value = '';
    while (i < line.length && line[i] !== ',') {
      value += line[i];
      i++;
    }
    if (i < line.length) {
      i++; // Skip comma
    }
    return { value: value.trim(), nextIndex: i };
  }
}

/**
 * Loads role cards from the CSV file.
 * Results are cached after first load.
 * CSV format: Role Number,"Role","Tagline"
 */
export function loadRoles(): RoleCard[] {
  if (cachedRoles) {
    return cachedRoles;
  }

  const csvPath = path.join(__dirname, '../../img/roles/swipefish_roles.csv');
  
  try {
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.split('\n').filter(line => line.trim() !== '');
    
    // Skip header line
    const dataLines = lines.slice(1);
    
    const roles: RoleCard[] = [];
    
    for (const line of dataLines) {
      let index = 0;
      
      // Parse role number (first field, unquoted)
      const roleNumberResult = parseCsvField(line, index);
      const roleNumber = roleNumberResult.value.trim();
      index = roleNumberResult.nextIndex;
      
      // Parse role (second field, quoted)
      const roleResult = parseCsvField(line, index);
      let role = roleResult.value.trim();
      // Remove quotes if present (shouldn't be needed with proper parsing, but just in case)
      if (role.startsWith('"') && role.endsWith('"')) {
        role = role.slice(1, -1);
      }
      index = roleResult.nextIndex;
      
      // Parse tagline (third field, quoted)
      const taglineResult = parseCsvField(line, index);
      let tagline = taglineResult.value.trim();
      // Remove quotes if present
      if (tagline.startsWith('"') && tagline.endsWith('"')) {
        tagline = tagline.slice(1, -1);
      }
      
      if (roleNumber && role && tagline) {
        roles.push({ roleNumber, role, tagline });
      }
    }
    
    cachedRoles = roles;
    console.log(`Loaded ${roles.length} role cards from CSV`);
    return roles;
  } catch (error) {
    console.error('Error loading roles from CSV:', error);
    throw new Error('Failed to load role cards');
  }
}

/**
 * Randomly selects a role card from the first 29 roles (R001-R029).
 * Only these roles have corresponding images available.
 */
export function selectRandomRole(): RoleCard {
  const roles = loadRoles();
  if (roles.length === 0) {
    throw new Error('No role cards available');
  }
  
  // Only use first 29 roles (R001-R029) which have images
  const availableRoles = roles.slice(0, 29);
  if (availableRoles.length === 0) {
    throw new Error('No role cards available (first 29 roles)');
  }
  
  const randomIndex = Math.floor(Math.random() * availableRoles.length);
  return availableRoles[randomIndex];
}

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


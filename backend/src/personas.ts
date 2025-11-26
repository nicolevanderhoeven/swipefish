import * as fs from 'fs';
import * as path from 'path';

export interface PersonaCard {
  personaNumber: string;
  persona: string;
  tagline: string;
}

let cachedPersonas: PersonaCard[] | null = null;

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
 * Loads persona cards from the CSV file.
 * Results are cached after first load.
 * CSV format: Persona Number,"Persona","Tagline"
 */
export function loadPersonas(): PersonaCard[] {
  if (cachedPersonas) {
    return cachedPersonas;
  }

  const csvPath = path.join(__dirname, '../../img/personas/swipefish_personas.csv');
  
  try {
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.split('\n').filter(line => line.trim() !== '');
    
    // Skip header line
    const dataLines = lines.slice(1);
    
    const personas: PersonaCard[] = [];
    
    for (const line of dataLines) {
      let index = 0;
      
      // Parse persona number (first field, unquoted)
      const personaNumberResult = parseCsvField(line, index);
      const personaNumber = personaNumberResult.value.trim();
      index = personaNumberResult.nextIndex;
      
      // Parse persona (second field, quoted)
      const personaResult = parseCsvField(line, index);
      let persona = personaResult.value.trim();
      // Remove quotes if present (shouldn't be needed with proper parsing, but just in case)
      if (persona.startsWith('"') && persona.endsWith('"')) {
        persona = persona.slice(1, -1);
      }
      index = personaResult.nextIndex;
      
      // Parse tagline (third field, quoted)
      const taglineResult = parseCsvField(line, index);
      let tagline = taglineResult.value.trim();
      // Remove quotes if present
      if (tagline.startsWith('"') && tagline.endsWith('"')) {
        tagline = tagline.slice(1, -1);
      }
      
      if (personaNumber && persona && tagline) {
        personas.push({ personaNumber, persona, tagline });
      }
    }
    
    cachedPersonas = personas;
    console.log(`Loaded ${personas.length} persona cards from CSV`);
    return personas;
  } catch (error) {
    console.error('Error loading personas from CSV:', error);
    throw new Error('Failed to load persona cards');
  }
}

/**
 * Randomly selects a persona card from the first 29 personas (P001-P029).
 * Only these personas have corresponding images available.
 */
export function selectRandomPersona(): PersonaCard {
  const personas = loadPersonas();
  if (personas.length === 0) {
    throw new Error('No persona cards available');
  }
  
  // Only use first 29 personas (P001-P029) which have images
  const availablePersonas = personas.slice(0, 29);
  if (availablePersonas.length === 0) {
    throw new Error('No persona cards available (first 29 personas)');
  }
  
  const randomIndex = Math.floor(Math.random() * availablePersonas.length);
  return availablePersonas[randomIndex];
}

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


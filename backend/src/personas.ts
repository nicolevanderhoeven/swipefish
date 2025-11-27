import * as fs from 'fs';
import * as path from 'path';

export interface PersonaCard {
  personaNumber: string;
  persona: string;
  tagline: string;
}

let cachedPersonas: PersonaCard[] | null = null;

/**
 * Parse a CSV field, handling quoted fields and escaped quotes
 */
function parseCsvField(line: string, startIndex: number): { value: string; nextIndex: number } {
  let index = startIndex;
  
  // Skip leading whitespace
  while (index < line.length && line[index] === ' ') {
    index++;
  }
  
  // Check if field is quoted
  if (index < line.length && line[index] === '"') {
    // Quoted field - find the closing quote
    index++; // Skip opening quote
    let value = '';
    while (index < line.length) {
      if (line[index] === '"') {
        // Check if it's an escaped quote (two quotes in a row)
        if (index + 1 < line.length && line[index + 1] === '"') {
          value += '"';
          index += 2;
        } else {
          // End of quoted field
          index++; // Skip closing quote
          break;
        }
      } else {
        value += line[index];
        index++;
      }
    }
    
    // Skip to next comma or end of line
    while (index < line.length && line[index] !== ',') {
      index++;
    }
    if (index < line.length) {
      index++; // Skip comma
    }
    
    return { value, nextIndex: index };
  } else {
    // Unquoted field - read until comma or end of line
    let value = '';
    while (index < line.length && line[index] !== ',') {
      value += line[index];
      index++;
    }
    if (index < line.length) {
      index++; // Skip comma
    }
    
    return { value: value.trim(), nextIndex: index };
  }
}

export function loadPersonas(): PersonaCard[] {
  if (cachedPersonas) {
    return cachedPersonas;
  }

  const csvPath = path.join(__dirname, '../img/personas/swipefish_personas.csv');
  
  try {
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.split('\n').filter(line => line.trim() !== '');
    
    // Skip header line
    const dataLines = lines.slice(1);
    
    const personas: PersonaCard[] = [];
    
    for (const line of dataLines) {
      let index = 0;
      
      const personaNumberResult = parseCsvField(line, index);
      const personaNumber = personaNumberResult.value.trim();
      index = personaNumberResult.nextIndex;
      
      const personaResult = parseCsvField(line, index);
      let persona = personaResult.value.trim();
      // Remove quotes if present
      if (persona.startsWith('"') && persona.endsWith('"')) {
        persona = persona.slice(1, -1);
      }
      index = personaResult.nextIndex;
      
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
 * Select a random persona from all available personas
 */
export function selectRandomPersona(): PersonaCard {
  const allPersonas = loadPersonas();
  
  if (allPersonas.length === 0) {
    throw new Error('No personas available');
  }
  
  const randomIndex = Math.floor(Math.random() * allPersonas.length);
  return allPersonas[randomIndex];
}

/**
 * Generate the image filename for a persona
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


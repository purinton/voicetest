import fs from 'fs';
import path from 'path';

export function loadInstructions(log) {
    let instructions = '';
    try {
        const instructionsPath = path.resolve(process.cwd(), 'instructions.txt');
        instructions = fs.readFileSync(instructionsPath, 'utf8');
        log.debug('Loaded instructions.txt for OpenAI system prompt');
    } catch (err) {
        log.warn('Could not load instructions.txt:', err);
    }
    return instructions;
}

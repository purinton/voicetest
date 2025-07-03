import fs from 'fs';
import path from 'path';

export function loadInstructions(log) {
    let instructions = '';
    try {
        const instructionsPath = path.resolve(process.cwd(), 'instructions.txt');
        instructions = fs.readFileSync(instructionsPath, 'utf8');
        log.debug('Loaded instructions.txt for OpenAI system prompt');
    } catch (err) {
        log.warn('Could not load instructions.txt, falling back to example:', err);
        try {
            const examplePath = path.resolve(process.cwd(), 'instructions.txt.example');
            instructions = fs.readFileSync(examplePath, 'utf8');
            log.debug('Loaded instructions.txt.example for OpenAI system prompt');
        } catch (err2) {
            log.warn('Could not load instructions.txt.example either:', err2);
        }
    }
    return instructions;
}

import fs from 'fs';
import path from 'path';

// Session config for OpenAI WebSocket
export function getSessionConfig({ instructions, voice }) {
    // Dynamically load all tool JSON files from the tools directory
    const toolsDir = path.resolve(process.cwd(), 'tools');
    let tools = [];
    try {
        tools = fs.readdirSync(toolsDir)
            .filter(f => f.endsWith('.json'))
            .map(f => JSON.parse(fs.readFileSync(path.join(toolsDir, f), 'utf8')));
    } catch (err) {
        // fallback to empty tools array if error
        tools = [];
    }
    return {
        modalities: ['text', 'audio'],
        instructions,
        input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: { type: 'server_vad' },
        voice,
        tools,
        tool_choice: 'auto'
    };
}

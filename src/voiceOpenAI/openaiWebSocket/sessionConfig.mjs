// Session config for OpenAI WebSocket
export function getSessionConfig({ instructions, voice, tools }) {
    // Accept merged tools as argument (local + MCP)
    return {
        modalities: ['text', 'audio'],
        instructions,
        input_audio_transcription: { model: 'whisper-1' },
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: { type: 'server_vad' },
        voice,
        tools: tools || [],
        tool_choice: 'auto'
    };
}

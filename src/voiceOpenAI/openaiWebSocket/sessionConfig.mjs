// Session config for OpenAI WebSocket
export function getSessionConfig({ instructions, voice }) {
    return {
        modalities: ['text', 'audio'],
        instructions,
        input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: { type: 'server_vad' },
        voice,
        tools: [
            {
                type: 'function', name: 'get_chuck_norris_joke', description: 'Fetch a random joke from the Chuck Norris joke API.', parameters: { type: 'object', properties: {}, required: [] }
            },
            {
                type: 'function', name: 'clear_conversation', description: 'Clears and restarts the conversation', parameters: { type: 'object', properties: {}, required: [] }
            },
            {
                type: 'function',
                name: 'no_response',
                description: 'Call this if no response is needed or necessary, if you wish to remain silent and say nothing, or to break out of a loop. Do not call this repeatedly.',
                parameters: { type: 'object', properties: {}, required: [] }
            },
            {
                type: 'function', name: 'get_weather', description: 'Get current weather for a location. Parameters: lat (number), lon (number)', parameters: { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' } }, required: ['lat', 'lon'] }
            },
            {
                type: 'function', name: 'get_sun_times', description: 'Get sunrise and sunset times for a location. Parameters: lat (number), lon (number)', parameters: { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' } }, required: ['lat', 'lon'] }
            },
            {
                type: 'function', name: 'get_24h_forecast', description: 'Get 24-hour weather forecast for a location. Parameters: lat (number), lon (number)', parameters: { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' } }, required: ['lat', 'lon'] }
            },
            {
                type: 'function', name: 'get_current_datetime', description: 'Get the current date and time in UTC and local time.', parameters: { type: 'object', properties: {}, required: [] }
            }
        ],
        tool_choice: 'auto'
    };
}

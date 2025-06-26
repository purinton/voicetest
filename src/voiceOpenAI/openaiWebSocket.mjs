import WebSocket from 'ws';
import fetch from 'node-fetch';

/**
 * Creates a WebSocket connection to the OpenAI realtime API.
 */
export function createOpenAIWebSocket({ openAIApiKey, instructions, voice, log, playback }) {
    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview';
    // Define session config once for reuse (including clear_conversation)
    const sessionConfig = {
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
                type: 'function', name: 'no_response', description: 'Call this if no response is required.', parameters: { type: 'object', properties: {}, required: [] }
            }
        ],
        tool_choice: 'auto'
    };
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${openAIApiKey}`, 'OpenAI-Beta': 'realtime=v1' }});
    ws.on('open', () => {
        log.info('Connected to OpenAI Realtime WebSocket');
        ws.send(JSON.stringify({ type: 'session.update', session: sessionConfig }));
    });
    ws.on('message', (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
            log.debug('[OpenAI WS message parsed]', msg.type);
        } catch {
            msg = null;
        }
        if (msg && msg.type === 'response.done') {
            // handle Chuck Norris joke calls
            const funcChuck = msg.response.output.find(item => item.type === 'function_call' && item.name === 'get_chuck_norris_joke');
            if (funcChuck) {
                fetch('https://api.chucknorris.io/jokes/random')
                    .then(res => res.json())
                    .then(data => {
                        const joke = data.value;
                        ws.send(JSON.stringify({
                            type: 'conversation.item.create',
                            item: {
                                type: 'function_call_output',
                                call_id: funcChuck.call_id,
                                output: JSON.stringify({ joke })
                            }
                        }));
                        ws.send(JSON.stringify({ type: 'response.create' }));
                    })
                    .catch(err => log.error('Error fetching Chuck Norris joke:', err));
                return;
            }
            // handle clear_conversation calls: restart session
            const funcClear = msg.response.output.find(item => item.type === 'function_call' && item.name === 'clear_conversation');
            if (funcClear) {
                log.info('Received clear_conversation, restarting session');
                ws.send(JSON.stringify({ type: 'session.update', session: sessionConfig }));
                return;
            }
            // handle no_response calls: send empty OK response, do not send response.create
            const funcNoResp = msg.response.output.find(item => item.type === 'function_call' && item.name === 'no_response');
            if (funcNoResp) {
                log.info('Received no_response, sending empty OK');
                ws.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                        type: 'function_call_output',
                        call_id: funcNoResp.call_id,
                        output: JSON.stringify({ ok: true })
                    }
                }));
                return;
            }
        }
        if (msg && msg.type === 'response.audio.delta') {
            const audioBase64 = msg.delta;
            if (audioBase64) {
                const audioBuffer = Buffer.from(audioBase64, 'base64');
                log.debug(`[OpenAI audio delta] size: ${audioBuffer.length} bytes`);
                playback.handleAudio(audioBuffer);
            }
        } else if (msg && msg.type === 'response.audio.done') {
            log.info('OpenAI audio stream done, resetting playback');
            playback.reset();
        }
    });
    ws.on('error', (err) => log.error('OpenAI WebSocket error:', err));
    ws.on('close', () => log.info('OpenAI WebSocket closed'));
    return ws;
}

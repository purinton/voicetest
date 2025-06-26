import WebSocket from 'ws';
import { getSessionConfig } from './openaiWebSocket/sessionConfig.mjs';
import { handleFunctionCall } from './openaiWebSocket/messageHandlers.mjs';
import { handleAudioDelta, handleAudioDone } from './openaiWebSocket/audioHandlers.mjs';

/**
 * Creates a WebSocket connection to the OpenAI realtime API.
 */
export function createOpenAIWebSocket({ openAIApiKey, instructions, voice, log, playback }) {
    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview';
    const sessionConfig = getSessionConfig({ instructions, voice });
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${openAIApiKey}`, 'OpenAI-Beta': 'realtime=v1' } });
    ws.skipResponseCreate = new Set();
    ws.on('open', () => {
        log.info('Connected to OpenAI Realtime WebSocket');
        ws.send(JSON.stringify({ type: 'session.update', session: sessionConfig }));
    });
    ws.on('message', async (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
            log.debug('[OpenAI WS message parsed]', msg.type);
        } catch {
            msg = null;
        }
        if (msg && msg.type === 'response.done') {
            const { handled } = await handleFunctionCall({ msg, ws, log, sessionConfig });
            if (handled) {
                ws.send(JSON.stringify({ type: 'response.create' }));
                return;
            }
        }
        if (msg && msg.type === 'response.audio.delta') {
            handleAudioDelta({ msg, playback, log });
        } else if (msg && msg.type === 'response.audio.done') {
            handleAudioDone({ playback, log });
        }
    });
    ws.on('error', (err) => log.error('OpenAI WebSocket error:', err));
    ws.on('close', () => log.info('OpenAI WebSocket closed'));
    return ws;
}

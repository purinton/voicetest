import WebSocket from 'ws';
import { getSessionConfig } from './openaiWebSocket/sessionConfig.mjs';
import { handleFunctionCall } from './openaiWebSocket/messageHandlers.mjs';
import { handleAudioDelta, handleAudioDone } from './openaiWebSocket/audioHandlers.mjs';
import { playBeep } from './beep.mjs';

/**
 * Creates a WebSocket connection to the OpenAI realtime API.
 * Accepts an optional onRestart callback to handle session restarts.
 */
export async function createOpenAIWebSocket({ client,
    openAIApiKey,
    instructions,
    voice,
    log,
    playback,
    onRestart,
    channelId = process.env.VOICE_CHANNEL_ID || null,
    audioPlayer,
    allTools, // accept allTools directly
    allMcpTools, // pass all MCP tools
    mcpClients // pass MCP clients
}) {
    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview';
    // Use allTools if available, but strip extra properties for OpenAI schema compliance
    const toolsForOpenAI = (allTools || []).map(tool => {
        // Only include OpenAI-compatible keys
        return {
            type: tool.type,
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
        };
    });
    const sessionConfig = getSessionConfig({ instructions, voice, tools: toolsForOpenAI });
    //log.debug('sessionConfig', { sessionConfig });
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${openAIApiKey}`, 'OpenAI-Beta': 'realtime=v1' } });
    if (client) {
        attachSendMessageToClient(client, ws, log);
    } else {
        log.warn('No client provided to attach sendOpenAIMessage');
    }
    ws.skipResponseCreate = new Set();
    ws.on('open', () => {
        log.info('Connected to OpenAI Realtime WebSocket');
        ws.send(JSON.stringify({ type: 'session.update', session: sessionConfig }));
        if (client && typeof client.sendOpenAIMessage === 'function') {
            client.sendOpenAIMessage('Hello');
        }
    });
    ws.on('message', async (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
            if (!msg.type || !msg.type.includes('delta')) {
                if (msg.type !== 'error') {
                    log.debug('[OpenAI WS message parsed]', msg.type);
                } else {
                    log.error('[OpenAI WS error message]', msg);
                }
            }
        } catch (e) {
            log.error('Failed to parse WS message', e);
            return;
        }
        // Send user transcription to Discord if present
        if (msg && msg.type === 'conversation.item.input_audio_transcription.completed' && msg.transcript && channelId && client) {
            try {
                const channel = await client.channels.fetch(channelId);
                if (channel && channel.send) {
                    await channel.send(`User: ${msg.transcript}`);
                }
            } catch (err) {
                log.error('Failed to send user transcription to Discord channel:', err);
            }
        }
        // Debug: log assistant response structure
        if (msg && msg.type === 'response.done' && msg.response) {
            //log.debug('[Assistant response structure]', JSON.stringify(msg.response.output));
        }
        // Send assistant response text or transcript to Discord if present
        if (msg && msg.type === 'response.done' && msg.response && Array.isArray(msg.response.output) && channelId && client) {
            for (const item of msg.response.output) {
                if (item.type === 'message' && Array.isArray(item.content)) {
                    for (const part of item.content) {
                        if (part.type === 'text' && part.text) {
                            try {
                                const channel = await client.channels.fetch(channelId);
                                if (channel && channel.send) {
                                    await channel.send(`Assistant: ${part.text}`);
                                }
                            } catch (err) {
                                log.error('Failed to send assistant response to Discord channel:', err);
                            }
                        } else if (part.type === 'audio' && part.transcript) {
                            try {
                                const channel = await client.channels.fetch(channelId);
                                if (channel && channel.send) {
                                    await channel.send(`Assistant: ${part.transcript}`);
                                }
                            } catch (err) {
                                log.error('Failed to send assistant audio transcript to Discord channel:', err);
                            }
                        } else {
                            //log.debug('[Assistant content part]', JSON.stringify(part));
                        }
                    }
                } else {
                    //log.debug('[Assistant output item]', JSON.stringify(item));
                }
            }
        }
        if (msg.type === 'response.done') {
            const result = await handleFunctionCall({
                msg, ws, log, sessionConfig, client, channelId, playBeepFn: () => playBeep(audioPlayer, log),
                allMcpTools, mcpClients // pass to handler
            });
            if (result && result.handled) {
                if (result.restart && typeof onRestart === 'function') {
                    log.info('Restarting OpenAI WebSocket session...');
                    ws.close();
                    onRestart();
                    return;
                }
                if (!result.skipResponse) {
                    ws.send(JSON.stringify({ type: 'response.create' }));
                }
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
    // Heartbeat ping every 50 seconds
    let heartbeatInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
            ws.ping();
            //log.debug('Sent heartbeat ping to OpenAI WebSocket');
        }
    }, 50000);
    ws.on('close', () => {
        log.info('OpenAI WebSocket closed');
        clearInterval(heartbeatInterval);
        // Auto-restart if onRestart is provided
        if (typeof onRestart === 'function') {
            log.info('Attempting to auto-restart OpenAI WebSocket after close');
            onRestart();
        }
    });
    return ws;
}

/**
 * Send a user text message to the OpenAI Realtime WebSocket as a conversation.item.create event.
 * @param {string} text - The text to send as a user message.
 * @param {string|null} previous_item_id - The ID of the previous item, or null to append.
 */
export function attachSendMessageToClient(client, ws, log) {
    if (!client) {
        log.warn('attachSendMessageToClient called with undefined client');
        return;
    }
    client.sendOpenAIMessage = async function (text, previous_item_id = null) {
        if (!ws || ws.readyState !== ws.OPEN) {
            log.error('OpenAI WebSocket is not open');
            return;
        }
        const event = {
            event_id: `event_${Date.now()}`,
            type: 'conversation.item.create',
            previous_item_id,
            item: {
                id: `msg_${Date.now()}`,
                type: 'message',
                role: 'user',
                content: [
                    {
                        type: 'input_text',
                        text
                    }
                ]
            }
        };
        await ws.send(JSON.stringify(event));
        ws.send(JSON.stringify({ type: 'response.create' }));
        log.debug('[OpenAI WS] Sent conversation.item.create, response.create');
    };
}

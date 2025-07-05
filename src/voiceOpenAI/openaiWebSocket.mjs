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
    allTools,
    mcpTools,
    mcpClients
}) {
    if (!openAIApiKey) {
        throw new Error('openAIApiKey is required');
    }
    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview';
    const toolsForOpenAI = (allTools || []).map(tool => {
        return {
            type: tool.type,
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
        };
    });
    const sessionConfig = getSessionConfig({ instructions, voice, tools: toolsForOpenAI });
    let ws;
    let wsConnectAttempts = 0;
    const MAX_WS_CONNECT_ATTEMPTS = 5;
    const BASE_DELAY = 1000;

    async function connectWebSocket() {
        for (wsConnectAttempts = 0; wsConnectAttempts < MAX_WS_CONNECT_ATTEMPTS; wsConnectAttempts++) {
            try {
                ws = new WebSocket(url, { headers: { Authorization: `Bearer ${openAIApiKey}`, 'OpenAI-Beta': 'realtime=v1' } });
                await new Promise((resolve, reject) => {
                    ws.once('open', resolve);
                    ws.once('error', reject);
                });
                return;
            } catch (err) {
                log.error(`OpenAI WebSocket initial connect failed (attempt ${wsConnectAttempts + 1}):`, err);
                if (client && channelId) {
                    try {
                        const channel = await client.channels.fetch(channelId);
                        if (channel && channel.send) {
                            await channel.send(':warning: Bot is reconnecting to OpenAI...');
                        }
                    } catch {}
                }
                await new Promise(res => setTimeout(res, BASE_DELAY * Math.pow(2, wsConnectAttempts)));
            }
        }
        throw new Error('Failed to connect to OpenAI WebSocket after multiple attempts.');
    }

    await connectWebSocket();

    if (client) {
        attachSendMessageToClient(client, ws, log);
    } else {
        log.warn('No client provided to attach sendOpenAIMessage');
    }
    ws.skipResponseCreate = new Set();
    ws.on('open', () => {
        log.debug('Connected to OpenAI Realtime WebSocket');
        ws.send(JSON.stringify({ type: 'session.update', session: sessionConfig }));
        if (client && typeof client.sendOpenAIMessage === 'function') {
            client.sendOpenAIMessage('Hello');
        }
    });
    ws.on('message', async (data) => {
        // ...existing code...
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
        // ...existing code...
        if (msg && msg.type === 'conversation.item.input_audio_transcription.completed' && msg.transcript && channelId && client) {
            try {
                const channel = await client.channels.fetch(channelId);
                if (channel && channel.send) {
                    // Tag the last speaker instead of generic 'User:'
                    const speakerId = ws.lastSpeakerId || null;
                    const label = speakerId ? `<@${speakerId}>` : 'User';
                    await channel.send({
                        content: `${label}: ${msg.transcript}`,
                        allowedMentions: { parse: [] }
                    });
                }
            } catch (err) {
                log.error('Failed to send user transcription to Discord channel:', err);
            }
        }
        // ...existing code...
    });
    ws.on('error', (err) => {
        log.error('OpenAI WebSocket error:', err);
        if (client && channelId) {
            client.channels.fetch(channelId).then(channel => {
                if (channel && channel.send) {
                    channel.send(':x: Bot encountered a critical error with OpenAI WebSocket. Attempting to reconnect...');
                }
            }).catch(() => {});
        }
    });
    let heartbeatInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
            ws.ping();
        }
    }, 50000);
    ws.on('close', () => {
        log.debug('OpenAI WebSocket closed');
        ws.lastSpeakerId = null;
        clearInterval(heartbeatInterval);
        if (typeof onRestart === 'function') {
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
    client.sendOpenAIMessage = async function (text, createResponse = true) {
        if (!ws || ws.readyState !== ws.OPEN) {
            log.error('OpenAI WebSocket is not open');
            return;
        }
        const event = {
            event_id: `event_${Date.now()}`,
            type: 'conversation.item.create',
            previous_item_id: ws.previous_item_id || null,
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
        if (createResponse) {
            ws.send(JSON.stringify({ type: 'response.create' }));
        }
        log.debug('[OpenAI WS] Sent conversation.item.create, response.create');
    };
    ws.sendOpenAIMessage = client.sendOpenAIMessage;
}

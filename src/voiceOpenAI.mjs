import { setupAudioInput } from './voiceOpenAI/audioInput.mjs';
import { loadInstructions } from './voiceOpenAI/instructions.mjs';
import { createAudioPlayback } from './voiceOpenAI/audioPlayback.mjs';
import { setupVoiceConnection } from './voiceOpenAI/voiceConnection.mjs';
import { createOpenAIWebSocket } from './voiceOpenAI/openaiWebSocket.mjs';


export async function setupVoiceOpenAI({ client, guildId, voiceChannelId, openAIApiKey, log, voice, mcpClients, allTools, mcpTools }) {
    const instructions = loadInstructions(log);
    let voiceConnection, audioPlayer, playback, openAIWS, audioInputCleanup;
    let wsRetryCount = 0;
    let voiceRetryCount = 0;
    const MAX_WS_RETRIES = 5;
    const MAX_VOICE_RETRIES = 5;
    const BASE_DELAY = 1000;

    async function setupDiscordVoice() {
        let lastError;
        for (voiceRetryCount = 0; voiceRetryCount < MAX_VOICE_RETRIES; voiceRetryCount++) {
            try {
                const result = setupVoiceConnection({ client, guildId, voiceChannelId, log });
                voiceConnection = result.voiceConnection;
                audioPlayer = result.audioPlayer;
                playback = createAudioPlayback(audioPlayer, log);
                log.debug('Voice connection established');
                return;
            } catch (err) {
                lastError = err;
                log.error(`Voice connection failed (attempt ${voiceRetryCount + 1}):`, err);
                if (client && voiceChannelId) {
                    try {
                        const channel = await client.channels.fetch(voiceChannelId);
                        if (channel && channel.send) {
                            await channel.send(':warning: Bot is reconnecting to voice channel...');
                        }
                    } catch {}
                }
                await new Promise(res => setTimeout(res, BASE_DELAY * Math.pow(2, voiceRetryCount)));
            }
        }
        throw lastError;
    }

    async function restartWebSocket() {
        if (openAIWS && openAIWS.readyState === 1) openAIWS.close();
        if (audioInputCleanup) audioInputCleanup();
        let lastError;
        for (wsRetryCount = 0; wsRetryCount < MAX_WS_RETRIES; wsRetryCount++) {
            try {
                openAIWS = await createOpenAIWebSocket({
                    client,
                    openAIApiKey,
                    instructions,
                    voice,
                    log,
                    playback,
                    onRestart: restartWebSocket,
                    audioPlayer,
                    allTools,
                    mcpTools,
                    mcpClients
                });
                audioInputCleanup = setupAudioInput({ client, voiceConnection, openAIWS, log });
                wsRetryCount = 0;
                log.debug('OpenAI WebSocket connection established');
                return;
            } catch (err) {
                lastError = err;
                log.error(`OpenAI WebSocket failed (attempt ${wsRetryCount + 1}):`, err);
                if (client && voiceChannelId) {
                    try {
                        const channel = await client.channels.fetch(voiceChannelId);
                        if (channel && channel.send) {
                            await channel.send(':warning: Bot is reconnecting to OpenAI...');
                        }
                    } catch {}
                }
                await new Promise(res => setTimeout(res, BASE_DELAY * Math.pow(2, wsRetryCount)));
            }
        }
        if (client && voiceChannelId) {
            try {
                const channel = await client.channels.fetch(voiceChannelId);
                if (channel && channel.send) {
                    await channel.send(':x: Bot failed to connect to OpenAI after multiple attempts.');
                }
            } catch {}
        }
        throw lastError;
    }

    await setupDiscordVoice();
    await restartWebSocket();

    return async () => {
        if (openAIWS && openAIWS.readyState === 1) openAIWS.close();
        if (audioInputCleanup) audioInputCleanup();
        if (voiceConnection) {
            try { voiceConnection.destroy(); } catch (e) { log.error('Error destroying voice connection:', e); }
        }
        if (audioPlayer) {
            try { audioPlayer.stop(); } catch (e) { log.error('Error stopping audio player:', e); }
        }
    };
}

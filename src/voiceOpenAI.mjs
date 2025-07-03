import { setupAudioInput } from './voiceOpenAI/audioInput.mjs';
import { loadInstructions } from './voiceOpenAI/instructions.mjs';
import { createAudioPlayback } from './voiceOpenAI/audioPlayback.mjs';
import { setupVoiceConnection } from './voiceOpenAI/voiceConnection.mjs';
import { createOpenAIWebSocket } from './voiceOpenAI/openaiWebSocket.mjs';

export async function setupVoiceOpenAI({ client, guildId, voiceChannelId, openAIApiKey, log, voice, mcpClients, allTools, mcpTools }) {
    const instructions = loadInstructions(log);
    const { voiceConnection, audioPlayer } = setupVoiceConnection({ client, guildId, voiceChannelId, log });
    const playback = createAudioPlayback(audioPlayer, log);

    let openAIWS;
    let audioInputCleanup;

    async function restartWebSocket() {
        if (openAIWS && openAIWS.readyState === 1) openAIWS.close();
        if (audioInputCleanup) audioInputCleanup();
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
        audioInputCleanup = setupAudioInput({ voiceConnection, openAIWS, log });
    }

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
    audioInputCleanup = setupAudioInput({ voiceConnection, openAIWS, log });

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

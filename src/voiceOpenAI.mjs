import { PassThrough } from 'stream';
import { spawn } from 'child_process';
import { loadInstructions } from './voiceOpenAI/instructions.mjs';
import { setupVoiceConnection } from './voiceOpenAI/voiceConnection.mjs';
import { createAudioPlayback } from './voiceOpenAI/audioPlayback.mjs';
import { createOpenAIWebSocket } from './voiceOpenAI/openaiWebSocket.mjs';
import { setupAudioInput } from './voiceOpenAI/audioInput.mjs';

export async function setupVoiceOpenAI({ client, guildId, voiceChannelId, openAIApiKey, voice, filter, log }) {
    const instructions = loadInstructions(log);
    const { voiceConnection, audioPlayer } = setupVoiceConnection({ client, guildId, voiceChannelId, log });

    // Persistent ffmpeg: 48kHz -> 24kHz (input to OpenAI)
    const ffmpeg48to24 = spawn(ffmpegStatic, [
        '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', '-',
        '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1',
    ]);
    ffmpeg48to24.on('error', log.error);
    ffmpeg48to24.stderr.on('data', data => log.debug('ffmpeg 48to24 stderr:', data.toString()));

    // Persistent ffmpeg: 24kHz -> 48kHz (output to Discord)
    const ffmpeg24to48 = spawn(ffmpegStatic, [
        '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', '-',
        '-filter:a', filter,
        '-f', 's16le', '-ar', '48000', '-ac', '1', 'pipe:1',
    ]);
    ffmpeg24to48.on('error', log.error);
    ffmpeg24to48.stderr.on('data', data => log.debug('ffmpeg 24to48 stderr:', data.toString()));

    // Setup playback and input using shared ffmpeg processes
    const playback = createAudioPlayback(audioPlayer, log, ffmpeg24to48.stdin);
    let openAIWS;
    let audioInputCleanup;

    function restartWebSocket() {
        if (openAIWS && openAIWS.readyState === 1) openAIWS.close();
        if (audioInputCleanup) audioInputCleanup();
        openAIWS = createOpenAIWebSocket({
            openAIApiKey,
            instructions,
            voice,
            log,
            playback,
            onRestart: restartWebSocket
        });
        audioInputCleanup = setupAudioInput({ voiceConnection, openAIWS, log, ffmpeg48to24 });
    }

    openAIWS = createOpenAIWebSocket({
        openAIApiKey,
        instructions,
        voice,
        log,
        playback,
        onRestart: restartWebSocket
    });
    audioInputCleanup = setupAudioInput({ voiceConnection, openAIWS, log, ffmpeg48to24 });

    // Pipe OpenAI output to ffmpeg24to48
    playback.setInputStream(ffmpeg24to48.stdin);
    // Pipe ffmpeg24to48 output to Discord
    playback.setOutputStream(ffmpeg24to48.stdout);

    return async () => {
        log.debug('Cleaning up Voice/OpenAI resources');
        if (openAIWS && openAIWS.readyState === 1) openAIWS.close();
        if (audioInputCleanup) audioInputCleanup();
        if (voiceConnection) {
            try { voiceConnection.destroy(); } catch (e) { log.error('Error destroying voice connection:', e); }
        }
        if (audioPlayer) {
            try { audioPlayer.stop(); } catch (e) { log.error('Error stopping audio player:', e); }
        }
        try { ffmpeg48to24.stdin.end(); ffmpeg48to24.kill(); } catch {}
        try { ffmpeg24to48.stdin.end(); ffmpeg24to48.kill(); } catch {}
    };
}

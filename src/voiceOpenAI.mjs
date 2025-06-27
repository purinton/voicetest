import { loadInstructions } from './voiceOpenAI/instructions.mjs';
import { setupVoiceConnection } from './voiceOpenAI/voiceConnection.mjs';
import { createAudioPlayback } from './voiceOpenAI/audioPlayback.mjs';
import { createOpenAIWebSocket } from './voiceOpenAI/openaiWebSocket.mjs';
import { setupAudioInput } from './voiceOpenAI/audioInput.mjs';
import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'child_process';

export async function setupVoiceOpenAI({ client, guildId, voiceChannelId, openAIApiKey, voice, filter, log }) {
    // Persistent ffmpeg processes
    const ffmpeg48to24 = spawn(ffmpegStatic, [
        '-fflags', 'nobuffer',
        '-flags', 'low_delay',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '1',
        '-i', 'pipe:0',
        '-f', 's16le',
        '-ar', '24000',
        '-ac', '1',
        'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'inherit'] });
    ffmpeg48to24.on('error', log.error);
    ffmpeg48to24.stderr?.on('data', data => log.debug('[ffmpeg48to24]', data.toString()));

    // Persistent ffmpeg24to48: PCM24k -> raw Opus for Discord
    const ffmpeg24to48 = spawn(ffmpegStatic, [
        '-fflags', 'nobuffer',
        '-flags', 'low_delay',
        '-f', 's16le',
        '-ar', '24000',
        '-ac', '1',
        '-i', 'pipe:0',
        '-c:a', 'libopus',
        '-application', 'lowdelay',
        '-frame_duration', '20',
        '-b:a', '64000',
        '-f', 'opus',
        'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'inherit'] });
    ffmpeg24to48.on('error', log.error);
    ffmpeg24to48.stderr?.on('data', data => log.debug('[ffmpeg24to48]', data.toString()));

    const instructions = loadInstructions(log);
    const { voiceConnection, audioPlayer } = setupVoiceConnection({ client, guildId, voiceChannelId, log });
    // Pass ffmpeg24to48 to playback handler
    const playback = createAudioPlayback(filter, audioPlayer, log, ffmpeg24to48);
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
        // Only clean up ffmpeg processes here
        try { ffmpeg48to24.stdin.end(); ffmpeg48to24.kill(); } catch (e) { log.error('Error killing ffmpeg48to24:', e); }
        try { ffmpeg24to48.stdin.end(); ffmpeg24to48.kill(); } catch (e) { log.error('Error killing ffmpeg24to48:', e); }
    };
}

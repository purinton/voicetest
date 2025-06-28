import WebSocket from 'ws';
import prism from 'prism-media';
import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'child_process';
import { PassThrough } from 'stream';

let lastSpeakingUserId = null;
export function getLastSpeakingUserId() {
    return lastSpeakingUserId;
}

export function setupAudioInput({ voiceConnection, openAIWS, log, client }) {
    // Map of userId -> { decoder, passthrough, ffmpeg, buffer }
    const userStreams = new Map();
    const activeUsers = new Set();
    let endTimer;
    const DEBOUNCE_MS = 100;
    const PCM_FRAME_SIZE_BYTES_24 = 480 * 2;

    // handler for user speech start
    const onSpeechStart = async (userId) => {
        activeUsers.add(userId);
        lastSpeakingUserId = userId;
        if (endTimer) { clearTimeout(endTimer); endTimer = null; }
        log.info(`User ${userId} started speaking`);
        const opusStream = voiceConnection.receiver.subscribe(userId, {
            end: { behavior: 'silence', duration: 100 },
        });
        if (!userStreams.has(userId)) {
            const passthrough = new PassThrough();
            const ffmpegArgs = [
                '-f', 's16le',
                '-ar', '48000',
                '-ac', '1',
                '-i', '-',
                '-f', 's16le',
                '-ar', '24000',
                '-ac', '1',
                'pipe:1',
            ];
            const ffmpeg = spawn(ffmpegStatic, ffmpegArgs);
            ffmpeg.on('error', log.error);
            ffmpeg.stderr.on('data', data => log.debug('discord ffmpeg stderr:', data.toString()));
            passthrough.pipe(ffmpeg.stdin);
            let buffer = Buffer.alloc(0);
            ffmpeg.stdout.on('data', chunk => {
                buffer = Buffer.concat([buffer, chunk]);
                while (buffer.length >= PCM_FRAME_SIZE_BYTES_24) {
                    const frame = buffer.slice(0, PCM_FRAME_SIZE_BYTES_24);
                    buffer = buffer.slice(PCM_FRAME_SIZE_BYTES_24);
                    if (openAIWS && openAIWS.readyState === WebSocket.OPEN) {
                        // Only send audio and type, no userId
                        const payload = JSON.stringify({ type: 'input_audio_buffer.append', audio: frame.toString('base64') });
                        try {
                            openAIWS.send(payload);
                        } catch (err) {
                            log.error('Error sending audio to OpenAI WS:', err);
                        }
                    } else {
                        log.warn('OpenAI WS not open, skipping audio frame');
                    }
                }
            });
            const opusDecoder = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
            opusStream.pipe(opusDecoder);
            opusDecoder.pipe(passthrough, { end: false });
            userStreams.set(userId, { decoder: opusDecoder, passthrough, ffmpeg, buffer });
            opusStream.once('end', async () => {
                log.info(`User ${userId} stopped speaking`);
                activeUsers.delete(userId);
                // Clean up user pipeline
                const entry = userStreams.get(userId);
                if (entry) {
                    try { entry.decoder.destroy(); } catch {}
                    try { entry.passthrough.end(); } catch {}
                    try { entry.ffmpeg.stdin.end(); } catch {}
                    try { entry.ffmpeg.kill(); } catch {}
                    userStreams.delete(userId);
                }
                if (activeUsers.size === 0) {
                    endTimer = setTimeout(() => {
                        activeUsers.clear();
                        endTimer = null;
                    }, DEBOUNCE_MS);
                }
            });
        } else {
            log.warn(`User ${userId} is already being processed`);
        }
    };

    voiceConnection.on('speakingStart', (userId) => {
        onSpeechStart(userId);
    });

    voiceConnection.on('speakingStop', (userId) => {
        log.info(`User ${userId} stopped speaking`);
        activeUsers.delete(userId);
        // Clean up user pipeline
        const entry = userStreams.get(userId);
        if (entry) {
            try { entry.decoder.destroy(); } catch {}
            try { entry.passthrough.end(); } catch {}
            try { entry.ffmpeg.stdin.end(); } catch {}
            try { entry.ffmpeg.kill(); } catch {}
            userStreams.delete(userId);
        }
        if (activeUsers.size === 0) {
            endTimer = setTimeout(() => {
                activeUsers.clear();
                endTimer = null;
            }, DEBOUNCE_MS);
        }
    });
}

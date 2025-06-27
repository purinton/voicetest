import WebSocket from 'ws';
import prism from 'prism-media';
import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'child_process';

export function setupAudioInput({ voiceConnection, openAIWS, log }) {
    const userConverters = new Map(); // converters are pooled per user and not destroyed on silence
    const activeUsers = new Set();
    let endTimer;
    const DEBOUNCE_MS = 100;
    const PCM_FRAME_SIZE_BYTES_24 = 480 * 2;

    // per-user PCM cache for slicing frames
    const userCache = new Map();

    voiceConnection.receiver.speaking.on('start', (userId) => {
        activeUsers.add(userId);
        if (endTimer) { clearTimeout(endTimer); endTimer = null; }
        log.info(`User ${userId} started speaking`);
        const opusStream = voiceConnection.receiver.subscribe(userId, {
            end: { behavior: 'silence', duration: 100 },
        });
        if (!userConverters.has(userId)) {
            const opusDecoder = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
            opusStream.pipe(opusDecoder);
            const converter = spawn(ffmpegStatic, [
                '-f', 's16le',
                '-ar', '48000',
                '-ac', '1',
                '-i', '-',
                '-f', 's16le',
                '-ar', '24000',
                '-ac', '1',
                'pipe:1',
            ]);
            converter.on('error', log.error);
            converter.stderr.on('data', data => log.debug('discord ffmpeg stderr:', data.toString()));
            opusDecoder.pipe(converter.stdin);
            let cache = Buffer.alloc(0);
            converter.stdout.on('data', chunk => {
                cache = Buffer.concat([cache, chunk]);
                while (cache.length >= PCM_FRAME_SIZE_BYTES_24) {
                    const frame = cache.slice(0, PCM_FRAME_SIZE_BYTES_24);
                    cache = cache.slice(PCM_FRAME_SIZE_BYTES_24);
                    if (openAIWS && openAIWS.readyState === WebSocket.OPEN) {
                        const payload = JSON.stringify({ type: 'input_audio_buffer.append', audio: frame.toString('base64') });
                        log.debug(`[OpenAI audio send] frame size ${frame.length} bytes`);
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
            userConverters.set(userId, { opusDecoder, converter });
            opusStream.once('end', () => {
                log.info(`User ${userId} stopped speaking`);
                activeUsers.delete(userId);
                if (activeUsers.size === 0) {
                    endTimer = setTimeout(() => {
                        // retain converters for reuse; just clear pending batches
                        activeUsers.clear();
                        endTimer = null;
                    }, DEBOUNCE_MS);
                }
            });
        }
    });
}

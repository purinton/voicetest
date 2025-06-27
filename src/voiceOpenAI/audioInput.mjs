import WebSocket from 'ws';
import prism from 'prism-media';
import Sox from 'sox.js';

export function setupAudioInput({ voiceConnection, openAIWS, log }) {
    const userConverters = new Map(); // converters are pooled per user and not destroyed on silence
    const activeUsers = new Set();
    let endTimer;
    const DEBOUNCE_MS = 100;
    const PCM_FRAME_SIZE_BYTES_24 = 480 * 2;

    // handler for user speech start
    const onSpeechStart = (userId) => {
        activeUsers.add(userId);
        if (endTimer) { clearTimeout(endTimer); endTimer = null; }
        log.info(`User ${userId} started speaking`);
        const opusStream = voiceConnection.receiver.subscribe(userId, {
            end: { behavior: 'silence', duration: 100 },
        });
        if (!userConverters.has(userId)) {
            const opusDecoder = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
            opusStream.pipe(opusDecoder);
            // Setup sox.js resampler for 48kHz -> 24kHz
            const sox = new Sox();
            let soxReady = false;
            let soxStream;
            sox.on('ready', () => {
                soxReady = true;
                soxStream = sox.transform({
                    input: { rate: 48000, channels: 1, type: 'raw', encoding: 'signed-integer', bits: 16 },
                    output: { rate: 24000, channels: 1, type: 'raw', encoding: 'signed-integer', bits: 16 },
                    effects: []
                });
                opusDecoder.pipe(soxStream);
                let cache = Buffer.alloc(0);
                soxStream.on('data', chunk => {
                    cache = Buffer.concat([cache, chunk]);
                    while (cache.length >= PCM_FRAME_SIZE_BYTES_24) {
                        const frame = cache.slice(0, PCM_FRAME_SIZE_BYTES_24);
                        cache = cache.slice(PCM_FRAME_SIZE_BYTES_24);
                        if (openAIWS && openAIWS.readyState === WebSocket.OPEN) {
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
            });
            userConverters.set(userId, { opusDecoder, sox, soxStream });
            opusStream.once('end', () => {
                log.info(`User ${userId} stopped speaking`);
                activeUsers.delete(userId);
                if (activeUsers.size === 0) {
                    endTimer = setTimeout(() => {
                        activeUsers.clear();
                        endTimer = null;
                    }, DEBOUNCE_MS);
                }
            });
        }
    };
    voiceConnection.receiver.speaking.on('start', onSpeechStart);

    // Return a cleanup function to remove listeners and destroy converters
    return () => {
        voiceConnection.receiver.speaking.off('start', onSpeechStart);
        for (const { sox, opusDecoder } of userConverters.values()) {
            try { sox && sox.close && sox.close(); } catch {};
            try { opusDecoder.destroy(); } catch {};
        }
        userConverters.clear();
        activeUsers.clear();
        if (endTimer) { clearTimeout(endTimer); endTimer = null; }
        log.info('Cleaned up audio input handlers and converters');
    };
}

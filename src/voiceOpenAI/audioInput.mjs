import WebSocket from 'ws';
import prism from 'prism-media';

export function setupAudioInput({ voiceConnection, openAIWS, log, ffmpeg48to24 }) {
    const PCM_FRAME_SIZE_BYTES_24 = 480 * 2;
    const userDecoders = new Map();
    let endTimer;
    const DEBOUNCE_MS = 100;
    const activeUsers = new Set();

    // handler for user speech start
    const onSpeechStart = (userId) => {
        activeUsers.add(userId);
        if (endTimer) { clearTimeout(endTimer); endTimer = null; }
        log.info(`User ${userId} started speaking`);
        const opusStream = voiceConnection.receiver.subscribe(userId, {
            end: { behavior: 'silence', duration: 100 },
        });
        if (!userDecoders.has(userId)) {
            const opusDecoder = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
            opusStream.pipe(opusDecoder);
            opusDecoder.on('data', chunk => {
                // Write all decoded PCM to the shared ffmpeg stdin
                try {
                    ffmpeg48to24.stdin.write(chunk);
                } catch (err) {
                    log.error('Error writing to ffmpeg48to24:', err);
                }
            });
            userDecoders.set(userId, opusDecoder);
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

    // Listen to ffmpeg48to24 stdout and send to OpenAI
    let cache = Buffer.alloc(0);
    ffmpeg48to24.stdout.on('data', chunk => {
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

    // Return a cleanup function to remove listeners and destroy decoders
    return () => {
        voiceConnection.receiver.speaking.off('start', onSpeechStart);
        for (const opusDecoder of userDecoders.values()) {
            try { opusDecoder.destroy(); } catch {};
        }
        userDecoders.clear();
        activeUsers.clear();
        if (endTimer) { clearTimeout(endTimer); endTimer = null; }
        log.info('Cleaned up audio input handlers and decoders');
    };
}

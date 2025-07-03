import WebSocket from 'ws';
import prism from 'prism-media';
import { Resampler } from '@purinton/resampler';

export function setupAudioInput({ voiceConnection, openAIWS, log }) {
    const userConverters = new Map(); // converters are pooled per user and not destroyed on silence
    const activeUsers = new Set();
    const PCM_FRAME_SIZE_BYTES_24 = 480 * 2;
    let endTimer;
    const onSpeechStart = (userId) => {
        activeUsers.add(userId);
        if (endTimer) { clearTimeout(endTimer); endTimer = null; }
        log.debug(`User ${userId} started speaking`);
        const opusStream = voiceConnection.receiver.subscribe(userId, {
            end: { behavior: 'silence', duration: 100 },
        });
        if (!userConverters.has(userId)) {
            const opusDecoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
            opusStream.pipe(opusDecoder);
            const resampler = new Resampler({ inRate: 48000, outRate: 24000, inChannels: 2, outChannels: 1 });
            opusDecoder.pipe(resampler);
            let cache = Buffer.alloc(0);
            resampler.on('data', chunk => {
                cache = Buffer.concat([cache, chunk]);
                while (cache.length >= PCM_FRAME_SIZE_BYTES_24) {
                    const frame = cache.subarray(0, PCM_FRAME_SIZE_BYTES_24);
                    cache = cache.subarray(PCM_FRAME_SIZE_BYTES_24);
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
            userConverters.set(userId, { opusDecoder, resampler });
        }
    };
    voiceConnection.receiver.speaking.on('start', onSpeechStart);

    // Return a cleanup function to remove listeners and destroy converters
    return () => {
        voiceConnection.receiver.speaking.off('start', onSpeechStart);
        for (const { resampler, opusDecoder } of userConverters.values()) {
            try {
                resampler.unpipe();
                resampler.destroy();
            } catch { };
            try {
                opusDecoder.unpipe();
                opusDecoder.destroy();
            } catch { };
        }
        userConverters.clear();
        activeUsers.clear();
        if (endTimer) { clearTimeout(endTimer); endTimer = null; }
        log.debug('Audio input cleanup complete');
    };
}

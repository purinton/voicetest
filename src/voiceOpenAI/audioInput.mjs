import WebSocket from 'ws';
import prism from 'prism-media';
import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'child_process';

export function setupAudioInput({ voiceConnection, openAIWS, log }) {
    const userConverters = new Map(); // converters are pooled per user and not destroyed on silence
    const activeUsers = new Set();
    const PCM_FRAME_SIZE_BYTES_24 = 480 * 2;
    const userCache = new Map();
    const onSpeechStart = (userId) => {
        activeUsers.add(userId);
        log.info(`User ${userId} started speaking`);
        const opusStream = voiceConnection.receiver.subscribe(userId, {
            end: { behavior: 'silence', duration: 100 },
        });
        if (!userConverters.has(userId)) {
            const opusDecoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
            opusStream.pipe(opusDecoder);
            const converter = spawn(ffmpegStatic, [
                '-f', 's16le',
                '-ar', '48000',
                '-ac', '2',
                '-i', '-',
                '-af', 'pan=mono|c0=0.5*c0+0.5*c1,afftdn',
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
                if (cache.length > 0) {
                    if (openAIWS && openAIWS.readyState === WebSocket.OPEN) {
                        const payload = JSON.stringify({ type: 'input_audio_buffer.append', audio: cache.toString('base64') });
                        try {
                            openAIWS.send(payload);
                        } catch (err) {
                            log.error('Error sending final audio to OpenAI WS:', err);
                        }
                    } else {
                        log.warn('OpenAI WS not open, skipping final audio frame');
                    }
                    cache = Buffer.alloc(0);
                }
                activeUsers.delete(userId);
            });
        }
    };
    voiceConnection.receiver.speaking.on('start', onSpeechStart);
    return () => {
        voiceConnection.receiver.speaking.off('start', onSpeechStart);
        for (const { converter, opusDecoder } of userConverters.values()) {
            try { converter.stdin.end(); } catch {};
            try { converter.kill(); } catch {};
            try { opusDecoder.destroy(); } catch {};
        }
        userConverters.clear();
        userCache.clear();
        activeUsers.clear();
        log.info('Cleaned up audio input handlers and converters');
    };
}

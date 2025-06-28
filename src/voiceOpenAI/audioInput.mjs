import WebSocket from 'ws';
import prism from 'prism-media';
import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'child_process';
import { PassThrough } from 'stream';

export function setupAudioInput({ voiceConnection, openAIWS, log }) {
    const userDecoders = new Map(); // Only opus decoders per user
    const activeUsers = new Set();
    let endTimer;
    const DEBOUNCE_MS = 100;
    const PCM_FRAME_SIZE_BYTES_24 = 480 * 2;

    // Shared PassThrough and ffmpeg process for all users
    const sharedInput = new PassThrough();
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
    const sharedFfmpeg = spawn(ffmpegStatic, ffmpegArgs);
    sharedFfmpeg.on('error', log.error);
    sharedFfmpeg.stderr.on('data', data => log.debug('discord ffmpeg stderr:', data.toString()));
    sharedInput.pipe(sharedFfmpeg.stdin);

    // Buffer for slicing output
    let cache = Buffer.alloc(0);
    sharedFfmpeg.stdout.on('data', chunk => {
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
            opusDecoder.pipe(sharedInput, { end: false }); // Don't end sharedInput when a user leaves
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

    // Return a cleanup function to remove listeners and destroy decoders/ffmpeg
    return () => {
        voiceConnection.receiver.speaking.off('start', onSpeechStart);
        for (const opusDecoder of userDecoders.values()) {
            try { opusDecoder.destroy(); } catch {};
        }
        userDecoders.clear();
        try { sharedInput.end(); } catch {};
        try { sharedFfmpeg.stdin.end(); } catch {};
        try { sharedFfmpeg.kill(); } catch {};
        cache = Buffer.alloc(0);
        activeUsers.clear();
        if (endTimer) { clearTimeout(endTimer); endTimer = null; }
        log.info('Cleaned up audio input handlers and shared ffmpeg');
    };
}

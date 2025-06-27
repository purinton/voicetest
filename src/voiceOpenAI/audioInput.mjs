import WebSocket from 'ws';
import prism from 'prism-media';
import { PassThrough } from 'stream';

export function setupAudioInput({ voiceConnection, openAIWS, log, ffmpeg48to24 }) {
    const PCM_FRAME_SIZE_BYTES_48 = 960 * 2;
    // Merge all user PCM into a single stream
    const mergedPcmStream = new PassThrough();
    // Pipe merged PCM to persistent ffmpeg48to24
    mergedPcmStream.pipe(ffmpeg48to24.stdin);
    // Handle ffmpeg48to24 output and send to OpenAI
    let cache = Buffer.alloc(0);
    const PCM_FRAME_SIZE_BYTES_24 = 480 * 2;
    ffmpeg48to24.stdout.on('data', chunk => {
        cache = Buffer.concat([cache, chunk]);
        while (cache.length >= PCM_FRAME_SIZE_BYTES_24) {
            const frame = cache.slice(0, PCM_FRAME_SIZE_BYTES_24);
            cache = cache.slice(PCM_FRAME_SIZE_BYTES_24);
            if (openAIWS && openAIWS.readyState === WebSocket.OPEN) {
                const payload = JSON.stringify({ type: 'input_audio_buffer.append', audio: frame.toString('base64') });
                try { openAIWS.send(payload); } catch (err) { log.error('Error sending audio to OpenAI WS:', err); }
            } else {
                log.warn('OpenAI WS not open, skipping audio frame');
            }
        }
    });
    // Per-user PCM decode and merge
    const onSpeechStart = (userId) => {
        log.info(`User ${userId} started speaking`);
        const opusStream = voiceConnection.receiver.subscribe(userId, {
            end: { behavior: 'silence', duration: 100 },
        });
        const opusDecoder = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
        opusStream.pipe(opusDecoder);
        opusDecoder.on('data', chunk => {
            mergedPcmStream.write(chunk);
        });
        opusStream.once('end', () => {
            log.info(`User ${userId} stopped speaking`);
        });
    };
    voiceConnection.receiver.speaking.on('start', onSpeechStart);
    // Cleanup
    return () => {
        voiceConnection.receiver.speaking.off('start', onSpeechStart);
        mergedPcmStream.end();
        log.info('Cleaned up merged audio input handlers');
    };
}

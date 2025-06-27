import { PassThrough } from 'stream';
import Sox from 'sox.js';
import prism from 'prism-media';
import { createAudioResource, StreamType } from '@discordjs/voice';

const PCM_FRAME_SIZE_BYTES = 960 * 2;

export function createAudioPlayback(filter, audioPlayer, log) {
    let pcmCache = Buffer.alloc(0);
    let playbackStream;
    let sox;
    let soxStream;
    let opusEncoder;

    function handleAudio(audioBuffer) {
        if (!audioPlayer) return;
        pcmCache = Buffer.concat([pcmCache, audioBuffer]);
        if (!playbackStream) {
            playbackStream = new PassThrough();
            sox = new Sox({});
            sox.on('ready', () => {
                soxStream = sox.transform({
                    input: { rate: 24000, channels: 1, type: 'raw', encoding: 'signed-integer', bits: 16 },
                    output: { rate: 48000, channels: 1, type: 'raw', encoding: 'signed-integer', bits: 16 },
                    effects: filter ? [filter] : []
                });
                playbackStream.pipe(soxStream);
                opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
                soxStream.pipe(opusEncoder);
                const resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
                audioPlayer.play(resource);
            });
        }
        while (pcmCache.length >= PCM_FRAME_SIZE_BYTES) {
            const frame = pcmCache.slice(0, PCM_FRAME_SIZE_BYTES);
            pcmCache = pcmCache.slice(PCM_FRAME_SIZE_BYTES);
            playbackStream.write(frame);
        }
    }

    function reset() {
        if (playbackStream) {
            playbackStream.end();
            playbackStream = undefined;
        }
        if (sox) {
            try { sox.close && sox.close(); } catch {}
            sox = undefined;
        }
        pcmCache = Buffer.alloc(0);
    }

    return { handleAudio, reset };
}

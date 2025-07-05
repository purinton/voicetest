import prism from 'prism-media';
import { PassThrough } from 'stream';
import { Resampler } from '@purinton/resampler';
import { createAudioResource, StreamType } from '@discordjs/voice';

const PCM_FRAME_SIZE_BYTES = 960 * 2;
const JITTER_BUFFER_FRAMES = 5; // 100ms jitter (5 * 20ms frames)

export function createAudioPlayback(audioPlayer) {
    let pcmCache = Buffer.alloc(0);
    let playbackStream;
    function handleAudio(audioBuffer) {
        if (!audioPlayer) return;
        pcmCache = Buffer.concat([pcmCache, audioBuffer]);
        if (!playbackStream) {
            if (pcmCache.length < PCM_FRAME_SIZE_BYTES * JITTER_BUFFER_FRAMES) return;
            const resampler = new Resampler({ inRate: 24000, outRate: 48000, inChannels: 1, outChannels: 1, filterWindow: 8 });
            const opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
            playbackStream = new PassThrough();
            playbackStream.pipe(resampler).pipe(opusEncoder);
            const resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
            audioPlayer.play(resource);
        }
        while (pcmCache.length >= PCM_FRAME_SIZE_BYTES) {
            const frame = pcmCache.subarray(0, PCM_FRAME_SIZE_BYTES);
            pcmCache = pcmCache.subarray(PCM_FRAME_SIZE_BYTES);
            playbackStream.write(frame);
        }
    }


    function reset() {
        if (playbackStream) {
            if (pcmCache.length > 0) {
                const remainder = pcmCache.length % PCM_FRAME_SIZE_BYTES;
                const framePad = remainder > 0 ? Buffer.alloc(PCM_FRAME_SIZE_BYTES - remainder) : Buffer.alloc(0);
                const tailPad = Buffer.alloc(PCM_FRAME_SIZE_BYTES * JITTER_BUFFER_FRAMES);
                const flushed = Buffer.concat([pcmCache, framePad, tailPad]);
                for (let offset = 0; offset < flushed.length; offset += PCM_FRAME_SIZE_BYTES) {
                    playbackStream.write(flushed.subarray(offset, offset + PCM_FRAME_SIZE_BYTES));
                }
                pcmCache = Buffer.alloc(0);
            }
            playbackStream.end();
        }
        playbackStream = null;
        pcmCache = Buffer.alloc(0);
    }

    return { handleAudio, reset };
}


import prism from 'prism-media';
import { PassThrough } from 'stream';
import { Resampler } from '@purinton/resampler';
import { createAudioResource, StreamType } from '@discordjs/voice';

const PCM_FRAME_SIZE_BYTES = 960 * 2;

export function createAudioPlayback(audioPlayer, log) {
    let pcmCache = Buffer.alloc(0);
    let playbackStream;
    let resampler;
    let opusEncoder;
    let resource;

    function handleAudio(audioBuffer) {
        if (!audioPlayer) return;
        pcmCache = Buffer.concat([pcmCache, audioBuffer]);
        resampler = new Resampler({ inRate: 24000, outRate: 48000, inChannels: 1, outChannels: 1, filterWindow: 8 });
        opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
        playbackStream = new PassThrough();
        playbackStream.pipe(resampler).pipe(opusEncoder);
        resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
        audioPlayer.play(resource);
        playbackStream.on('finish', () => {
            log.debug('Audio playback stream finished');
            resampler = null;
            opusEncoder = null;
            playbackStream = null;
        });
        while (pcmCache.length >= PCM_FRAME_SIZE_BYTES) {
            const frame = pcmCache.subarray(0, PCM_FRAME_SIZE_BYTES);
            pcmCache = pcmCache.subarray(PCM_FRAME_SIZE_BYTES);
            playbackStream.write(frame);
        }
    }

    return { handleAudio };
}

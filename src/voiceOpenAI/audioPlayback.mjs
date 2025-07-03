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
        if (!playbackStream) {
            resampler = new Resampler({ inRate: 24000, outRate: 48000, inChannels: 1, outChannels: 1, filterWindow: 8 });
            opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
            playbackStream = new PassThrough();
            playbackStream.pipe(resampler).pipe(opusEncoder);
            resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
            audioPlayer.play(resource);
        }
        while (pcmCache.length >= PCM_FRAME_SIZE_BYTES) {
            const frame = pcmCache.subarray(0, PCM_FRAME_SIZE_BYTES);
            pcmCache = pcmCache.subarray(PCM_FRAME_SIZE_BYTES);
            playbackStream.write(frame);
        }
    }


    function reset() {
        // if (playbackStream) {
        //     playbackStream.end();
        //     playbackStream.destroy();
        //     playbackStream = undefined;
        // }
        // if (resampler) {
        //     if (typeof resampler.unpipe === 'function') resampler.unpipe();
        //     if (typeof resampler.destroy === 'function') resampler.destroy();
        //     resampler = undefined;
        // }
        // if (opusEncoder) {
        //     if (typeof opusEncoder.unpipe === 'function') opusEncoder.unpipe();
        //     if (typeof opusEncoder.destroy === 'function') opusEncoder.destroy();
        //     opusEncoder = undefined;
        // }
        // if (resource) {
        //     resource = undefined;
        // }
        // pcmCache = Buffer.alloc(0);
        // if (audioPlayer) {
        //     audioPlayer.stop();
        // }
        // log.debug('Audio playback reset complete');
    }

    return { handleAudio, reset };
}

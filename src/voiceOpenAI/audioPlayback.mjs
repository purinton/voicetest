import { PassThrough } from 'stream';
import prism from 'prism-media';
import { createAudioResource, StreamType } from '@discordjs/voice';

export function createAudioPlayback(filter, audioPlayer, log, ffmpeg24to48) {
    let pcmCache = Buffer.alloc(0);
    let playbackStream;

    function handleAudio(audioBuffer) {
        if (!audioPlayer) return;
        pcmCache = Buffer.concat([pcmCache, audioBuffer]);
        if (!playbackStream) {
            playbackStream = new PassThrough();
            // Pipe playbackStream to persistent ffmpeg24to48
            playbackStream.pipe(ffmpeg24to48.stdin);
            // ffmpeg24to48 output to Opus encoder
            const opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
            ffmpeg24to48.stdout.pipe(opusEncoder);
            const resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
            audioPlayer.play(resource);
        }
        const PCM_FRAME_SIZE_BYTES_24 = 480 * 2;
        while (pcmCache.length >= PCM_FRAME_SIZE_BYTES_24) {
            const frame = pcmCache.slice(0, PCM_FRAME_SIZE_BYTES_24);
            pcmCache = pcmCache.slice(PCM_FRAME_SIZE_BYTES_24);
            playbackStream.write(frame);
        }
    }

    function reset() {
        if (playbackStream) {
            playbackStream.end();
            playbackStream = undefined;
        }
        pcmCache = Buffer.alloc(0);
    }

    return { handleAudio, reset };
}

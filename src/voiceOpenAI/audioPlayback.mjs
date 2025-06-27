import { PassThrough } from 'stream';
import prism from 'prism-media';
import { createAudioResource, StreamType } from '@discordjs/voice';

export function createAudioPlayback(filter, audioPlayer, log, ffmpeg24to48) {
    let pcmCache = Buffer.alloc(0);
    // Persistent playback stream and encoder
    const playbackStream = new PassThrough();
    playbackStream.pipe(ffmpeg24to48.stdin);
    const opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
    ffmpeg24to48.stdout.pipe(opusEncoder);
    const resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
    audioPlayer.play(resource);
    function handleAudio(audioBuffer) {
        if (!audioPlayer) return;
        pcmCache = Buffer.concat([pcmCache, audioBuffer]);
        const PCM_FRAME_SIZE_BYTES_24 = 480 * 2;
        while (pcmCache.length >= PCM_FRAME_SIZE_BYTES_24) {
            const frame = pcmCache.slice(0, PCM_FRAME_SIZE_BYTES_24);
            pcmCache = pcmCache.slice(PCM_FRAME_SIZE_BYTES_24);
            playbackStream.write(frame);
        }
    }
    function reset() {
        pcmCache = Buffer.alloc(0);
    }
    return { handleAudio, reset };
}

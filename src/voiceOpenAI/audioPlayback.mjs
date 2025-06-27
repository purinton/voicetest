import { PassThrough } from 'stream';
import prism from 'prism-media';
import { createAudioResource, StreamType } from '@discordjs/voice';

export function createAudioPlayback(filter, audioPlayer, log, ffmpeg24to48) {
    function handleAudio(audioBuffer) {
        if (!audioPlayer) return;
        // For each reply, create a new PassThrough and Opus encoder
        const playbackStream = new PassThrough();
        playbackStream.end(audioBuffer); // Write all audio at once and end
        playbackStream.pipe(ffmpeg24to48.stdin, { end: false }); // Do not end ffmpeg stdin
        const opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
        ffmpeg24to48.stdout.pipe(opusEncoder);
        const resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
        audioPlayer.play(resource);
    }
    function reset() {
        // No-op for persistent ffmpeg
    }
    return { handleAudio, reset };
}

import prism from 'prism-media';
import { createAudioResource, StreamType } from '@discordjs/voice';

export function createAudioPlayback(filter, audioPlayer, log, ffmpeg24to48) {
    // Defensive: check ffmpeg24to48.stdout exists
    if (!ffmpeg24to48 || !ffmpeg24to48.stdout) {
        throw new Error('ffmpeg24to48 process or its stdout is undefined');
    }
    // Persistent Opus encoder pipeline: PCM48k from ffmpeg -> Opus
    const opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
    ffmpeg24to48.stdout.pipe(opusEncoder);
    const resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
    audioPlayer.play(resource);

    function handleAudio(audioBuffer) {
        // Write raw PCM24k data to ffmpeg input
        const ok = ffmpeg24to48.stdin.write(audioBuffer);
        if (!ok) log.debug('[playback] ffmpeg24to48 stdin backpressure');
    }

    function reset() {
        // No-op for persistent pipeline
    }

    return { handleAudio, reset };
}

import prism from 'prism-media';
import { createAudioResource, StreamType, AudioPlayerStatus } from '@discordjs/voice';

const PCM_FRAME_SIZE_BYTES = 960 * 2;

export function createAudioPlayback(audioPlayer, log, ffmpeg24to48) {
    let pcmCache = Buffer.alloc(0);
    let opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
    let resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
    let isPiped = false;

    // Pipe ffmpeg24to48's stdout to Opus encoder and Discord ONCE, immediately
    ffmpeg24to48.stdout.pipe(opusEncoder);
    audioPlayer.play(resource);
    isPiped = true;

    // Optionally, auto-replay if stopped (for long-lived streams)
    audioPlayer.on(AudioPlayerStatus.Idle, () => {
        log.debug('AudioPlayer became idle, replaying resource');
        audioPlayer.play(resource);
    });

    function handleAudio(audioBuffer) {
        if (!audioPlayer || !ffmpeg24to48) return;
        pcmCache = Buffer.concat([pcmCache, audioBuffer]);
        while (pcmCache.length >= PCM_FRAME_SIZE_BYTES) {
            const frame = pcmCache.slice(0, PCM_FRAME_SIZE_BYTES);
            pcmCache = pcmCache.slice(PCM_FRAME_SIZE_BYTES);
            try {
                ffmpeg24to48.stdin.write(frame);
            } catch (err) {
                log.error('Error writing to ffmpeg24to48:', err);
            }
        }
    }

    function reset() {
        pcmCache = Buffer.alloc(0);
        // No need to end the persistent stream
    }

    return { handleAudio, reset };
}

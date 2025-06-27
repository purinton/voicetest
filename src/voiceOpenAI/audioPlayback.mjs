import prism from 'prism-media';
import { createAudioResource, StreamType, AudioPlayerStatus } from '@discordjs/voice';

const PCM_FRAME_SIZE_BYTES = 960 * 2;

export function createAudioPlayback(audioPlayer, log, ffmpeg24to48) {
    let pcmCache = Buffer.alloc(0);
    let opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
    let resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });

    log.debug('Spawning persistent ffmpeg 24to48 process for playback');
    ffmpeg24to48.stdout.on('data', (chunk) => {
        log.debug(`[Playback] ffmpeg24to48.stdout emitted data, size: ${chunk.length}`);
    });
    ffmpeg24to48.stdout.pipe(opusEncoder);
    audioPlayer.play(resource);
    audioPlayer.on(AudioPlayerStatus.Idle, () => {
        log.debug('AudioPlayer became idle, replaying resource');
        audioPlayer.play(resource);
    });

    function handleAudio(audioBuffer) {
        if (!audioPlayer || !ffmpeg24to48) return;
        log.debug(`[Playback] handleAudio called with buffer size: ${audioBuffer.length}`);
        pcmCache = Buffer.concat([pcmCache, audioBuffer]);
        while (pcmCache.length >= PCM_FRAME_SIZE_BYTES) {
            const frame = pcmCache.slice(0, PCM_FRAME_SIZE_BYTES);
            pcmCache = pcmCache.slice(PCM_FRAME_SIZE_BYTES);
            log.debug(`[Playback] Writing frame to ffmpeg24to48.stdin, frame size: ${frame.length}, first bytes: ${frame.slice(0,8).toString('hex')}`);
            try {
                ffmpeg24to48.stdin.write(frame);
            } catch (err) {
                log.error('Error writing to ffmpeg24to48:', err);
            }
        }
    }

    function reset() {
        pcmCache = Buffer.alloc(0);
    }

    return { handleAudio, reset };
}

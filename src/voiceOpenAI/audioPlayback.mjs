import prism from 'prism-media';
import { createAudioResource, StreamType } from '@discordjs/voice';
import { PassThrough } from 'stream';

const PCM_FRAME_SIZE_BYTES = 960 * 2;

export function createAudioPlayback(audioPlayer, log, ffmpeg24to48) {
    let pcmCache = Buffer.alloc(0);
    let playbackStream = null;
    let opusEncoder = null;

    function startPlaybackStream() {
        if (playbackStream) return playbackStream;
        playbackStream = new PassThrough();
        opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
        ffmpeg24to48.stdout.unpipe();
        ffmpeg24to48.stdout.pipe(playbackStream);
        playbackStream.pipe(opusEncoder);
        const resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
        audioPlayer.play(resource);
        log.debug('[Playback] Started new playback stream and resource');
        return playbackStream;
    }

    function handleAudio(audioBuffer) {
        if (!audioPlayer || !ffmpeg24to48) return;
        log.debug(`[Playback] handleAudio called with buffer size: ${audioBuffer.length}`);
        const stream = startPlaybackStream();
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
        if (playbackStream) {
            playbackStream.end();
            playbackStream = null;
            opusEncoder = null;
            log.debug('[Playback] Reset and closed playback stream');
        }
    }

    return { handleAudio, reset };
}

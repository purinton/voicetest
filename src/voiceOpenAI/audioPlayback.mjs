import { PassThrough } from 'stream';
import prism from 'prism-media';
import { createAudioResource, StreamType } from '@discordjs/voice';

const PCM_FRAME_SIZE_BYTES = 960 * 2;

export function createAudioPlayback(audioPlayer, log, ffmpeg24to48Stdin) {
    let pcmCache = Buffer.alloc(0);
    let playbackStream;
    let outputStream;

    function setInputStream(stdin) {
        // Set the input stream for ffmpeg24to48
        outputStream = null;
        ffmpeg24to48Stdin = stdin;
    }

    function setOutputStream(stdout) {
        // Set the output stream for ffmpeg24to48
        outputStream = stdout;
        if (outputStream && audioPlayer) {
            const opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
            outputStream.pipe(opusEncoder);
            const resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
            audioPlayer.play(resource);
        }
    }

    function handleAudio(audioBuffer) {
        if (!audioPlayer || !ffmpeg24to48Stdin) return;
        pcmCache = Buffer.concat([pcmCache, audioBuffer]);
        while (pcmCache.length >= PCM_FRAME_SIZE_BYTES) {
            const frame = pcmCache.slice(0, PCM_FRAME_SIZE_BYTES);
            pcmCache = pcmCache.slice(PCM_FRAME_SIZE_BYTES);
            try {
                ffmpeg24to48Stdin.write(frame);
            } catch (err) {
                log.error('Error writing to ffmpeg24to48:', err);
            }
        }
    }

    function reset() {
        pcmCache = Buffer.alloc(0);
        // No need to end the persistent stream
    }

    return { handleAudio, reset, setInputStream, setOutputStream };
}

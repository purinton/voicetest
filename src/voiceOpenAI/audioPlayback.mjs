import { PassThrough } from 'stream';
import { spawn } from 'child_process';
import prism from 'prism-media';
import ffmpegStatic from 'ffmpeg-static';
import { createAudioResource, StreamType } from '@discordjs/voice';

const PCM_FRAME_SIZE_BYTES = 960 * 2;

export function createAudioPlayback(filter, audioPlayer, log) {
    let responsePcmBuffer = Buffer.alloc(0);
    let isPlaying = false;
    let playbackStream;
    let ffmpegProcess;
    let opusEncoder;

    // Called for every audio delta
    function handleAudio(audioBuffer, isDone = false) {
        if (!audioPlayer) return;
        responsePcmBuffer = Buffer.concat([responsePcmBuffer, audioBuffer]);
        if (isDone) {
            playBufferedResponse();
        }
    }

    // Called on response.audio.done
    function playBufferedResponse() {
        if (isPlaying || responsePcmBuffer.length === 0) {
            responsePcmBuffer = Buffer.alloc(0);
            return;
        }
        isPlaying = true;
        playbackStream = new PassThrough();
        const ffmpegArgs = [
            '-f', 's16le',
            '-ar', '24000',
            '-ac', '1',
            '-i', '-',
            '-filter:a', filter,
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '1',
            'pipe:1',
        ];
        ffmpegProcess = spawn(ffmpegStatic, ffmpegArgs);
        ffmpegProcess.on('error', log.error);
        ffmpegProcess.stderr.on('data', data => log.debug('ffmpeg stderr:', data.toString()));
        opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
        playbackStream.pipe(ffmpegProcess.stdin);
        ffmpegProcess.stdout.pipe(opusEncoder);
        const resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
        audioPlayer.play(resource);
        playbackStream.write(responsePcmBuffer);
        playbackStream.end();
        responsePcmBuffer = Buffer.alloc(0);
        // Cleanup after playback
        audioPlayer.once('idle', () => {
            cleanup();
            isPlaying = false;
        });
    }

    function cleanup() {
        if (playbackStream) {
            playbackStream.end();
            playbackStream = undefined;
        }
        if (ffmpegProcess) {
            try { ffmpegProcess.kill(); } catch (e) { log.error('Error killing ffmpeg process:', e); }
            ffmpegProcess = undefined;
        }
        if (opusEncoder) {
            try { opusEncoder.destroy(); } catch (e) { log.error('Error destroying opus encoder:', e); }
            opusEncoder = undefined;
        }
        log.info('Audio playback pipeline cleaned up');
    }

    // Expose a reset for external force-cleanup
    function reset() {
        cleanup();
        responsePcmBuffer = Buffer.alloc(0);
        isPlaying = false;
        log.info('Audio playback pipeline reset');
    }

    return { handleAudio, reset };
}

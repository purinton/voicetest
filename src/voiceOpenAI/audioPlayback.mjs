import { PassThrough } from 'stream';
import { spawn } from 'child_process';
import prism from 'prism-media';
import ffmpegStatic from 'ffmpeg-static';
import { createAudioResource, StreamType } from '@discordjs/voice';

const PCM_FRAME_SIZE_BYTES = 960 * 2;

export function createAudioPlayback(filter, audioPlayer, log) {
    let pcmCache = Buffer.alloc(0);
    let playbackStream;
    let ffmpegProcess;
    let opusEncoder;
    let resource;

    function handleAudio(audioBuffer, isDone = false) {
        if (!audioPlayer) return;
        pcmCache = Buffer.concat([pcmCache, audioBuffer]);
        if (!playbackStream) {
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
            resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
            audioPlayer.play(resource);
        }
        while (pcmCache.length >= PCM_FRAME_SIZE_BYTES) {
            const frame = pcmCache.slice(0, PCM_FRAME_SIZE_BYTES);
            pcmCache = pcmCache.slice(PCM_FRAME_SIZE_BYTES);
            playbackStream.write(frame);
        }
        if (isDone) {
            if (playbackStream) playbackStream.end();
            pcmCache = Buffer.alloc(0);
        }
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

    function reset() {
        cleanup();
        pcmCache = Buffer.alloc(0);
        log.info('Audio playback pipeline reset');
    }

    return { handleAudio, reset };
}

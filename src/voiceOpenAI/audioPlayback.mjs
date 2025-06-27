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
    let ffmpegReady = false;

    function startFfmpeg() {
        if (ffmpegProcess) return;
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
        ffmpegReady = true;
    }

    function handleAudio(audioBuffer) {
        if (!audioPlayer) return;
        if (!ffmpegReady) startFfmpeg();
        pcmCache = Buffer.concat([pcmCache, audioBuffer]);
        while (pcmCache.length >= PCM_FRAME_SIZE_BYTES) {
            const frame = pcmCache.slice(0, PCM_FRAME_SIZE_BYTES);
            pcmCache = pcmCache.slice(PCM_FRAME_SIZE_BYTES);
            playbackStream.write(frame);
        }
        if (audioPlayer.state.status !== 'playing') {
            audioPlayer.play(resource);
        }
    }

    function reset() {
        pcmCache = Buffer.alloc(0);
        // Optionally flush the stream
        if (playbackStream) playbackStream.end();
        playbackStream = undefined;
        ffmpegReady = false;
        // Do not kill ffmpegProcess here, keep it persistent for reuse
    }

    function cleanup() {
        if (playbackStream) playbackStream.end();
        if (ffmpegProcess) ffmpegProcess.kill();
        if (opusEncoder) opusEncoder.destroy();
        playbackStream = undefined;
        ffmpegProcess = undefined;
        opusEncoder = undefined;
        ffmpegReady = false;
        pcmCache = Buffer.alloc(0);
    }

    return { handleAudio, reset, cleanup };
}

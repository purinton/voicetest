import { PassThrough } from 'stream';
import { spawn } from 'child_process';
import prism from 'prism-media';
import ffmpegStatic from 'ffmpeg-static';
import { createAudioResource, StreamType } from '@discordjs/voice';

export function createAudioPlayback(filter, audioPlayer, log) {
    // Start a persistent PassThrough stream and ffmpeg process for all audio
    const playbackStream = new PassThrough();
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
    const ffmpegProcess = spawn(ffmpegStatic, ffmpegArgs);
    ffmpegProcess.on('error', log.error);
    ffmpegProcess.stderr.on('data', data => log.debug('ffmpeg stderr:', data.toString()));
    const opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
    playbackStream.pipe(ffmpegProcess.stdin);
    ffmpegProcess.stdout.pipe(opusEncoder);
    const resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
    audioPlayer.play(resource);

    function handleAudio(audioBuffer) {
        if (!audioPlayer) return;
        playbackStream.write(audioBuffer);
    }

    function reset() {
        // no-op for persistent ffmpeg playback; state is continuous
    }
    function cleanup() {
        playbackStream.end();
        try { ffmpegProcess.kill(); } catch {};
        try { opusEncoder.destroy(); } catch {};
        log.info('Cleaned up audio playback ffmpeg and encoder');
    }

    return { handleAudio, reset, cleanup };
}

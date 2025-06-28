import { PassThrough } from 'stream';
import { spawn } from 'child_process';
import prism from 'prism-media';
import ffmpegStatic from 'ffmpeg-static';
import { createAudioResource, StreamType } from '@discordjs/voice';

const PCM_FRAME_SIZE_BYTES = 960 * 2;

function generateBlipPCM(durationMs = 100, freq = 880, sampleRate = 24000) {
    // Generate a short sine wave PCM buffer
    const samples = Math.floor(sampleRate * (durationMs / 1000));
    const buffer = Buffer.alloc(samples * 2); // 16-bit mono
    for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;
        const amplitude = 0.25; // reduce volume
        const value = Math.round(Math.sin(2 * Math.PI * freq * t) * 32767 * amplitude);
        buffer.writeInt16LE(value, i * 2);
    }
    return buffer;
}

export function createAudioPlayback(filter, audioPlayer, log) {
    let pcmCache = Buffer.alloc(0);
    let playbackStream;
    let blipInterval = null;
    let blipStream = null;
    let blipResource = null;

    function handleAudio(audioBuffer) {
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
            const ffmpegProcess = spawn(ffmpegStatic, ffmpegArgs);
            ffmpegProcess.on('error', log.error);
            ffmpegProcess.stderr.on('data', data => log.debug('ffmpeg stderr:', data.toString()));
            const opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
            playbackStream.pipe(ffmpegProcess.stdin);
            ffmpegProcess.stdout.pipe(opusEncoder);
            const resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
            audioPlayer.play(resource);
        }
        while (pcmCache.length >= PCM_FRAME_SIZE_BYTES) {
            const frame = pcmCache.slice(0, PCM_FRAME_SIZE_BYTES);
            pcmCache = pcmCache.slice(PCM_FRAME_SIZE_BYTES);
            playbackStream.write(frame);
        }
    }

    function reset() {
        if (playbackStream) {
            playbackStream.end();
            playbackStream = undefined;
        }
        pcmCache = Buffer.alloc(0);
    }

    function startBlip() {
        if (!audioPlayer || blipInterval) return;
        const blipPCM = generateBlipPCM();
        blipStream = new PassThrough();
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
        blipStream.pipe(ffmpegProcess.stdin);
        ffmpegProcess.stdout.pipe(opusEncoder);
        blipResource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
        audioPlayer.play(blipResource);
        // Write blip PCM in a loop
        blipInterval = setInterval(() => {
            if (blipStream && !blipStream.destroyed) {
                blipStream.write(blipPCM);
            }
        }, 150); // play every 150ms
        // Write first blip immediately
        blipStream.write(blipPCM);
    }

    function stopBlip() {
        if (blipInterval) {
            clearInterval(blipInterval);
            blipInterval = null;
        }
        if (blipStream) {
            blipStream.end();
            blipStream = null;
        }
        blipResource = null;
        // Optionally stop audioPlayer if not playing anything else
        if (audioPlayer) {
            try { audioPlayer.stop(); } catch {}
        }
    }

    return { handleAudio, reset, startBlip, stopBlip };
}

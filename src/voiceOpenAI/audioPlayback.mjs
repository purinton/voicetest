import { PassThrough } from 'stream';
import { spawn } from 'child_process';
import prism from 'prism-media';
import ffmpegStatic from 'ffmpeg-static';
import { createAudioResource, StreamType } from '@discordjs/voice';

const PCM_FRAME_SIZE_BYTES = 960 * 2;

function generateBlipPCM(durationMs = 300, freq = 440, sampleRate = 24000) {
    // Generate a longer, louder sine wave PCM buffer
    const samples = Math.floor(sampleRate * (durationMs / 1000));
    const buffer = Buffer.alloc(samples * 2); // 16-bit mono
    const amplitude = 0.9; // much louder
    for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;
        const value = Math.round(Math.sin(2 * Math.PI * freq * t) * 32767 * amplitude);
        buffer.writeInt16LE(value, i * 2);
    }
    // Log a few sample values for debug
    console.debug('[blip] PCM sample values:', Array.from(buffer.slice(0, 20)));
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
        if (!audioPlayer) {
            log.debug('[blip] audioPlayer not available');
            return;
        }
        if (blipInterval) {
            log.debug('[blip] blipInterval already running');
            return;
        }
        log.debug('[blip] Starting blip playback');
        const blipPCM = generateBlipPCM();
        log.debug('[blip] PCM length:', blipPCM.length);
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
        log.debug('[blip] Spawning ffmpeg for blip with args:', ffmpegArgs);
        const ffmpegProcess = spawn(ffmpegStatic, ffmpegArgs);
        ffmpegProcess.on('error', err => log.error('[blip] ffmpeg error:', err));
        ffmpegProcess.stderr.on('data', data => log.debug('[blip] ffmpeg stderr:', data.toString()));
        const opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
        blipStream.pipe(ffmpegProcess.stdin);
        ffmpegProcess.stdout.pipe(opusEncoder);
        blipResource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
        audioPlayer.play(blipResource);
        log.debug('[blip] Started playing blipResource');
        // Write blip PCM in a loop
        blipInterval = setInterval(() => {
            if (blipStream && !blipStream.destroyed) {
                log.debug('[blip] Writing blipPCM to blipStream');
                blipStream.write(blipPCM);
            } else {
                log.debug('[blip] blipStream destroyed or missing');
            }
        }, 350); // play every 350ms (matches new duration)
        // Write first blip immediately
        log.debug('[blip] Writing first blipPCM');
        blipStream.write(blipPCM);
    }

    function stopBlip() {
        log.debug('[blip] Stopping blip playback');
        if (blipInterval) {
            clearInterval(blipInterval);
            blipInterval = null;
            log.debug('[blip] Cleared blipInterval');
        }
        if (blipStream) {
            blipStream.end();
            blipStream = null;
            log.debug('[blip] Ended and cleared blipStream');
        }
        blipResource = null;
        // Optionally stop audioPlayer if not playing anything else
        if (audioPlayer) {
            try { audioPlayer.stop(); log.debug('[blip] Stopped audioPlayer'); } catch (e) { log.error('[blip] Error stopping audioPlayer:', e); }
        }
    }

    return { handleAudio, reset, startBlip, stopBlip };
}

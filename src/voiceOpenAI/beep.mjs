// --- R2D2-style PCM generator ---
import { randomInt, randomFloat } from './r2d2utils.mjs';

export function generateR2D2PCM({ sampleRate = 48000, durationSec = 0.2 } = {}) {
    // Generate a random sequence of 3-7 chirps
    const N_beeps = randomInt(3, 7);
    let bufferList = [];
    const volume = 0.02; // 1% volume (to avoid clipping)
    for (let i = 0; i < N_beeps; ++i) {
        const t = randomFloat(0.05, 0.25); // 50-250ms
        const N = Math.floor(t * sampleRate);
        const f1 = randomFloat(300, 2000);
        const f2 = Math.random() < 0.5 ? f1 : randomFloat(300, 2000);
        const waveTypes = ['sine', 'square', 'saw', 'triangle'];
        const wavetype = waveTypes[randomInt(0, waveTypes.length - 1)];
        const vib_depth = randomFloat(0, 0.5 * f1);
        const vib_rate = randomFloat(3, 12);
        const A = 0.001, D = randomFloat(0.005, 0.05), S = randomFloat(0.3, 0.8), R = randomFloat(0.005, 0.03);
        let phase = 0;
        let samples = new Float32Array(N);
        for (let n = 0; n < N; ++n) {
            const frac = n / (N - 1);
            let f = f1 + frac * (f2 - f1);
            f += vib_depth * Math.sin(2 * Math.PI * vib_rate * n / sampleRate);
            phase += 2 * Math.PI * f / sampleRate;
            let x;
            switch (wavetype) {
                case 'sine': x = Math.sin(phase); break;
                case 'square': x = Math.sign(Math.sin(phase)); break;
                case 'saw': x = 2 * (phase / (2 * Math.PI) - Math.floor(phase / (2 * Math.PI) + 0.5)); break;
                case 'triangle': x = 2 * Math.abs(2 * (phase / (2 * Math.PI) - Math.floor(phase / (2 * Math.PI) + 0.5))) - 1; break;
                default: x = Math.sin(phase);
            }
            // ADSR envelope
            let env = 1;
            const t_sec = n / sampleRate;
            if (t_sec < A) env = t_sec / A;
            else if (t_sec < A + D) env = 1 - (1 - S) * ((t_sec - A) / D);
            else if (t_sec < t - R) env = S;
            else if (t_sec < t) env = S * (1 - (t_sec - (t - R)) / R);
            else env = 0;
            samples[n] = x * env * volume;
        }
        // Convert to PCM16
        const buf = Buffer.alloc(N * 2);
        for (let n = 0; n < N; ++n) {
            buf.writeInt16LE(Math.max(-1, Math.min(1, samples[n])) * 32767, n * 2);
        }
        bufferList.push(buf);
        // Optional silence
        const silence_dur = randomFloat(0, 0.08);
        if (silence_dur > 0) bufferList.push(Buffer.alloc(Math.floor(silence_dur * sampleRate) * 2));
    }
    return Buffer.concat(bufferList);
}
// Utility to generate and play a 100ms, 432Hz, 50% volume beep (mono, 16-bit, 48kHz)
import { PassThrough } from 'stream';
import { createAudioResource, StreamType, AudioPlayer } from '@discordjs/voice';
import prism from 'prism-media';

export function generateBeepPCM({ sampleRate = 48000, durationSec = 0.1, freq = 432, volume = 0.5 } = {}) {
    const samples = Math.floor(durationSec * sampleRate);
    const buffer = Buffer.alloc(samples * 2); // 16-bit
    for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;
        const sample = Math.round(Math.sin(2 * Math.PI * freq * t) * 32767 * volume);
        buffer.writeInt16LE(sample, i * 2);
    }
    return buffer;
}

// Play beep to Discord using the audio player
export function playBeep(audioPlayer, log, opts = {}) {
    if (!audioPlayer) return;
    const { sampleRate = 48000, durationSec = 0.2 } = opts;
    const beepPCM = generateR2D2PCM({ sampleRate, durationSec });
    const stream = new PassThrough();
    stream.end(beepPCM);
    const opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
    stream.pipe(opusEncoder);
    const resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
    try {
        audioPlayer.play(resource);
    } catch (e) {
        log.error('Error playing R2D2 beep:', e);
    }
}

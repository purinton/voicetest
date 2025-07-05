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
    const { sampleRate = 48000, durationSec = 0.1, freq = 432, volume = 0.5 } = opts;
    const beepPCM = generateBeepPCM({ sampleRate, durationSec, freq, volume });
    const stream = new PassThrough();
    stream.end(beepPCM);
    const opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
    stream.pipe(opusEncoder);
    const resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
    try {
        audioPlayer.play(resource);
        //log.debug(`Played beep (${freq}Hz, ${durationSec * 1000}ms)`);
    } catch (e) {
        log.error('Error playing beep:', e);
    }
}

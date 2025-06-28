// Utility to generate and play a 100ms, 432Hz, 50% volume beep (mono, 16-bit, 48kHz)
import { PassThrough } from 'stream';
import { createAudioResource, StreamType, AudioPlayer } from '@discordjs/voice';
import prism from 'prism-media';

// Generate PCM buffer for 100ms, 432Hz, 50% volume, mono, 16-bit, 48kHz
export function generateBeepPCM() {
    const durationSec = 0.1;
    const sampleRate = 48000;
    const freq = 432;
    const volume = 0.5;
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
export function playBeep(audioPlayer, log) {
    if (!audioPlayer) return;
    const beepPCM = generateBeepPCM();
    const stream = new PassThrough();
    stream.end(beepPCM);
    // Encode to Opus for Discord
    const opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
    stream.pipe(opusEncoder);
    const resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
    try {
        audioPlayer.play(resource);
        log && log.debug && log.debug('Played beep (432Hz, 100ms)');
    } catch (e) {
        log && log.error && log.error('Error playing beep:', e);
    }
}

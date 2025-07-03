export function handleAudioDelta({ msg, playback, log }) {
    const audioBase64 = msg.delta;
    if (audioBase64) {
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        playback.handleAudio(audioBuffer);
    }
}
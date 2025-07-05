export function handleAudioDelta({ msg, playback, log }) {
    const audioBase64 = msg.delta;
    if (audioBase64) {
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        playback.handleAudio(audioBuffer);
    }
}

export function handleAudioDone({ playback, log }) {
    log.debug('OpenAI audio stream done, resetting playback');
    const silenceBuffer = Buffer.alloc(480 * 2 * 200 / 1000); // 200ms of silence at 48kHz, 16-bit stereo
    playback.handleAudio(silenceBuffer);
    setTimeout(() => { playback.reset() }, 200);
}

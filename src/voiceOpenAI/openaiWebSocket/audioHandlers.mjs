export function handleAudioDelta({ msg, playback, log }) {
    const audioBase64 = msg.delta;
    if (audioBase64) {
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        playback.handleAudio(audioBuffer);
    }
}

export function handleAudioDone({ playback, log }) {
    log.debug('OpenAI audio stream done, resetting playback');
    playback.reset();
}

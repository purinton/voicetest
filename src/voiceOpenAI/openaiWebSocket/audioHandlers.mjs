// Handles audio delta and done events for OpenAI WebSocket
export function handleAudioDelta({ msg, playback, log }) {
    const audioBase64 = msg.delta;
    if (audioBase64) {
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        log.debug(`[OpenAI audio delta] size: ${audioBuffer.length} bytes`);
        playback.handleAudio(audioBuffer);
    }
}

export function handleAudioDone({ playback, log }) {
    log.info('OpenAI audio stream done, resetting playback');
    playback.reset();
}

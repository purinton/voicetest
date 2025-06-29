// events/voiceStateUpdate.mjs
export default async function ({ log }, oldState, newState) {
    log.debug('voiceStateUpdate', { oldState, newState });
}

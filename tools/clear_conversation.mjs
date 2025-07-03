export default async function ({ log, restart, ws }) {
    log.debug('Received clear_conversation, requesting websocket restart');
    return { skipResponse: true, restart: true };
}

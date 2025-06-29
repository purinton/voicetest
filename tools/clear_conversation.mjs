export default async function ({ log, restart, ws }) {
    log.info('Received clear_conversation, requesting websocket restart');
    return { skipResponse: true, restart: true };
}

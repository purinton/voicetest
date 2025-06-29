export default async function ({ log, restart }) {
  log.info('Received clear_conversation, requesting websocket restart');
  if (typeof restart === 'function') restart();
}

export default async function ({ log, restart, ws }) {
  log.info('Received clear_conversation, requesting websocket restart');
  if (typeof restart === 'function') {
    // Close the websocket, which will trigger the restart logic in openaiWebSocket
    if (ws && ws.readyState === ws.OPEN) {
      log.info('Closing websocket for clear_conversation restart');
      ws.close();
    } else {
      restart();
    }
  }
}

// Wraps ws.send to intercept response.create for no_response
export function wrapWsSend(ws, skipResponseCreate, log) {
    const origSend = ws.send.bind(ws);
    ws.send = function (data, ...args) {
        try {
            const obj = typeof data === 'string' ? JSON.parse(data) : data;
            if (obj && obj.type === 'response.create' && obj.call_id && skipResponseCreate.has(obj.call_id)) {
                //log.debug(`[no_response] Skipping response.create for call_id=${obj.call_id}`);
                skipResponseCreate.delete(obj.call_id);
                return;
            }
        } catch (e) { /* ignore parse errors, send as normal */ }
        return origSend(data, ...args);
    };
}

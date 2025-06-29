// Handles all function/tool message types for OpenAI WebSocket
import path from 'path';
import fs from 'fs';


export async function handleFunctionCall({ msg, ws, log, client, channelId, playBeepFn, restart }) {
    if (msg.response && Array.isArray(msg.response.output)) {
        log.debug('[FunctionCall] msg.response.output:', JSON.stringify(msg.response.output));
        const hasFunctionCall = msg.response.output.some(item => item.type === 'function_call');
        const isNoResponse = msg.response.output.some(item => item.type === 'function_call' && item.name === 'no_response');
        if (hasFunctionCall && !isNoResponse && typeof playBeepFn === 'function') {
            await playBeepFn();
        }
        for (const fc of msg.response.output.filter(item => item.type === 'function_call')) {
            log.info(`AI invoked function '${fc.name}' with arguments:`, fc.arguments);
            if (client && channelId) {
                try {
                    const channel = await client.channels.fetch(channelId);
                    if (channel && channel.send) {
                        const formattedName = fc.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                        await channel.send(`✅ **${formattedName}**`);
                    }
                } catch (err) {
                    log.error('Failed to send function call message to Discord channel:', err);
                }
            }
            try {
                const toolPath = path.resolve(process.cwd(), 'tools', `${fc.name}.mjs`);
                if (fs.existsSync(toolPath)) {
                    const handler = (await import(`file://${toolPath}`)).default;
                    let args = {};
                    try { args = fc.arguments ? JSON.parse(fc.arguments) : {}; } catch { }
                    await handler({ call_id: fc.call_id, ws, log, args, client, channelId, restart });
                } else {
                    log.warn(`No handler found for tool: ${fc.name}`);
                }
            } catch (err) {
                log.error(`Error handling tool '${fc.name}':`, err);
            }
        }
        return { handled: true, skipResponse: false };
    }
    return { handled: false };
}

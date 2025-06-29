// Handles all function/tool message types for OpenAI WebSocket
import fetch from 'node-fetch';
import http from 'http';
import https from 'https';
import * as weather from '@purinton/openweathermap';
import path from 'path';
import fs from 'fs';

// Keep-alive agents for HTTP(S) requests
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

export async function handleFunctionCall({ msg, ws, log, sessionConfig, client, channelId, playBeepFn, restart }) {
    if (msg.response && Array.isArray(msg.response.output)) {
        const hasFunctionCall = msg.response.output.some(item => item.type === 'function_call');
        const isNoResponse = msg.response.output.some(item => item.type === 'function_call' && item.name === 'no_response');
        if (hasFunctionCall && !isNoResponse && typeof playBeepFn === 'function') {
            await playBeepFn();
        }
        // Dynamically handle each function_call using the corresponding tool handler
        for (const fc of msg.response.output.filter(item => item.type === 'function_call')) {
            log.info(`AI invoked function '${fc.name}' with arguments:`, fc.arguments);
            // Send Discord message with green check and formatted function name
            if (client && channelId) {
                try {
                    const channel = await client.channels.fetch(channelId);
                    if (channel && channel.send) {
                        // Convert function name to Title Case with spaces
                        const formattedName = fc.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                        await channel.send(`✅ **${formattedName}**`);
                    }
                } catch (err) {
                    log.error('Failed to send function call message to Discord channel:', err);
                }
            }
            // Dynamically import and invoke the tool handler
            try {
                const toolPath = path.resolve(process.cwd(), 'tools', `${fc.name}.mjs`);
                if (fs.existsSync(toolPath)) {
                    const handler = (await import(`file://${toolPath}`)).default;
                    let args = {};
                    try { args = fc.arguments ? JSON.parse(fc.arguments) : {}; } catch {}
                    await handler({ call_id: fc.call_id, ws, log, args, client, channelId, restart });
                } else {
                    log.warn(`No handler found for tool: ${fc.name}`);
                }
            } catch (err) {
                log.error(`Error handling tool '${fc.name}':`, err);
            }
        }
        // If any function_call was handled, skip the legacy logic
        return { handled: true, skipResponse: false };
    }
    return { handled: false };
}

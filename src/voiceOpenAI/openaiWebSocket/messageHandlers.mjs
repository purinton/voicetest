// Handles all function/tool message types for OpenAI WebSocket
import path from 'path';
import fs from 'fs';


export async function handleFunctionCall({ msg, ws, log, client, channelId, playBeepFn, restart, context }) {
    let output = msg.response && msg.response.output;
    if (typeof output === 'string') {
        try { output = JSON.parse(output); } catch (e) { log.error('Failed to parse msg.response.output as JSON:', output); return { handled: false, skipResponse: true, restart: false }; }
    }
    if (output && Array.isArray(output)) {
        log.debug('[FunctionCall] msg.response.output:', JSON.stringify(output));
        const functionCalls = output.filter(item => item.type === 'function_call');
        if (functionCalls.length === 0) {
            return { handled: false, skipResponse: true, restart: false };
        }
        const hasFunctionCall = functionCalls.length > 0;
        const isNoResponse = functionCalls.some(item => item.name === 'no_response');
        if (hasFunctionCall && !isNoResponse && typeof playBeepFn === 'function') {
            await playBeepFn();
        }
        for (const fc of functionCalls) {
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
            // Route MCP tool calls
            const mcpTool = context && context.allTools && context.allTools.find(t => t.name === fc.name && t.mcp_tool);
            if (mcpTool && context.mcpClients && context.mcpClients[mcpTool.mcp_label]) {
                try {
                    let args = {};
                    try { args = fc.arguments ? JSON.parse(fc.arguments) : {}; } catch {}
                    const mcpResult = await context.mcpClients[mcpTool.mcp_label].callTool({
                        tool: fc.name.replace(`${mcpTool.mcp_label}_`, ''),
                        args
                    });
                    log.info(`[MCP] Tool '${fc.name}' result:`, mcpResult);
                    // Optionally send result to ws or channel
                } catch (err) {
                    log.error(`[MCP] Error calling tool '${fc.name}':`, err);
                }
                continue;
            }
            // Local tool fallback
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
    return { handled: false, skipResponse: true, restart: false };
}

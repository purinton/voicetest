import path from 'path';
import fs from 'fs';


export async function handleFunctionCall({ msg, ws, log, client, channelId, playBeepFn, restart, mcpTools, mcpClients }) {
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

        let beepInterval = null;
        let stopped = false;
        if (hasFunctionCall && !isNoResponse && typeof playBeepFn === 'function') {
            playBeepFn({ freq: 432, durationSec: 0.1, volume: 0.25 });
            beepInterval = setInterval(() => {
                if (!stopped) playBeepFn({ freq: 864, durationSec: 0.05, volume: 0.25 });
            }, 500);
        }

        try {
            for (const fc of functionCalls) {
                log.debug(`AI invoked function '${fc.name}' with arguments:`, fc.arguments);
                if (client && channelId) {
                    try {
                        const channel = await client.channels.fetch(channelId);
                        if (channel && channel.send) {
                            const formattedName = fc.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                            channel.send(`✅ **${formattedName}**`);
                        }
                    } catch (err) {
                        log.error('Failed to send function call message to Discord channel:', err);
                    }
                }
                const mcpTool = mcpTools && mcpTools.find(t => t.name === fc.name && t.mcp_tool);
                if (mcpTool && mcpClients && mcpClients[mcpTool.mcp_label]) {
                    try {
                        let toolArgs = {};
                        try {
                            if (typeof fc.arguments === 'string') {
                                toolArgs = JSON.parse(fc.arguments);
                                if (toolArgs && typeof toolArgs.value === 'string') {
                                    toolArgs = JSON.parse(toolArgs.value);
                                }
                            } else if (typeof fc.arguments === 'object' && fc.arguments !== null) {
                                toolArgs = fc.arguments;
                                if (toolArgs.value && typeof toolArgs.value === 'string') {
                                    toolArgs = JSON.parse(toolArgs.value);
                                }
                            }
                        } catch { }
                        const mcpResult = await mcpClients[mcpTool.mcp_label].callTool({
                            name: fc.name.replace(`${mcpTool.mcp_label}_`, ''),
                            arguments: toolArgs
                        });
                        log.debug(`[MCP] Tool '${fc.name}' result:`, mcpResult);
                        let aiContent = '';
                        if (mcpResult && Array.isArray(mcpResult.content)) {
                            for (const part of mcpResult.content) {
                                if (part.type === 'text' && part.text) {
                                    let text = part.text;
                                    try {
                                        const parsed = JSON.parse(text);
                                        if (typeof parsed === 'object') {
                                            text = JSON.stringify(parsed);
                                        }
                                    } catch { }
                                    aiContent += text + '\n';
                                }
                            }
                        }
                        if (aiContent && ws && ws.readyState === ws.OPEN) {
                            const event = {
                                event_id: `event_${Date.now()}`,
                                type: 'conversation.item.create',
                                item: {
                                    id: `msg_${Date.now()}`,
                                    type: 'message',
                                    role: 'user',
                                    content: [
                                        {
                                            type: 'input_text',
                                            text: aiContent.trim()
                                        }
                                    ]
                                }
                            };
                            ws.send(JSON.stringify(event));
                            ws.send(JSON.stringify({ type: 'response.create' }));
                            log.debug('[OpenAI WS] Sent MCP result as user message');
                            stopped = true;
                            if (beepInterval) clearInterval(beepInterval);
                            return { handled: true, skipResponse: true, restart: false };
                        }
                    } catch (err) {
                        log.error(`[MCP] Error calling tool '${fc.name}':`, err);
                    }
                    continue;
                }
                try {
                    const toolPath = path.resolve(process.cwd(), 'tools', `${fc.name}.mjs`);
                    if (fs.existsSync(toolPath)) {
                        const handler = (await import(`file://${toolPath}`)).default;
                        let args = {};
                        try { args = fc.arguments ? JSON.parse(fc.arguments) : {}; } catch { }
                        const result = await handler({ call_id: fc.call_id, ws, log, args, client, channelId, restart });
                        if (result && result.restart) {
                            stopped = true;
                            if (beepInterval) clearInterval(beepInterval);
                            return { handled: true, skipResponse: false, restart: true };
                        }
                    } else {
                        log.warn(`No handler found for tool: ${fc.name}`);
                    }
                } catch (err) {
                    log.error(`Error handling tool '${fc.name}':`, err);
                }
            }
        } finally {
            stopped = true;
            if (beepInterval) clearInterval(beepInterval);
        }
        return { handled: true, skipResponse: false };
    }
    return { handled: false, skipResponse: true, restart: false };
}

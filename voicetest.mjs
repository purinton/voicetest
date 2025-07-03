#!/usr/bin/env node

import 'dotenv/config';
import mcpClient from '@purinton/mcp-client';
import { createDiscord } from '@purinton/discord';
import { log, fs, path, registerHandlers, registerSignals } from '@purinton/common';

async function main() {
    try {
        registerHandlers({ log });
        registerSignals({ log });

        const requiredEnv = ['DISCORD_TOKEN', 'GUILD_ID', 'VOICE_CHANNEL_ID', 'OPENAI_API_KEY'];
        const missingEnv = requiredEnv.filter((key) => !process.env[key]);
        if (missingEnv.length > 0) {
            log.error(`Missing required environment variables: ${missingEnv.join(', ')}`);
            process.exit(1);
        }

        const voice = 'ash';
        const packageJson = JSON.parse(fs.readFileSync(path(import.meta, 'package.json')), 'utf8');
        const version = packageJson.version;
        const presence = { activities: [{ name: `voicetest v${version}`, type: 4 }], status: 'online' };
        const mcpConfig = JSON.parse(fs.readFileSync(path(import.meta, 'mcp.json'), 'utf8'));
        const mcpServers = mcpConfig.servers || [];
        const mcpClients = {};
        let allMcpTools = [];
        for (const server of mcpServers) {
            const client = await mcpClient({ log, baseUrl: server.url, token: server.token });
            mcpClients[server.label] = client;
            registerSignals({ log, shutdownHook: () => client.close() });
            const { tools } = await client.listTools();
            for (const tool of tools) {
                allMcpTools.push({
                    type: 'function',
                    name: `${server.label}_${tool.name}`,
                    description: tool.description,
                    parameters: tool.inputSchema || {},
                    mcp_tool: true,
                    mcp_label: server.label
                });
            }
        }

        const toolsDir = path(import.meta, 'tools');
        let allLocalTools = [];
        try {
            allLocalTools = fs.readdirSync(toolsDir)
                .filter(f => f.endsWith('.json'))
                .map(f => {
                    const tool = JSON.parse(fs.readFileSync(path(toolsDir, f), 'utf8'));
                    return { ...tool, mcp_tool: false };
                });
        } catch (err) {
            log.warn('Failed to load local tools:', err);
            allLocalTools = [];
        }

        const allTools = [...allLocalTools, ...allMcpTools];
        await createDiscord({
            log,
            rootDir: path(import.meta),
            context: {
                presence,
                version,
                registerSignals,
                voice,
                mcpClients,
                mcpTools: allMcpTools,
                localTools: allLocalTools,
                allTools
            }
        });
    } catch (err) {
        log.error('Fatal error during startup:', err);
        process.exit(1);
    }
}

main();

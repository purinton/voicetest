#!/usr/bin/env node


import 'dotenv/config';
import mcpClient from '@purinton/mcp-client';
import { createDiscord } from '@purinton/discord';
import { log, fs, path, registerHandlers, registerSignals } from '@purinton/common';

const voice = 'sage';

function loadJsonFile(fileName) {
    try {
        const filePath = path(import.meta, fileName);
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        log.error(`Failed to read or parse ${fileName}:`, err);
        process.exit(1);
    }
}

async function main() {
    try {
        registerHandlers({ log });
        registerSignals({ log });

        const requiredEnv = ['DISCORD_TOKEN', 'GUILD_ID', 'VOICE_CHANNEL_ID', 'OPENAI_API_KEY'];
        const missingEnv = requiredEnv.filter((key) => !process.env[key]);
        if (missingEnv.length > 0) {
            log.error(`Missing required environment variables: ${missingEnv.join(', ')}`);
            log.error('Please set these variables in your environment or in a .env file.');
            log.error('Example:');
            log.error('  DISCORD_TOKEN=your_discord_token_here');
            log.error('  GUILD_ID=your_guild_id_here');
            log.error('  VOICE_CHANNEL_ID=your_voice_channel_id_here');
            log.error('  OPENAI_API_KEY=your_openai_api_key_here');
            log.error('See instructions.txt for more details.');
            process.exit(1);
        }

        const packageJson = loadJsonFile('package.json');
        const version = packageJson.version;
        const presence = { activities: [{ name: `voicetest v${version}`, type: 4 }], status: 'online' };
        const mcpConfig = loadJsonFile('mcp.json');
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
            },
            intents: { GuildMembers: true }
        });
    } catch (err) {
        log.error('Fatal error during startup:', err);
        process.exit(1);
    }
}

main();

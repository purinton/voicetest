#!/usr/bin/env node
import 'dotenv/config';
import mcpClient from '@purinton/mcp-client';
import { createDiscord } from '@purinton/discord';
import { log, fs, path, registerHandlers, registerSignals } from '@purinton/common';

registerHandlers({ log });
registerSignals({ log });

const packageJson = JSON.parse(fs.readFileSync(path(import.meta, 'package.json')), 'utf8');
const version = packageJson.version;

const presence = { activities: [{ name: `voicetest v${version}`, type: 4 }], status: 'online' };

const voice = 'ash';
const filter = 'rubberband=pitch=0.95:tempo=1.05';

// Load MCP servers from mcp.json
const mcpConfig = JSON.parse(fs.readFileSync(path(import.meta, 'mcp.json'), 'utf8'));
const mcpServers = mcpConfig.servers || [];

// Create MCP clients and fetch tools
const mcpClients = {};
let allMcpTools = [];
for (const server of mcpServers) {
    const client = await mcpClient({ log, baseUrl: server.url, token: server.token });
    mcpClients[server.label] = client;
    registerSignals({ log, shutdownHook: () => client.close() });
    const { tools } = await client.listTools();
    // Marshal tools: inject label in name and add mcp_tool marker
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

// Load local tools from tools/*.json
const toolsDir = path(process.cwd(), 'tools');
let allLocalTools = [];
try {
    allLocalTools = fs.readdirSync(toolsDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            const tool = JSON.parse(fs.readFileSync(path.join(toolsDir, f), 'utf8'));
            // Mark as local tool for clarity
            return { ...tool, mcp_tool: false };
        });
} catch (err) {
    log.warn('Failed to load local tools:', err);
    allLocalTools = [];
}

// Merge all tools for OpenAI and context
const allTools = [...allLocalTools, ...allMcpTools];

await createDiscord({
    log,
    rootDir: path(import.meta),
    context: {
        presence,
        version,
        registerSignals,
        voice,
        filter,
        mcpClients,
        mcpTools: allMcpTools,
        localTools: allLocalTools,
        allTools // for downstream sessionConfig
    }
});

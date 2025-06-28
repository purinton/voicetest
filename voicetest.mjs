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

const mcp = mcpClient({ log });
registerSignals({ log, shutdownHook: () => mcp.close() });
const tools = await mcp.listTools();
log.debug('list-tools', { tools });

await createDiscord({
    log,
    rootDir: path(import.meta),
    context: {
        presence,
        version,
        registerSignals,
        voice,
        filter,
        mcp
    }
});

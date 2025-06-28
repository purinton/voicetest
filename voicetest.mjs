#!/usr/bin/env node
import 'dotenv/config';
import { createDiscord } from '@purinton/discord';
import { log, fs, path, registerHandlers, registerSignals } from '@purinton/common';

registerHandlers({ log });
registerSignals({ log });

const packageJson = JSON.parse(fs.readFileSync(path(import.meta, 'package.json')), 'utf8');
const version = packageJson.version;

const presence = { activities: [{ name: `voicetest v${version}`, type: 4 }], status: 'online' };

const voice = 'ballad';
const filter = 'rubberband=pitch=0.95:tempo=1.05';

await createDiscord({
    log,
    rootDir: path(import.meta),
    context: {
        presence,
        version,
        registerSignals,
        voice,
        filter
    }
});

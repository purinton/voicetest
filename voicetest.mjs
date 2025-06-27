#!/usr/bin/env node
import 'dotenv/config';
import { createDiscord } from '@purinton/discord';
import { log, fs, path, registerHandlers, registerSignals } from '@purinton/common';

registerHandlers({ log });
registerSignals({ log });

const packageJson = JSON.parse(fs.readFileSync(path(import.meta, 'package.json')), 'utf8');
const version = packageJson.version;

const presence = { activities: [{ name: `voicetest v${version}`, type: 4 }], status: 'online' };

const voice = 'sage';
// Sox-compatible filter: pitch shift up by 7 semitones (~150%) and tempo 110%
// Sox pitch effect: 100 cents = 1 semitone, so 7 semitones = 700 cents
const filter = '';
//const filter = 'pitch 700 tempo 1.1';

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

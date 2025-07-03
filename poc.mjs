import 'dotenv/config';
import fs from 'fs';
import WebSocket from 'ws';
import prism from 'prism-media';
import { PassThrough } from 'stream';
import { Resampler } from '@purinton/resampler';
import { Client, GatewayIntentBits } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType, } from '@discordjs/voice';

const PCM_FRAME_SIZE_BYTES = 960 * 2;
const PCM_FRAME_SIZE_BYTES_24 = 480 * 2;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GUILD_ID = process.env.GUILD_ID;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const instructions = fs.readFileSync('instructions.txt', 'utf-8');
const userConverters = new Map();

let voiceConnection;
let audioPlayer;
let openAIWS;
let openaiPcmCache = Buffer.alloc(0);

if (!DISCORD_TOKEN || !OPENAI_API_KEY || !GUILD_ID || !VOICE_CHANNEL_ID) {
    console.error('Missing DISCORD_TOKEN, OPENAI_API_KEY, GUILD_ID, or VOICE_CHANNEL_ID in .env');
    process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

function handleOpenAIAudio(audioBuffer) {
    if (!audioPlayer || !voiceConnection) return;
    openaiPcmCache = Buffer.concat([openaiPcmCache, audioBuffer]);
    if (!handleOpenAIAudio.playbackStream) {
        handleOpenAIAudio.playbackStream = new PassThrough();
        // Resample from 24kHz to 48kHz using Resampler
        const resampler = new Resampler({
            inRate: 24000,
            outRate: 48000,
            inChannels: 1,
            outChannels: 1,
            filterWindow: 8,
        });
        const opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
        handleOpenAIAudio.playbackStream.pipe(resampler).pipe(opusEncoder);
        const resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
        audioPlayer.play(resource);
    }
    while (openaiPcmCache.length >= PCM_FRAME_SIZE_BYTES) {
        const frame = openaiPcmCache.slice(0, PCM_FRAME_SIZE_BYTES);
        openaiPcmCache = openaiPcmCache.slice(PCM_FRAME_SIZE_BYTES);
        handleOpenAIAudio.playbackStream.write(frame);
    }
}

client.once('ready', async () => {
    try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) {
            throw new Error('Guild not found');
        }

        const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);
        if (!channel || channel.type !== 2) {
            throw new Error('Voice channel not found');
        }

        voiceConnection = joinVoiceChannel({
            channelId: VOICE_CHANNEL_ID,
            guildId: GUILD_ID,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false,
        });

        audioPlayer = createAudioPlayer();
        voiceConnection.subscribe(audioPlayer);
        console.log('Joined voice channel');
        openAIWS = createOpenAIWebSocket();
        voiceConnection.receiver.speaking.on('start', (userId) => {
            console.log(`User ${userId} started speaking`);

            const opusStream = voiceConnection.receiver.subscribe(userId, {
                end: { behavior: 'silence', duration: 100 },
            });

            if (!userConverters.has(userId)) {
                const opusDecoder = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
                opusStream.pipe(opusDecoder);
                // Resample from 48kHz to 24kHz using Resampler
                const resampler = new Resampler({
                    inRate: 48000,
                    outRate: 24000,
                    inChannels: 1,
                    outChannels: 1,
                    filterWindow: 8,
                });
                opusDecoder.pipe(resampler);
                let cache = Buffer.alloc(0);
                resampler.on('data', chunk => {
                    cache = Buffer.concat([cache, chunk]);
                    while (cache.length >= PCM_FRAME_SIZE_BYTES_24) {
                        const frame = cache.slice(0, PCM_FRAME_SIZE_BYTES_24);
                        cache = cache.slice(PCM_FRAME_SIZE_BYTES_24);
                        if (!openAIWS || openAIWS.readyState !== WebSocket.OPEN) return;
                        openAIWS.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: frame.toString('base64') }));
                    }
                });
                userConverters.set(userId, { opusDecoder, resampler });
            }

            opusStream.on('end', () => {
                console.log(`User ${userId} stopped speaking`);
                const entry = userConverters.get(userId);
                if (entry) {
                    try { entry.opusDecoder.destroy(); } catch { }
                    try { entry.resampler.destroy(); } catch { }
                    userConverters.delete(userId);
                }
            });
        });
    } catch (err) {
        console.error(err);
    }
});

function createOpenAIWebSocket() {
    const url =
        'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview';

    const ws = new WebSocket(url, {
        headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            'OpenAI-Beta': 'realtime=v1',
        },
    });

    ws.on('open', () => {
        console.log('Connected to OpenAI Realtime WebSocket');
        ws.send(
            JSON.stringify({
                type: 'session.update',
                session: {
                    instructions,
                    modalities: ['text', 'audio'],
                    input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
                    input_audio_format: 'pcm16',
                    output_audio_format: 'pcm16',
                    turn_detection: { type: 'server_vad' },
                    voice: 'ash',
                },
            }),
        );
    });

    ws.on('message', (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
            console.log('[OpenAI WS message parsed]', msg.type);
        } catch {
            msg = null;
        }
        if (msg && msg.type === 'response.audio.delta') {
            const audioBase64 = msg.delta;
            if (audioBase64) {
                const audioBuffer = Buffer.from(audioBase64, 'base64');
                console.log(`[OpenAI audio delta] size: ${audioBuffer.length} bytes`);
                handleOpenAIAudio(audioBuffer);
            }
        } else if (msg && msg.type === 'response.audio.done') {
            console.log('OpenAI audio stream done, resetting playback stream');
            if (handleOpenAIAudio.playbackStream) {
                handleOpenAIAudio.playbackStream.end();
                handleOpenAIAudio.playbackStream = undefined;
            }
            openaiPcmCache = Buffer.alloc(0);
        }
    });

    ws.on('error', (err) => {
        console.error('OpenAI WebSocket error:', err);
    });

    ws.on('close', () => {
        console.log('OpenAI WebSocket closed');
    });

    return ws;
}

client.login(DISCORD_TOKEN);

async function shutdown() {
    console.log('Shutting down gracefully...');
    if (openAIWS && openAIWS.readyState === WebSocket.OPEN) {
        openAIWS.close();
    }
    if (voiceConnection) {
        try {
            voiceConnection.destroy();
        } catch (e) {
            console.error('Error destroying voice connection:', e);
        }
    }
    if (audioPlayer) {
        try {
            audioPlayer.stop();
        } catch (e) {
            console.error('Error stopping audio player:', e);
        }
    }
    await client.destroy();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', async (err) => {
    console.error('Uncaught Exception:', err);
    await shutdown();
});
process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    await shutdown();
});
process.on('exit', async (code) => {
    console.log(`Process exiting with code: ${code}`);
    await shutdown();
});

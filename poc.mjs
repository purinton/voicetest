import fs from 'fs';
import { config } from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    StreamType,
} from '@discordjs/voice';
import WebSocket from 'ws';
import prism from 'prism-media';
import ffmpegStatic from 'ffmpeg-static';
import { PassThrough } from 'stream';
import { spawn } from 'child_process';

config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GUILD_ID = process.env.GUILD_ID;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;

if (!DISCORD_TOKEN || !OPENAI_API_KEY || !GUILD_ID || !VOICE_CHANNEL_ID) {
    console.error('Missing DISCORD_TOKEN, OPENAI_API_KEY, GUILD_ID, or VOICE_CHANNEL_ID in .env');
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

let voiceConnection;
let audioPlayer;
let openAIWS;
let session = {
    lastAssistantItem: undefined,
    responseStartTimestamp: undefined,
    latestMediaTimestamp: undefined,
};

// Buffer size for 20 ms frames at 48kHz 16-bit mono PCM
const PCM_FRAME_SIZE_BYTES = 960 * 2;
// Buffer size for 20 ms frames at 24kHz 16-bit mono PCM
const PCM_FRAME_SIZE_BYTES_24 = 480 * 2;

function pcmToOpusStream() {
    return new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
}

let openaiPcmCache = Buffer.alloc(0);

function handleOpenAIAudio(audioBuffer) {
    if (!audioPlayer || !voiceConnection) return;

    const pcmBuffer = audioBuffer;

    // Buffer and frame into 20ms chunks
    openaiPcmCache = Buffer.concat([openaiPcmCache, pcmBuffer]);

    if (!handleOpenAIAudio.playbackStream) {
        handleOpenAIAudio.playbackStream = new PassThrough();

        // Transcode from 16bit PCM mono at 24kHz to 48kHz mono signed 16-bit via direct ffmpeg spawn
        const ffmpegArgs = [
            '-f', 's16le',
            '-ar', '24000', // input sample rate
            '-ac', '1',
            '-i', '-',
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '1',
            'pipe:1',
        ];
        const ffmpegProcess = spawn(ffmpegStatic, ffmpegArgs);
        ffmpegProcess.on('error', console.error);
        ffmpegProcess.stderr.on('data', data => console.error('ffmpeg stderr:', data.toString()));
        const opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
        // Pipe openAI PCM -> ffmpeg stdin -> ffmpeg stdout -> opus encoder -> play
        handleOpenAIAudio.playbackStream.pipe(ffmpegProcess.stdin);
        ffmpegProcess.stdout.pipe(opusEncoder);
        const resource = createAudioResource(opusEncoder, { inputType: StreamType.Opus });
        audioPlayer.play(resource);
    }

    while (openaiPcmCache.length >= PCM_FRAME_SIZE_BYTES) {
        const frame = openaiPcmCache.slice(0, PCM_FRAME_SIZE_BYTES);
        openaiPcmCache = openaiPcmCache.slice(PCM_FRAME_SIZE_BYTES);
        handleOpenAIAudio.playbackStream.write(frame);
    }
}

let discordPcmCache = Buffer.alloc(0);
// Track active converters per user
const userConverters = new Map();

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

            // If first time this user speaks, set up a converter
            if (!userConverters.has(userId)) {
                const opusDecoder = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
                opusStream.pipe(opusDecoder);
                const converter = spawn(ffmpegStatic, [
                    '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', '-',
                    '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1',
                ]);
                converter.on('error', console.error);
                converter.stderr.on('data', data => console.error('discord ffmpeg stderr:', data.toString()));
                opusDecoder.pipe(converter.stdin);
                let cache = Buffer.alloc(0);
                converter.stdout.on('data', chunk => {
                    cache = Buffer.concat([cache, chunk]);
                    while (cache.length >= PCM_FRAME_SIZE_BYTES_24) {
                        const frame = cache.slice(0, PCM_FRAME_SIZE_BYTES_24);
                        cache = cache.slice(PCM_FRAME_SIZE_BYTES_24);
                        if (!openAIWS || openAIWS.readyState !== WebSocket.OPEN) return;
                        openAIWS.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: frame.toString('base64') }));
                    }
                });
                userConverters.set(userId, { opusDecoder, converter });
            }

            opusStream.on('end', () => {
                console.log(`User ${userId} stopped speaking`);
                // Clean up the converter for this user
                const entry = userConverters.get(userId);
                if (entry) {
                    entry.converter.stdin.end();
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



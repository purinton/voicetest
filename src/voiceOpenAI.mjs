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
import fs from 'fs';
import path from 'path';

const PCM_FRAME_SIZE_BYTES = 960 * 2;
const PCM_FRAME_SIZE_BYTES_24 = 480 * 2;

export async function setupVoiceOpenAI({ client, guildId, voiceChannelId, openAIApiKey, log }) {
    let voiceConnection;
    let audioPlayer;
    let openAIWS;
    let openaiPcmCache = Buffer.alloc(0);
    const userConverters = new Map();

    // Load instructions.txt for OpenAI system prompt
    let instructions = '';
    try {
        const instructionsPath = path.resolve(process.cwd(), 'instructions.txt');
        instructions = fs.readFileSync(instructionsPath, 'utf8');
        log.info('Loaded instructions.txt for OpenAI system prompt');
    } catch (err) {
        log.warn('Could not load instructions.txt:', err);
    }

    function handleOpenAIAudio(audioBuffer) {
        if (!audioPlayer || !voiceConnection) return;
        openaiPcmCache = Buffer.concat([openaiPcmCache, audioBuffer]);
        if (!handleOpenAIAudio.playbackStream) {
            handleOpenAIAudio.playbackStream = new PassThrough();
            const ffmpegArgs = [
                '-f', 's16le',
                '-ar', '24000',
                '-ac', '1',
                '-i', '-',
                '-filter:a', 'rubberband=pitch=0.92:tempo=1.05',
                '-f', 's16le',
                '-ar', '48000',
                '-ac', '1',
                'pipe:1',
            ];
            const ffmpegProcess = spawn(ffmpegStatic, ffmpegArgs);
            ffmpegProcess.on('error', log.error);
            ffmpegProcess.stderr.on('data', data => log.debug('ffmpeg stderr:', data.toString()));
            const opusEncoder = new prism.opus.Encoder({ frameSize: 960, channels: 1, rate: 48000 });
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

    function createOpenAIWebSocket() {
        const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview';
        const ws = new WebSocket(url, {
            headers: {
                Authorization: `Bearer ${openAIApiKey}`,
                'OpenAI-Beta': 'realtime=v1',
            },
        });
        ws.on('open', () => {
            log.info('Connected to OpenAI Realtime WebSocket');
            ws.send(JSON.stringify({
                type: 'session.update',
                session: {
                    modalities: ['text', 'audio'],
                    instructions,
                    input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
                    input_audio_format: 'pcm16',
                    output_audio_format: 'pcm16',
                    turn_detection: { type: 'server_vad' },
                    voice: 'ballad',
                },
            }));
        });
        ws.on('message', (data) => {
            let msg;
            try {
                msg = JSON.parse(data.toString());
                log.debug('[OpenAI WS message parsed]', msg.type);
            } catch {
                msg = null;
            }
            if (msg && msg.type === 'response.audio.delta') {
                const audioBase64 = msg.delta;
                if (audioBase64) {
                    const audioBuffer = Buffer.from(audioBase64, 'base64');
                    log.debug(`[OpenAI audio delta] size: ${audioBuffer.length} bytes`);
                    handleOpenAIAudio(audioBuffer);
                }
            } else if (msg && msg.type === 'response.audio.done') {
                log.info('OpenAI audio stream done, resetting playback stream');
                if (handleOpenAIAudio.playbackStream) {
                    handleOpenAIAudio.playbackStream.end();
                    handleOpenAIAudio.playbackStream = undefined;
                }
                openaiPcmCache = Buffer.alloc(0);
            }
        });
        ws.on('error', (err) => {
            log.error('OpenAI WebSocket error:', err);
        });
        ws.on('close', () => {
            log.info('OpenAI WebSocket closed');
        });
        return ws;
    }

    // Main setup logic
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Guild not found');
    const channel = guild.channels.cache.get(voiceChannelId);
    if (!channel || channel.type !== 2) throw new Error('Voice channel not found');
    voiceConnection = joinVoiceChannel({
        channelId: voiceChannelId,
        guildId: guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
    });
    audioPlayer = createAudioPlayer();
    voiceConnection.subscribe(audioPlayer);
    log.info('Joined voice channel');
    openAIWS = createOpenAIWebSocket();
    voiceConnection.receiver.speaking.on('start', (userId) => {
        log.info(`User ${userId} started speaking`);
        const opusStream = voiceConnection.receiver.subscribe(userId, {
            end: { behavior: 'silence', duration: 100 },
        });
        if (!userConverters.has(userId)) {
            const opusDecoder = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
            opusStream.pipe(opusDecoder);
            const converter = spawn(ffmpegStatic, [
                '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', '-',
                '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1',
            ]);
            converter.on('error', log.error);
            converter.stderr.on('data', data => log.debug('discord ffmpeg stderr:', data.toString()));
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
            // Attach end listener only once when converter is created
            opusStream.once('end', () => {
                log.info(`User ${userId} stopped speaking`);
                const entry = userConverters.get(userId);
                // Co-pilot Glitch?
                if (entry) {
                    entry.converter.stdin.end();
                    userConverters.delete(userId);
                }
            });
        }
    });

    // Return cleanup function for shutdown
    return async () => {
        log.debug('Cleaning up Voice/OpenAI resources');
        if (openAIWS && openAIWS.readyState === WebSocket.OPEN) openAIWS.close();
        if (voiceConnection) {
            try { voiceConnection.destroy(); } catch (e) { log.error('Error destroying voice connection:', e); }
        }
        if (audioPlayer) {
            try { audioPlayer.stop(); } catch (e) { log.error('Error stopping audio player:', e); }
        }
    };
}

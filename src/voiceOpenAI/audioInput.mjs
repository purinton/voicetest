import WebSocket from 'ws';
import prism from 'prism-media';
import { Resampler } from '@purinton/resampler';

const MAX_WS_BUFFERED_AMOUNT = 5 * 1024 * 1024; // 5MB
const PCM_FRAME_SIZE_BYTES_24 = 480 * 2;
const FRAME_BATCH_COUNT = 5; // batch 5 frames (~100ms) per send

export function setupAudioInput({ client, voiceConnection, openAIWS, log }) {
    const userConverters = new Map();

    let currentSpeakerId = null;
    openAIWS.lastSpeakerId = null;
    const waitingQueue = [];
    const userBuffers = new Map(); // userId -> Buffer[]
    let pendingFrames = [];
    let backpressurePaused = false;
    let resumeInterval = null;

    async function sendSpeakerLabel(userId) {
        if (userId === openAIWS.lastSpeakerId) return;
        openAIWS.lastSpeakerId = userId;
        let speakerName = 'Unknown User';
        try {
            if (voiceConnection && voiceConnection.joinConfig && voiceConnection.joinConfig.guildId && client) {
                const guild = await client.guilds.fetch(voiceConnection.joinConfig.guildId);
                if (guild) {
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (member) {
                        speakerName = member.nickname || member.displayName || member.user?.username || 'Unknown User';
                    } else if (client.users) {
                        const user = await client.users.fetch(userId).catch(() => null);
                        if (user) {
                            speakerName = user.displayName || user.username || 'Unknown User';
                        }
                    }
                }
            }
        } catch (err) {
            log.warn('Could not resolve Discord speaker name:', err);
        }
        if (openAIWS && openAIWS.readyState === WebSocket.OPEN) {
            openAIWS.sendOpenAIMessage(`Participant '${speakerName}' started speaking: My name is '${speakerName}'...`, false);
            log.debug(`Sent speaker label for user ${userId} as ${speakerName}`);
        } else {
            openAIWS.lastSpeakerId = null;
            log.warn('OpenAI WS not open, cannot send speaker label');
        }
    }

    function sendAudioFrame(frame) {
        if (openAIWS && openAIWS.readyState === WebSocket.OPEN) {
            if (openAIWS.bufferedAmount > MAX_WS_BUFFERED_AMOUNT && !backpressurePaused) {
                log.warn('WebSocket backpressure detected, pausing audio input');
                resampler.pause(); backpressurePaused = true;
                resumeInterval = setInterval(() => {
                    if (openAIWS.bufferedAmount < MAX_WS_BUFFERED_AMOUNT / 2) {
                        log.debug('WebSocket buffer drained, resuming audio input');
                        resampler.resume(); backpressurePaused = false;
                        clearInterval(resumeInterval);
                    }
                }, 100);
            }
            const payload = JSON.stringify({ type: 'input_audio_buffer.append', audio: frame.toString('base64') });
            openAIWS.send(payload, err => {
                if (err) log.error('Error sending audio to OpenAI WS:', err);
            });
        } else {
            log.warn('OpenAI WS not open, skipping audio frame');
        }
    }

    function processBufferedAudio(userId) {
        const buffers = userBuffers.get(userId) || [];
        for (const frame of buffers) {
            sendAudioFrame(frame);
        }
        userBuffers.set(userId, []);
    }

    const onSpeechStart = (userId) => {
        log.debug(`User ${userId} started speaking`);
        const opusStream = voiceConnection.receiver.subscribe(userId, {
            end: { behavior: 'silence', duration: 500 },
        });
        if (!userConverters.has(userId)) {
            if (currentSpeakerId === null) {
                sendSpeakerLabel(userId); // now async, but fire and forget
            }
            const opusDecoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
            opusStream.pipe(opusDecoder);
            const resampler = new Resampler({ inRate: 48000, outRate: 24000, inChannels: 2, outChannels: 1 });
            opusDecoder.pipe(resampler);
            let cache = Buffer.alloc(0);
            resampler.on('data', chunk => {
                cache = Buffer.concat([cache, chunk]);
                while (cache.length >= PCM_FRAME_SIZE_BYTES_24) {
                    const frame = cache.subarray(0, PCM_FRAME_SIZE_BYTES_24);
                    cache = cache.subarray(PCM_FRAME_SIZE_BYTES_24);
                    if (currentSpeakerId === null) {
                        currentSpeakerId = userId;
                        sendSpeakerLabel(userId);
                        openAIWS.currentSpeakerId = userId;
                        pendingFrames.push(frame);
                        if (pendingFrames.length >= FRAME_BATCH_COUNT) {
                            sendAudioFrame(Buffer.concat(pendingFrames));
                            pendingFrames = [];
                        }
                    } else if (currentSpeakerId === userId) {
                        pendingFrames.push(frame);
                        if (pendingFrames.length >= FRAME_BATCH_COUNT) {
                            sendAudioFrame(Buffer.concat(pendingFrames));
                            pendingFrames = [];
                        }
                    } else {
                        if (!userBuffers.has(userId)) userBuffers.set(userId, []);
                        userBuffers.get(userId).push(frame);
                        if (!waitingQueue.includes(userId)) waitingQueue.push(userId);
                    }
                }
            });
            userConverters.set(userId, { opusDecoder, resampler });
        }
    };
    voiceConnection.receiver.speaking.on('start', onSpeechStart);

    const onSpeechEnd = (userId) => {
        log.debug(`User ${userId} stopped speaking`);
        if (pendingFrames.length > 0) {
            sendAudioFrame(Buffer.concat(pendingFrames));
            pendingFrames = [];
        }
        if (currentSpeakerId === userId) {
            currentSpeakerId = null;
            if (waitingQueue.length > 0) {
                const nextUserId = waitingQueue.shift();
                currentSpeakerId = nextUserId;
                processBufferedAudio(nextUserId);
            }
        }
    };
    voiceConnection.receiver.speaking.on('end', onSpeechEnd);

    return () => {
        voiceConnection.receiver.speaking.off('start', onSpeechStart);
        voiceConnection.receiver.speaking.off('end', onSpeechEnd);
        for (const { resampler, opusDecoder } of userConverters.values()) {
            try { resampler?.unpipe?.(); } catch { };
            try { resampler?.destroy?.(); } catch { };
            try { opusDecoder?.unpipe?.(); } catch { };
            try { opusDecoder.destroy(); } catch { };
        }
        userConverters.clear();
        currentSpeakerId = null;
        waitingQueue.length = 0;
        userBuffers.clear();
        log.debug('Cleaned up audio input handlers and converters');
    };
}

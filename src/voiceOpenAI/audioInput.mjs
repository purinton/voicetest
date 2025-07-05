import WebSocket from 'ws';
import prism from 'prism-media';
import { Resampler } from '@purinton/resampler';


export function setupAudioInput({ client, voiceConnection, openAIWS, log }) {
    const userConverters = new Map(); // converters are pooled per user and not destroyed on silence
    const PCM_FRAME_SIZE_BYTES_24 = 480 * 2;

    let currentSpeakerId = null;
    let lastSpeakerId = null;
    const waitingQueue = [];
    const userBuffers = new Map(); // userId -> Buffer[]

    async function sendSpeakerLabel(userId) {
        if (userId === lastSpeakerId) return;
        lastSpeakerId = userId;
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
            openAIWS.sendOpenAIMessage(`My name is ${speakerName}.`, false);
            openAIWS._lastSpeakerId = userId;
            log.debug(`Sent speaker label for user ${userId} as ${speakerName}`);
        } else {
            log.warn('OpenAI WS not open, cannot send speaker label');
        }
    }

    function sendAudioFrame(frame) {
        if (openAIWS && openAIWS.readyState === WebSocket.OPEN) {
            const payload = JSON.stringify({ type: 'input_audio_buffer.append', audio: frame.toString('base64') });
            try {
                openAIWS.send(payload);
            } catch (err) {
                log.error('Error sending audio to OpenAI WS:', err);
            }
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
            // when acquiring lock, signal speaker label
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
                        // No one is speaking: this user gets the lock
                        currentSpeakerId = userId;
                        // Notify OpenAI of speaker and track current speaker
                        sendSpeakerLabel(userId); // now async, but fire and forget
                        openAIWS.currentSpeakerId = userId;
                        sendAudioFrame(frame);
                    } else if (currentSpeakerId === userId) {
                        // This user holds the lock, send audio
                        sendAudioFrame(frame);
                    } else {
                        // Another user is speaking, buffer this user's audio
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
        if (currentSpeakerId === userId) {
            // Release the lock from the current speaker
            currentSpeakerId = null;
            // Process the next user in the waiting queue, if any
            if (waitingQueue.length > 0) {
                const nextUserId = waitingQueue.shift();
                currentSpeakerId = nextUserId;
                processBufferedAudio(nextUserId);
            }
        }
    };
    voiceConnection.receiver.speaking.on('end', onSpeechEnd);

    // Return a cleanup function to remove listeners and destroy converters
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

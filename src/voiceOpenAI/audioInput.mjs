import WebSocket from 'ws';
import prism from 'prism-media';
import { Resampler } from '@purinton/resampler';


export function setupAudioInput({ voiceConnection, openAIWS, log }) {
    const userConverters = new Map(); // converters are pooled per user and not destroyed on silence
    const PCM_FRAME_SIZE_BYTES_24 = 480 * 2;

    // New: Speaker lock and queue
    let currentSpeakerId = null;
    const waitingQueue = [];
    const userBuffers = new Map(); // userId -> Buffer[]

    // Send a speaker label as text to OpenAI
    function sendSpeakerLabel(userId) {
        if (openAIWS && openAIWS.readyState === WebSocket.OPEN) {
            const event = {
                event_id: `event_${Date.now()}`,
                type: 'conversation.item.create',
                item: {
                    id: `msg_${Date.now()}`,
                    type: 'message',
                    role: 'user',
                    content: [{ type: 'input_text', text: `<@${userId}>` }]
                }
            };
            openAIWS.send(JSON.stringify(event));
            openAIWS._lastSpeakerId = userId;
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
        // Always use the top-level sendSpeakerLabel, which sets _lastSpeakerId
        const opusStream = voiceConnection.receiver.subscribe(userId, {
            end: { behavior: 'silence', duration: 100 },
        });
        if (!userConverters.has(userId)) {
            // when acquiring lock, signal speaker label
            if (currentSpeakerId === null) {
                sendSpeakerLabel(userId);
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
                        sendSpeakerLabel(userId);
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
            opusStream.once('end', () => {
                log.debug(`User ${userId} stopped speaking`);
                if (currentSpeakerId === userId) {
                    // Speaker finished, check for next in queue
                    if (waitingQueue.length > 0) {
                        const nextUserId = waitingQueue.shift();
                        currentSpeakerId = nextUserId;
                        processBufferedAudio(nextUserId);
                    } else {
                        currentSpeakerId = null;
                    }
                }
                // Clean up buffer for this user
                userBuffers.set(userId, []);
            });
        }
    };
    voiceConnection.receiver.speaking.on('start', onSpeechStart);

    // Return a cleanup function to remove listeners and destroy converters
    return () => {
        voiceConnection.receiver.speaking.off('start', onSpeechStart);
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

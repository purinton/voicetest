import WebSocket from 'ws';
import fetch from 'node-fetch';
import * as weather from '@purinton/openweathermap';

/**
 * Creates a WebSocket connection to the OpenAI realtime API.
 */
export function createOpenAIWebSocket({ openAIApiKey, instructions, voice, log, playback }) {
    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview';
    // Define session config once for reuse (including clear_conversation)
    const sessionConfig = {
        modalities: ['text', 'audio'],
        instructions,
        input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: { type: 'server_vad' },
        voice,
        tools: [
            {
                type: 'function', name: 'get_chuck_norris_joke', description: 'Fetch a random joke from the Chuck Norris joke API.', parameters: { type: 'object', properties: {}, required: [] }
            },
            {
                type: 'function', name: 'clear_conversation', description: 'Clears and restarts the conversation', parameters: { type: 'object', properties: {}, required: [] }
            },
            {
                type: 'function', name: 'no_response', description: 'Call this if no response is required.', parameters: { type: 'object', properties: {}, required: [] }
            },
            {
                type: 'function', name: 'get_weather', description: 'Get current weather for a location. Parameters: lat (number), lon (number)', parameters: { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' } }, required: ['lat', 'lon'] }
            },
            {
                type: 'function', name: 'get_sun_times', description: 'Get sunrise and sunset times for a location. Parameters: lat (number), lon (number)', parameters: { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' } }, required: ['lat', 'lon'] }
            },
            {
                type: 'function', name: 'get_24h_forecast', description: 'Get 24-hour weather forecast for a location. Parameters: lat (number), lon (number)', parameters: { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' } }, required: ['lat', 'lon'] }
            }
        ],
        tool_choice: 'auto'
    };
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${openAIApiKey}`, 'OpenAI-Beta': 'realtime=v1' }});
    // Track call_ids for which we should skip response.create
    const skipResponseCreate = new Set();
    ws.on('open', () => {
        log.info('Connected to OpenAI Realtime WebSocket');
        ws.send(JSON.stringify({ type: 'session.update', session: sessionConfig }));
    });
    ws.on('message', (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
            log.debug('[OpenAI WS message parsed]', msg.type);
        } catch {
            msg = null;
        }
        if (msg && msg.type === 'response.done') {
            // handle Chuck Norris joke calls
            const funcChuck = msg.response.output.find(item => item.type === 'function_call' && item.name === 'get_chuck_norris_joke');
            if (funcChuck) {
                fetch('https://api.chucknorris.io/jokes/random')
                    .then(res => res.json())
                    .then(data => {
                        const joke = data.value;
                        ws.send(JSON.stringify({
                            type: 'conversation.item.create',
                            item: {
                                type: 'function_call_output',
                                call_id: funcChuck.call_id,
                                output: JSON.stringify({ joke })
                            }
                        }));
                        ws.send(JSON.stringify({ type: 'response.create' }));
                    })
                    .catch(err => log.error('Error fetching Chuck Norris joke:', err));
                return;
            }
            // handle clear_conversation calls: restart session
            const funcClear = msg.response.output.find(item => item.type === 'function_call' && item.name === 'clear_conversation');
            if (funcClear) {
                log.info('Received clear_conversation, restarting session');
                ws.send(JSON.stringify({ type: 'session.update', session: sessionConfig }));
                return;
            }
            // handle no_response calls: send empty OK response, do not send response.create
            const funcNoResp = msg.response.output.find(item => item.type === 'function_call' && item.name === 'no_response');
            if (funcNoResp) {
                log.info('Received no_response, sending empty OK');
                ws.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                        type: 'function_call_output',
                        call_id: funcNoResp.call_id,
                        output: JSON.stringify({ ok: true })
                    }
                }));
                // Mark this call_id to skip response.create
                skipResponseCreate.add(funcNoResp.call_id);
                return;
            }
            // handle get_weather calls
            const funcWeather = msg.response.output.find(item => item.type === 'function_call' && item.name === 'get_weather');
            if (funcWeather) {
                let lat, lon;
                try {
                    ({ lat, lon } = JSON.parse(funcWeather.arguments || '{}'));
                } catch (e) {
                    log.warn(`[get_weather] Failed to parse arguments: ${funcWeather.arguments}`);
                }
                log.debug(`[get_weather] called with lat=${lat}, lon=${lon}`);
                if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
                    log.warn(`[get_weather] Invalid or missing lat/lon: lat=${lat}, lon=${lon}`);
                    ws.send(JSON.stringify({
                        type: 'conversation.item.create',
                        item: {
                            type: 'function_call_output',
                            call_id: funcWeather.call_id,
                            output: JSON.stringify({ error: 'Missing or invalid lat/lon for get_weather' })
                        }
                    }));
                    ws.send(JSON.stringify({ type: 'response.create' }));
                    return;
                }
                weather.getCurrent(lat, lon)
                    .then(data => {
                        log.debug(`[get_weather] API result:`, data);
                        ws.send(JSON.stringify({
                            type: 'conversation.item.create',
                            item: {
                                type: 'function_call_output',
                                call_id: funcWeather.call_id,
                                output: JSON.stringify(data)
                            }
                        }));
                        ws.send(JSON.stringify({ type: 'response.create' }));
                    })
                    .catch(err => {
                        log.error('Error fetching weather:', err);
                        log.debug(`[get_weather] failed with error:`, err);
                        ws.send(JSON.stringify({
                            type: 'conversation.item.create',
                            item: {
                                type: 'function_call_output',
                                call_id: funcWeather.call_id,
                                output: JSON.stringify({ error: 'Failed to fetch weather' })
                            }
                        }));
                        ws.send(JSON.stringify({ type: 'response.create' }));
                    });
                return;
            }
            // handle get_24h_forecast calls
            const funcForecast = msg.response.output.find(item => item.type === 'function_call' && item.name === 'get_24h_forecast');
            if (funcForecast) {
                let lat, lon;
                try {
                    ({ lat, lon } = JSON.parse(funcForecast.arguments || '{}'));
                } catch (e) {
                    log.warn(`[get_24h_forecast] Failed to parse arguments: ${funcForecast.arguments}`);
                }
                log.debug(`[get_24h_forecast] called with lat=${lat}, lon=${lon}`);
                if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
                    log.warn(`[get_24h_forecast] Invalid or missing lat/lon: lat=${lat}, lon=${lon}`);
                    ws.send(JSON.stringify({
                        type: 'conversation.item.create',
                        item: {
                            type: 'function_call_output',
                            call_id: funcForecast.call_id,
                            output: JSON.stringify({ error: 'Missing or invalid lat/lon for get_24h_forecast' })
                        }
                    }));
                    ws.send(JSON.stringify({ type: 'response.create' }));
                    return;
                }
                weather.get24hForecast(lat, lon)
                    .then(data => {
                        log.debug(`[get_24h_forecast] API result:`, data);
                        ws.send(JSON.stringify({
                            type: 'conversation.item.create',
                            item: {
                                type: 'function_call_output',
                                call_id: funcForecast.call_id,
                                output: JSON.stringify(data)
                            }
                        }));
                        ws.send(JSON.stringify({ type: 'response.create' }));
                    })
                    .catch(err => {
                        log.error('Error fetching 24h forecast:', err);
                        log.debug(`[get_24h_forecast] failed with error:`, err);
                        ws.send(JSON.stringify({
                            type: 'conversation.item.create',
                            item: {
                                type: 'function_call_output',
                                call_id: funcForecast.call_id,
                                output: JSON.stringify({ error: 'Failed to fetch 24h forecast' })
                            }
                        }));
                        ws.send(JSON.stringify({ type: 'response.create' }));
                    });
                return;
            }
            // handle get_sun_times calls
            const funcSun = msg.response.output.find(item => item.type === 'function_call' && item.name === 'get_sun_times');
            if (funcSun) {
                let lat, lon;
                try {
                    ({ lat, lon } = JSON.parse(funcSun.arguments || '{}'));
                } catch (e) {
                    log.warn(`[get_sun_times] Failed to parse arguments: ${funcSun.arguments}`);
                }
                log.debug(`[get_sun_times] called with lat=${lat}, lon=${lon}`);
                if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
                    log.warn(`[get_sun_times] Invalid or missing lat/lon: lat=${lat}, lon=${lon}`);
                    ws.send(JSON.stringify({
                        type: 'conversation.item.create',
                        item: {
                            type: 'function_call_output',
                            call_id: funcSun.call_id,
                            output: JSON.stringify({ error: 'Missing or invalid lat/lon for get_sun_times' })
                        }
                    }));
                    ws.send(JSON.stringify({ type: 'response.create' }));
                    return;
                }
                weather.getSun(lat, lon)
                    .then(data => {
                        log.debug(`[get_sun_times] API result:`, data);
                        // Convert unix timestamps to readable UTC/local datetimes
                        let result = { ...data };
                        if (data) {
                            const toISO = ts => ts ? new Date(ts * 1000).toISOString() : null;
                            result.sunriseUtcISO = toISO(data.sunriseUtc);
                            result.sunsetUtcISO = toISO(data.sunsetUtc);
                            result.sunriseLocalISO = toISO(data.sunriseLocal);
                            result.sunsetLocalISO = toISO(data.sunsetLocal);
                        }
                        ws.send(JSON.stringify({
                            type: 'conversation.item.create',
                            item: {
                                type: 'function_call_output',
                                call_id: funcSun.call_id,
                                output: JSON.stringify(result)
                            }
                        }));
                        ws.send(JSON.stringify({ type: 'response.create' }));
                    })
                    .catch(err => {
                        log.error('Error fetching sun times:', err);
                        log.debug(`[get_sun_times] failed with error:`, err);
                        ws.send(JSON.stringify({
                            type: 'conversation.item.create',
                            item: {
                                type: 'function_call_output',
                                call_id: funcSun.call_id,
                                output: JSON.stringify({ error: 'Failed to fetch sun times' })
                            }
                        }));
                        ws.send(JSON.stringify({ type: 'response.create' }));
                    });
                return;
            }
        }
        if (msg && msg.type === 'response.audio.delta') {
            const audioBase64 = msg.delta;
            if (audioBase64) {
                const audioBuffer = Buffer.from(audioBase64, 'base64');
                log.debug(`[OpenAI audio delta] size: ${audioBuffer.length} bytes`);
                playback.handleAudio(audioBuffer);
            }
        } else if (msg && msg.type === 'response.audio.done') {
            log.info('OpenAI audio stream done, resetting playback');
            playback.reset();
        }
    });
    ws.on('error', (err) => log.error('OpenAI WebSocket error:', err));
    ws.on('close', () => log.info('OpenAI WebSocket closed'));
    // Intercept outgoing response.create and skip if needed
    const origSend = ws.send.bind(ws);
    ws.send = function (data, ...args) {
        try {
            const obj = typeof data === 'string' ? JSON.parse(data) : data;
            if (obj && obj.type === 'response.create' && obj.call_id && skipResponseCreate.has(obj.call_id)) {
                log.debug(`[no_response] Skipping response.create for call_id=${obj.call_id}`);
                skipResponseCreate.delete(obj.call_id);
                return;
            }
        } catch (e) { /* ignore parse errors, send as normal */ }
        return origSend(data, ...args);
    };
    return ws;
}

// Handles all function/tool message types for OpenAI WebSocket
import fetch from 'node-fetch';
import http from 'http';
import https from 'https';
import * as weather from '@purinton/openweathermap';
// Generate a short sine blip at 24000Hz, 16-bit PCM
function generateBlip(durationMs = 50, freq = 1000, sampleRate = 24000) {
  const sampleCount = Math.floor((durationMs / 1000) * sampleRate);
  const buffer = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate;
    const amp = Math.sin(2 * Math.PI * freq * t);
    buffer.writeInt16LE(Math.floor(amp * 32767), i * 2);
  }
  return buffer;
}

// Keep-alive agents for HTTP(S) requests
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

export async function handleFunctionCall({ msg, ws, log, sessionConfig, client, channelId, playback }) {
    // Log any function calls issued by the AI along with their arguments
    if (msg.response && Array.isArray(msg.response.output)) {
        msg.response.output
            .filter(item => item.type === 'function_call')
            .forEach(async fc => {
                log.info(`AI invoked function '${fc.name}' with arguments:`, fc.arguments);
                // play blip sound in voice channel
                if (playback && playback.handleAudio) playback.handleAudio(generateBlip());
                // Send Discord message with green check and formatted function name
                if (client && channelId) {
                    try {
                        const channel = await client.channels.fetch(channelId);
                        if (channel && channel.send) {
                            // Convert function name to Title Case with spaces
                            const formattedName = fc.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                            await channel.send(`\u2705 **${formattedName}**`);
                        }
                    } catch (err) {
                        log.error('Failed to send function call message to Discord channel:', err);
                    }
                }
            });
    }
    // Helper to send function output
    const sendOutput = (call_id, output) => {
        log.debug('function_call_output', { call_id, output: JSON.stringify(output) });
        ws.send(JSON.stringify({
            type: 'conversation.item.create',
            item: { type: 'function_call_output', call_id, output: JSON.stringify(output) }
        }));
    };
    // Chuck Norris joke
    const funcChuck = msg.response.output.find(item => item.type === 'function_call' && item.name === 'get_chuck_norris_joke');
    if (funcChuck) {
        try {
            const res = await fetch('https://api.chucknorris.io/jokes/random', { agent: httpsAgent });
            const data = await res.json();
            sendOutput(funcChuck.call_id, { joke: data.value });
        } catch (err) {
            log.error('Error fetching Chuck Norris joke:', err);
        }
        return { handled: true, skipResponse: false };
    }
    // clear_conversation
    const funcClear = msg.response.output.find(item => item.type === 'function_call' && item.name === 'clear_conversation');
    if (funcClear) {
        log.info('Received clear_conversation, requesting websocket restart');
        return { handled: true, skipResponse: true, restart: true };
    }
    // no_response: do nothing and skip sending a response
    const funcNoResp = msg.response.output.find(item => item.type === 'function_call' && item.name === 'no_response');
    if (funcNoResp) {
        log.info('Received no_response, skipping response');
        return { handled: true, skipResponse: true };
    }
    // get_weather
    const funcWeather = msg.response.output.find(item => item.type === 'function_call' && item.name === 'get_weather');
    if (funcWeather) {
        let lat, lon;
        try { ({ lat, lon } = JSON.parse(funcWeather.arguments || '{}')); } catch { }
        if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
            sendOutput(funcWeather.call_id, { error: 'Missing or invalid lat/lon for get_weather' });
            return { handled: true, skipResponse: false };
        }
        try {
            const data = await weather.getCurrent(lat, lon, { agent: httpsAgent });
            sendOutput(funcWeather.call_id, data);
        } catch (err) {
            log.error('Error fetching weather:', err);
            sendOutput(funcWeather.call_id, { error: 'Failed to fetch weather' });
        }
        return { handled: true, skipResponse: false };
    }
    // get_24h_forecast
    const funcForecast = msg.response.output.find(item => item.type === 'function_call' && item.name === 'get_24h_forecast');
    if (funcForecast) {
        let lat, lon;
        try { ({ lat, lon } = JSON.parse(funcForecast.arguments || '{}')); } catch { }
        if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
            sendOutput(funcForecast.call_id, { error: 'Missing or invalid lat/lon for get_24h_forecast' });
            return { handled: true, skipResponse: false };
        }
        try {
            const data = await weather.get24hForecast(lat, lon, { agent: httpsAgent });
            sendOutput(funcForecast.call_id, data);
        } catch (err) {
            log.error('Error fetching 24h forecast:', err);
            sendOutput(funcForecast.call_id, { error: 'Failed to fetch 24h forecast' });
        }
        return { handled: true, skipResponse: false };
    }
    // get_sun_times
    const funcSun = msg.response.output.find(item => item.type === 'function_call' && item.name === 'get_sun_times');
    if (funcSun) {
        let lat, lon;
        try { ({ lat, lon } = JSON.parse(funcSun.arguments || '{}')); } catch { }
        if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
            sendOutput(funcSun.call_id, { error: 'Missing or invalid lat/lon for get_sun_times' });
            return { handled: true, skipResponse: false };
        }
        try {
            const data = await weather.getSun(lat, lon, { agent: httpsAgent });
            let result = { ...data };
            if (data) {
                const toISO = ts => ts ? new Date(ts * 1000).toISOString() : null;
                result.sunriseUtcISO = toISO(data.sunriseUtc);
                result.sunsetUtcISO = toISO(data.sunsetUtc);
                result.sunriseLocalISO = toISO(data.sunriseLocal);
                result.sunsetLocalISO = toISO(data.sunsetLocal);
            }
            sendOutput(funcSun.call_id, result);
        } catch (err) {
            log.error('Error fetching sun times:', err);
            sendOutput(funcSun.call_id, { error: 'Failed to fetch sun times' });
        }
        return { handled: true, skipResponse: false };
    }
    // get_current_datetime
    const funcNow = msg.response.output.find(item => item.type === 'function_call' && item.name === 'get_current_datetime');
    if (funcNow) {
        const now = new Date();
        const utc = now.toISOString();
        const local = now.toLocaleString();
        const pad = n => String(n).padStart(2, '0');
        const tzOffset = -now.getTimezoneOffset();
        const sign = tzOffset >= 0 ? '+' : '-';
        const absOffset = Math.abs(tzOffset);
        const offsetHours = pad(Math.floor(absOffset / 60));
        const offsetMinutes = pad(absOffset % 60);
        const localIsoWithOffset = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${offsetHours}:${offsetMinutes}`;
        const result = {
            utc,
            local,
            unix: Math.floor(now.getTime() / 1000),
            iso: utc,
            localString: local,
            localIsoWithOffset
        };
        sendOutput(funcNow.call_id, result);
        return { handled: true, skipResponse: false };
    }
    return { handled: false };
}

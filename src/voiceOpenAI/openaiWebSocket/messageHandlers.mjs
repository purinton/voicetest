// Handles all function/tool message types for OpenAI WebSocket
import fetch from 'node-fetch';
import * as weather from '@purinton/openweathermap';

export async function handleFunctionCall({ msg, ws, log, sessionConfig }) {
    // Helper to send function output
    const sendOutput = (call_id, output) => {
        ws.send(JSON.stringify({
            type: 'conversation.item.create',
            item: { type: 'function_call_output', call_id, output: JSON.stringify(output) }
        }));
    };
    // Chuck Norris joke
    const funcChuck = msg.response.output.find(item => item.type === 'function_call' && item.name === 'get_chuck_norris_joke');
    if (funcChuck) {
        try {
            const res = await fetch('https://api.chucknorris.io/jokes/random');
            const data = await res.json();
            sendOutput(funcChuck.call_id, { joke: data.value });
            ws.send(JSON.stringify({ type: 'response.create' }));
        } catch (err) {
            log.error('Error fetching Chuck Norris joke:', err);
        }
        return true;
    }
    // clear_conversation
    const funcClear = msg.response.output.find(item => item.type === 'function_call' && item.name === 'clear_conversation');
    if (funcClear) {
        log.info('Received clear_conversation, restarting session');
        ws.send(JSON.stringify({ type: 'session.update', session: sessionConfig }));
        return true;
    }
    // no_response
    const funcNoResp = msg.response.output.find(item => item.type === 'function_call' && item.name === 'no_response');
    if (funcNoResp) {
        log.info('Received no_response, sending empty OK');
        sendOutput(funcNoResp.call_id, { ok: true });
        ws.skipResponseCreate?.add(funcNoResp.call_id);
        return true;
    }
    // get_weather
    const funcWeather = msg.response.output.find(item => item.type === 'function_call' && item.name === 'get_weather');
    if (funcWeather) {
        let lat, lon;
        try { ({ lat, lon } = JSON.parse(funcWeather.arguments || '{}')); } catch {}
        if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
            sendOutput(funcWeather.call_id, { error: 'Missing or invalid lat/lon for get_weather' });
            ws.send(JSON.stringify({ type: 'response.create' }));
            return true;
        }
        try {
            const data = await weather.getCurrent(lat, lon);
            sendOutput(funcWeather.call_id, data);
            ws.send(JSON.stringify({ type: 'response.create' }));
        } catch (err) {
            log.error('Error fetching weather:', err);
            sendOutput(funcWeather.call_id, { error: 'Failed to fetch weather' });
            ws.send(JSON.stringify({ type: 'response.create' }));
        }
        return true;
    }
    // get_24h_forecast
    const funcForecast = msg.response.output.find(item => item.type === 'function_call' && item.name === 'get_24h_forecast');
    if (funcForecast) {
        let lat, lon;
        try { ({ lat, lon } = JSON.parse(funcForecast.arguments || '{}')); } catch {}
        if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
            sendOutput(funcForecast.call_id, { error: 'Missing or invalid lat/lon for get_24h_forecast' });
            ws.send(JSON.stringify({ type: 'response.create' }));
            return true;
        }
        try {
            const data = await weather.get24hForecast(lat, lon);
            sendOutput(funcForecast.call_id, data);
            ws.send(JSON.stringify({ type: 'response.create' }));
        } catch (err) {
            log.error('Error fetching 24h forecast:', err);
            sendOutput(funcForecast.call_id, { error: 'Failed to fetch 24h forecast' });
            ws.send(JSON.stringify({ type: 'response.create' }));
        }
        return true;
    }
    // get_sun_times
    const funcSun = msg.response.output.find(item => item.type === 'function_call' && item.name === 'get_sun_times');
    if (funcSun) {
        let lat, lon;
        try { ({ lat, lon } = JSON.parse(funcSun.arguments || '{}')); } catch {}
        if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
            sendOutput(funcSun.call_id, { error: 'Missing or invalid lat/lon for get_sun_times' });
            ws.send(JSON.stringify({ type: 'response.create' }));
            return true;
        }
        try {
            const data = await weather.getSun(lat, lon);
            // Convert unix timestamps to readable UTC/local datetimes
            let result = { ...data };
            if (data) {
                const toISO = ts => ts ? new Date(ts * 1000).toISOString() : null;
                result.sunriseUtcISO = toISO(data.sunriseUtc);
                result.sunsetUtcISO = toISO(data.sunsetUtc);
                result.sunriseLocalISO = toISO(data.sunriseLocal);
                result.sunsetLocalISO = toISO(data.sunsetLocal);
            }
            sendOutput(funcSun.call_id, result);
            ws.send(JSON.stringify({ type: 'response.create' }));
        } catch (err) {
            log.error('Error fetching sun times:', err);
            sendOutput(funcSun.call_id, { error: 'Failed to fetch sun times' });
            ws.send(JSON.stringify({ type: 'response.create' }));
        }
        return true;
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
        const localIsoWithOffset = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${offsetHours}:${offsetMinutes}`;
        const result = {
            utc,
            local,
            unix: Math.floor(now.getTime() / 1000),
            iso: utc,
            localString: local,
            localIsoWithOffset
        };
        sendOutput(funcNow.call_id, result);
        ws.send(JSON.stringify({ type: 'response.create' }));
        return true;
    }
    return false;
}

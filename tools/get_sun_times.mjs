import * as weather from '@purinton/openweathermap';
import https from 'https';

const httpsAgent = new https.Agent({ keepAlive: true });

export default async function ({ call_id, ws, log, args }) {
  let lat, lon;
  try { ({ lat, lon } = args); } catch {}
  if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
    ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id, output: JSON.stringify({ error: 'Missing or invalid lat/lon for get_sun_times' }) }
    }));
    return;
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
    ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id, output: JSON.stringify(result) }
    }));
  } catch (err) {
    log.error('Error fetching sun times:', err);
    ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id, output: JSON.stringify({ error: 'Failed to fetch sun times' }) }
    }));
  }
}

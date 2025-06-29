import * as weather from '@purinton/openweathermap';
import https from 'https';

const httpsAgent = new https.Agent({ keepAlive: true });

export default async function ({ call_id, ws, log, args }) {
  let lat, lon;
  try { ({ lat, lon } = args); } catch {}
  if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
    ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id, output: JSON.stringify({ error: 'Missing or invalid lat/lon for get_weather' }) }
    }));
    return;
  }
  try {
    const data = await weather.getCurrent(lat, lon, { agent: httpsAgent });
    ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id, output: JSON.stringify(data) }
    }));
  } catch (err) {
    log.error('Error fetching weather:', err);
    ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id, output: JSON.stringify({ error: 'Failed to fetch weather' }) }
    }));
  }
}

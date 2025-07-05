export default async function ({ call_id, ws, log, args = {} }) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const getDay = d => d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const getIsoWithDay = (d, tz) => {
    const date = tz ? new Date(d.toLocaleString('en-US', { timeZone: tz })) : d;
    const day = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz || 'UTC' });
    const iso = date.toISOString().replace('T', 'T').replace('Z', 'Z');
    return `${day}, ${iso}`;
  };

  const result = {
    UTC: {
      unix: Math.floor(now.getTime() / 1000),
      isoWithDay: getIsoWithDay(now, 'UTC')
    }
  };

  if (Array.isArray(args.timezones)) {
    for (const tz of args.timezones) {
      try {
        const date = new Date(now.toLocaleString('en-US', { timeZone: tz }));
        result[tz] = {
          unix: Math.floor(date.getTime() / 1000),
          isoWithDay: getIsoWithDay(now, tz)
        };
      } catch (e) {
        result[tz] = { error: `Invalid timezone: ${tz}` };
      }
    }
  }

  ws.send(JSON.stringify({
    type: 'conversation.item.create',
    item: { type: 'function_call_output', call_id, output: JSON.stringify(result) }
  }));
}

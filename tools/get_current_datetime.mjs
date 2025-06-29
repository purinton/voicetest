export default async function ({ call_id, ws, log }) {
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
  ws.send(JSON.stringify({
    type: 'conversation.item.create',
    item: { type: 'function_call_output', call_id, output: JSON.stringify(result) }
  }));
}

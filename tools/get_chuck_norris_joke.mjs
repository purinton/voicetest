import fetch from 'node-fetch';

export default async function ({ call_id, ws, log }) {
  try {
    const res = await fetch('https://api.chucknorris.io/jokes/random');
    const data = await res.json();
    ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id, output: JSON.stringify({ joke: data.value }) }
    }));
  } catch (err) {
    log.error('Error fetching Chuck Norris joke:', err);
  }
}

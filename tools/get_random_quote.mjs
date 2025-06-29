import fetch from 'node-fetch';

export default async function ({ call_id, ws, log }) {
  try {
    // Using quotable.io for free random quotes
    const res = await fetch('https://api.quotable.io/random');
    const data = await res.json();
    ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id,
        output: JSON.stringify({ quote: data.content, author: data.author })
      }
    }));
  } catch (err) {
    log.error('Error fetching random quote:', err);
  }
}

import fetch from 'node-fetch';

export default async function ({ call_id, ws, log }) {
  try {
    // Using ZenQuotes.io for free random quotes
    const res = await fetch('https://zenquotes.io/api/random');
    const data = await res.json();
    const quoteObj = Array.isArray(data) && data[0] ? data[0] : { q: 'No quote found', a: '' };
    ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id,
        output: JSON.stringify({ quote: quoteObj.q, author: quoteObj.a })
      }
    }));
  } catch (err) {
    log.error('Error fetching random quote:', err);
  }
}

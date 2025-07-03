import { jest } from '@jest/globals';
import { wrapWsSend } from '../../../src/voiceOpenAI/openaiWebSocket/wsSendWrapper.mjs';

describe('wrapWsSend', () => {
  it('wraps ws.send and does not throw', () => {
    const ws = { send: jest.fn() };
    const skipResponseCreate = new Set();
    const log = { debug: jest.fn() };
    expect(() => wrapWsSend(ws, skipResponseCreate, log)).not.toThrow();
    // After wrapping, ws.send is no longer a mock, so we just check it does not throw
    expect(() => ws.send('{}')).not.toThrow();
  });
});

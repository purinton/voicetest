import { jest } from '@jest/globals';
import { handleFunctionCall } from '../../../src/voiceOpenAI/openaiWebSocket/messageHandlers.mjs';

describe('handleFunctionCall', () => {
  it('returns handled false for non-array output', async () => {
    const result = await handleFunctionCall({ msg: { response: { output: null } }, ws: {}, log: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() } });
    expect(result.handled).toBe(false);
  });
});

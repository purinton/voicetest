import { jest } from '@jest/globals';
import { createOpenAIWebSocket, attachSendMessageToClient } from '../../src/voiceOpenAI/openaiWebSocket.mjs';

describe('createOpenAIWebSocket', () => {
  it('should throw if no openAIApiKey', async () => {
    await expect(createOpenAIWebSocket({ openAIApiKey: undefined, log: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } })).rejects.toThrow();
  });
});

describe('attachSendMessageToClient', () => {
  it('should not throw if client is undefined', () => {
    expect(() => attachSendMessageToClient(undefined, {}, { warn: jest.fn() })).not.toThrow();
  });
});

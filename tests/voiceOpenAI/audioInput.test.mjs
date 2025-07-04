import { jest } from '@jest/globals';
import { setupAudioInput } from '../../src/voiceOpenAI/audioInput.mjs';

describe('setupAudioInput', () => {
  it('should return a cleanup function', () => {
    const mockClient = {};
    const mockVoiceConnection = { receiver: { speaking: { on: jest.fn(), off: jest.fn() } } };
    const mockOpenAIWS = {};
    const mockLog = { debug: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const cleanup = setupAudioInput({ client: mockClient, voiceConnection: mockVoiceConnection, openAIWS: mockOpenAIWS, log: mockLog });
    expect(typeof cleanup).toBe('function');
  });
});

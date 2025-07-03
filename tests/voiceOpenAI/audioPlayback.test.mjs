import { jest } from '@jest/globals';
import { createAudioPlayback } from '../../src/voiceOpenAI/audioPlayback.mjs';

describe('createAudioPlayback', () => {
  it('should return handleAudio and reset functions', () => {
    const mockAudioPlayer = { play: jest.fn() };
    const playback = createAudioPlayback(mockAudioPlayer);
    expect(typeof playback.handleAudio).toBe('function');
    expect(typeof playback.reset).toBe('function');
  });
});

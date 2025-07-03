import { jest } from '@jest/globals';
import { generateBeepPCM, playBeep } from '../../src/voiceOpenAI/beep.mjs';

describe('beep utilities', () => {
  it('generateBeepPCM returns a Buffer', () => {
    const buf = generateBeepPCM();
    expect(Buffer.isBuffer(buf)).toBe(true);
  });
  it('playBeep does not throw', () => {
    const mockAudioPlayer = { play: jest.fn() };
    const mockLog = { error: jest.fn() };
    expect(() => playBeep(mockAudioPlayer, mockLog)).not.toThrow();
  });
});

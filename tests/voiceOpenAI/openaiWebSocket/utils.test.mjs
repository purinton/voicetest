import { jest } from '@jest/globals';
import { pad } from '../../../src/voiceOpenAI/openaiWebSocket/utils.mjs';

describe('pad', () => {
  it('pads single digit numbers with zero', () => {
    expect(pad(5)).toBe('05');
    expect(pad(12)).toBe('12');
  });
});

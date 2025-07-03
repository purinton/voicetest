import { jest } from '@jest/globals';
import { loadInstructions } from '../../src/voiceOpenAI/instructions.mjs';

describe('loadInstructions', () => {
  it('should return a string', () => {
    const mockLog = { debug: jest.fn(), warn: jest.fn() };
    const result = loadInstructions(mockLog);
    expect(typeof result).toBe('string');
  });
});

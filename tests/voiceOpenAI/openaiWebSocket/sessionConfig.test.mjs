import { jest } from '@jest/globals';
import { getSessionConfig } from '../../../src/voiceOpenAI/openaiWebSocket/sessionConfig.mjs';

describe('getSessionConfig', () => {
  it('returns a config object with required properties', () => {
    const config = getSessionConfig({ instructions: 'test', voice: 'en', tools: [] });
    expect(config).toHaveProperty('modalities');
    expect(config).toHaveProperty('instructions');
    expect(config).toHaveProperty('voice');
    expect(config).toHaveProperty('tools');
  });
});

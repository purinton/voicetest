import { jest } from '@jest/globals';
import { setupVoiceConnection } from '../../src/voiceOpenAI/voiceConnection.mjs';

describe('setupVoiceConnection', () => {
  it('throws if guild not found', () => {
    expect(() => setupVoiceConnection({ client: { guilds: { cache: new Map() } }, guildId: '1', voiceChannelId: '2', log: { debug: jest.fn() } })).toThrow('Guild not found');
  });
});

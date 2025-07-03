import { jest } from '@jest/globals';
import { handleAudioDelta } from '../../../src/voiceOpenAI/openaiWebSocket/audioHandlers.mjs';

describe('audioHandlers', () => {
    it('handleAudioDelta decodes and passes audio', () => {
        const mockPlayback = { handleAudio: jest.fn() };
        const msg = { delta: Buffer.from('test').toString('base64') };
        handleAudioDelta({ msg, playback: mockPlayback, log: {} });
        expect(mockPlayback.handleAudio).toHaveBeenCalled();
    });
});

import { jest } from '@jest/globals';
import { handleAudioDelta, handleAudioDone } from '../../../src/voiceOpenAI/openaiWebSocket/audioHandlers.mjs';

describe('audioHandlers', () => {
    it('handleAudioDelta decodes and passes audio', () => {
        const mockPlayback = { handleAudio: jest.fn() };
        const msg = { delta: Buffer.from('test').toString('base64') };
        handleAudioDelta({ msg, playback: mockPlayback, log: {} });
        expect(mockPlayback.handleAudio).toHaveBeenCalled();
    });
    it('handleAudioDone calls reset', () => {
        const mockPlayback = { reset: jest.fn() };
        handleAudioDone({ playback: mockPlayback, log: { debug: jest.fn() } });
        expect(mockPlayback.reset).toHaveBeenCalled();
    });
});

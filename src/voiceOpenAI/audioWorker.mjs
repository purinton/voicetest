import { parentPort, workerData } from 'worker_threads';

// Worker batches raw PCM chunks and emits fixed-size frames
const FRAME_BATCH_COUNT = workerData.FRAME_BATCH_COUNT;
const FRAME_SIZE_BYTES = workerData.FRAME_SIZE_BYTES;
const buffers = new Map();

parentPort.on('message', ({ userId, chunk }) => {
    const arr = buffers.get(userId) || [];
    arr.push(chunk);
    if (arr.length >= FRAME_BATCH_COUNT) {
        const buf = Buffer.concat(arr);
        buffers.set(userId, []);
        const frames = [];
        for (let offset = 0; offset + FRAME_SIZE_BYTES <= buf.length; offset += FRAME_SIZE_BYTES) {
            frames.push(buf.slice(offset, offset + FRAME_SIZE_BYTES));
        }
        parentPort.postMessage({ userId, frames });
    } else {
        buffers.set(userId, arr);
    }
});

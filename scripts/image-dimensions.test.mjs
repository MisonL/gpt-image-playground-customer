import { readImageDimensions } from '../skills/visual-journal-agent/scripts/lib/image-dimensions.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('readImageDimensions reads PNG dimensions', () => {
    assert.deepEqual(readImageDimensions(pngBuffer(3840, 2160)), { width: 3840, height: 2160 });
});

test('readImageDimensions reads JPEG dimensions', () => {
    assert.deepEqual(readImageDimensions(jpegBuffer(1280, 720)), { width: 1280, height: 720 });
});

test('readImageDimensions reads progressive JPEG dimensions', () => {
    assert.deepEqual(readImageDimensions(jpegBuffer(1600, 900, 0xc2)), { width: 1600, height: 900 });
});

test('readImageDimensions reads WebP VP8X dimensions', () => {
    assert.deepEqual(readImageDimensions(webpVp8xBuffer(1024, 1024)), { width: 1024, height: 1024 });
});

test('readImageDimensions reads WebP VP8L dimensions', () => {
    assert.deepEqual(readImageDimensions(webpVp8lBuffer(512, 768)), { width: 512, height: 768 });
});

test('readImageDimensions reads WebP VP8 dimensions', () => {
    assert.deepEqual(readImageDimensions(webpVp8Buffer(640, 360)), { width: 640, height: 360 });
});

test('readImageDimensions rejects empty buffers', () => {
    assert.throws(() => readImageDimensions(Buffer.alloc(0)), /图片数据为空/);
});

test('readImageDimensions rejects unknown formats', () => {
    assert.throws(() => readImageDimensions(Buffer.from('not-an-image')), /无法识别图片格式/);
});

test('readImageDimensions rejects truncated PNG buffers', () => {
    assert.throws(() => readImageDimensions(pngBuffer(1, 1).subarray(0, 16)), /PNG 图片数据截断/);
});

test('readImageDimensions rejects truncated JPEG buffers', () => {
    assert.throws(() => readImageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00])), /JPEG 图片数据截断/);
});

test('readImageDimensions rejects JPEG SOF segments without enough metadata for dimensions', () => {
    assert.throws(() => readImageDimensions(jpegBuffer(1280, 720, 0xc0, 0x07)), /JPEG 图片数据截断/);
});

test('readImageDimensions rejects truncated WebP buffers', () => {
    assert.throws(() => readImageDimensions(webpHeader('VP8X', 20)), /WebP 图片数据截断/);
});

function pngBuffer(width, height) {
    const buffer = Buffer.alloc(24);
    buffer[0] = 0x89;
    buffer.write('PNG', 1, 'ascii');
    buffer[4] = 0x0d;
    buffer[5] = 0x0a;
    buffer[6] = 0x1a;
    buffer[7] = 0x0a;
    buffer.writeUInt32BE(13, 8);
    buffer.write('IHDR', 12, 'ascii');
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
}

function jpegBuffer(width, height, marker = 0xc0, length = 0x0b) {
    return Buffer.from([
        0xff,
        0xd8,
        0xff,
        0xe0,
        0x00,
        0x04,
        0x00,
        0x00,
        0xff,
        marker,
        0x00,
        length,
        0x08,
        (height >> 8) & 0xff,
        height & 0xff,
        (width >> 8) & 0xff,
        width & 0xff,
        0x01,
        0x01,
        0x11,
        0x00
    ]);
}

function webpHeader(chunk, length) {
    const buffer = Buffer.alloc(length);
    buffer.write('RIFF', 0, 'ascii');
    buffer.write('WEBP', 8, 'ascii');
    buffer.write(chunk, 12, 'ascii');
    return buffer;
}

function webpVp8xBuffer(width, height) {
    const buffer = webpHeader('VP8X', 30);
    buffer.writeUIntLE(width - 1, 24, 3);
    buffer.writeUIntLE(height - 1, 27, 3);
    return buffer;
}

function webpVp8lBuffer(width, height) {
    const buffer = webpHeader('VP8L', 25);
    const bits = ((height - 1) << 14) | (width - 1);
    buffer.writeUInt32LE(bits, 21);
    return buffer;
}

function webpVp8Buffer(width, height) {
    const buffer = webpHeader('VP8 ', 30);
    buffer.writeUInt16LE(width, 26);
    buffer.writeUInt16LE(height, 28);
    return buffer;
}

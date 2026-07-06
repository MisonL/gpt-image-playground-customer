export function readImageDimensions(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('图片数据为空，无法读取尺寸。');
    }
    if (hasPngSignature(buffer)) {
        return readPngDimensions(buffer);
    }
    if (hasWebpSignature(buffer)) {
        return readWebpDimensions(buffer);
    }
    if (hasJpegSignature(buffer)) {
        return readJpegDimensions(buffer);
    }
    throw new Error('无法识别图片格式。');
}

function hasPngSignature(buffer) {
    return (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer.toString('ascii', 1, 4) === 'PNG' &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
    );
}

function hasWebpSignature(buffer) {
    return (
        buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
    );
}

function hasJpegSignature(buffer) {
    return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

function readPngDimensions(buffer) {
    if (buffer.length < 24) throw new Error('PNG 图片数据截断，无法读取尺寸。');
    if (buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('无法读取 PNG 图片尺寸。');
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    assertPositiveDimensions(width, height, 'PNG');
    return { width, height };
}

function readJpegDimensions(buffer) {
    let offset = 2;
    while (offset < buffer.length) {
        while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
        if (offset >= buffer.length) throw new Error('JPEG 图片数据截断，无法读取尺寸。');

        const marker = buffer[offset];
        offset += 1;
        if (marker === 0xd9 || marker === 0xda) break;
        if (isStandaloneJpegMarker(marker)) continue;

        if (offset + 2 > buffer.length) throw new Error('JPEG 图片数据截断，无法读取尺寸。');
        const length = buffer.readUInt16BE(offset);
        if (length < 2) throw new Error('JPEG 图片段长度无效，无法读取尺寸。');
        const segmentStart = offset + 2;
        const segmentEnd = offset + length;
        if (segmentEnd > buffer.length) throw new Error('JPEG 图片数据截断，无法读取尺寸。');

        if (isJpegStartOfFrame(marker)) {
            if (length < 8) throw new Error('JPEG 图片数据截断，无法读取尺寸。');
            const height = buffer.readUInt16BE(segmentStart + 1);
            const width = buffer.readUInt16BE(segmentStart + 3);
            assertPositiveDimensions(width, height, 'JPEG');
            return { width, height };
        }
        offset = segmentEnd;
    }
    throw new Error('无法读取 JPEG 图片尺寸。');
}

function isStandaloneJpegMarker(marker) {
    return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);
}

function isJpegStartOfFrame(marker) {
    return (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
    );
}

function readWebpDimensions(buffer) {
    if (buffer.length < 16) throw new Error('WebP 图片数据截断，无法读取尺寸。');
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
        if (buffer.length < 30) throw new Error('WebP 图片数据截断，无法读取尺寸。');
        const width = 1 + buffer.readUIntLE(24, 3);
        const height = 1 + buffer.readUIntLE(27, 3);
        assertPositiveDimensions(width, height, 'WebP');
        return { width, height };
    }
    if (chunk === 'VP8L') {
        if (buffer.length < 25) throw new Error('WebP 图片数据截断，无法读取尺寸。');
        const bits = buffer.readUInt32LE(21);
        const width = (bits & 0x3fff) + 1;
        const height = ((bits >> 14) & 0x3fff) + 1;
        assertPositiveDimensions(width, height, 'WebP');
        return { width, height };
    }
    if (chunk === 'VP8 ') {
        if (buffer.length < 30) throw new Error('WebP 图片数据截断，无法读取尺寸。');
        const width = buffer.readUInt16LE(26) & 0x3fff;
        const height = buffer.readUInt16LE(28) & 0x3fff;
        assertPositiveDimensions(width, height, 'WebP');
        return { width, height };
    }
    throw new Error('无法读取 WebP 图片尺寸。');
}

function assertPositiveDimensions(width, height, format) {
    if (width > 0 && height > 0) return;
    throw new Error(`${format} 图片尺寸无效。`);
}

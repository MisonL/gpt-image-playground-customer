import {
    extractImageBase64FromDataUrl,
    isRemoteHttpUrl,
    readResponsesImageResultBase64
} from './image-payload';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

describe('image payload parsing', () => {
    it('extracts only image base64 data URLs', () => {
        assert.equal(extractImageBase64FromDataUrl(`data:image/png;base64,${PNG_BASE64}`), PNG_BASE64);
        assert.equal(extractImageBase64FromDataUrl('data:text/html;base64,PHNjcmlwdD4='), undefined);
        assert.equal(extractImageBase64FromDataUrl(`data:image/svg+xml;base64,${PNG_BASE64}`), undefined);
        assert.equal(extractImageBase64FromDataUrl('data:image/png,not-base64'), undefined);
    });

    it('accepts bare standard base64 Responses image results and rejects unsafe strings', () => {
        assert.equal(readResponsesImageResultBase64(PNG_BASE64), PNG_BASE64);
        assert.equal(readResponsesImageResultBase64(`${PNG_BASE64.slice(0, 8)}\n${PNG_BASE64.slice(8)}`), undefined);
        assert.equal(readResponsesImageResultBase64('https://example.test/image.png'), undefined);
        assert.equal(readResponsesImageResultBase64('data:text/html;base64,PHNjcmlwdD4='), undefined);
        assert.equal(readResponsesImageResultBase64('<script>alert(1)</script>'), undefined);
    });

    it('recognizes only http and https remote URLs', () => {
        assert.equal(isRemoteHttpUrl('https://example.test/image.png'), true);
        assert.equal(isRemoteHttpUrl('http://example.test/image.png'), true);
        assert.equal(isRemoteHttpUrl('file:///etc/passwd'), false);
    });
});

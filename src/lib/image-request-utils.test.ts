import { readEditQuality, readGenerateQuality, readImageFiles, validateApiBaseUrl } from './image-request-utils';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('image request quality defaults', () => {
    it('defaults image generation to high quality', () => {
        assert.equal(readGenerateQuality(new FormData()), 'high');
    });

    it('keeps image editing quality on auto by default', () => {
        assert.equal(readEditQuality(new FormData()), 'auto');
    });
});

describe('validateApiBaseUrl', () => {
    it('accepts https and local http OpenAI-compatible base URLs', () => {
        assert.doesNotThrow(() => validateApiBaseUrl('https://api.openai.com/v1'));
        assert.doesNotThrow(() => validateApiBaseUrl('http://localhost:4783/v1'));
        assert.doesNotThrow(() => validateApiBaseUrl('http://127.0.0.1:4783/v1'));
        assert.doesNotThrow(() => validateApiBaseUrl('http://[::1]:4783/v1'));
    });

    it('rejects remote plain-http API base URLs by default', () => {
        assert.throws(() => validateApiBaseUrl('http://api.j3gb.com/v1'), /HTTPS/);
        assert.throws(() => validateApiBaseUrl('http://192.168.1.2/v1'), /HTTPS/);
    });

    it('accepts explicitly allowlisted remote plain-http API base URLs', () => {
        assert.doesNotThrow(() =>
            validateApiBaseUrl('http://api.j3gb.com/v1', {
                allowedPlainHttpBaseUrls: ['http://api.j3gb.com/v1']
            })
        );
    });

    it('rejects non-http protocols', () => {
        assert.throws(() => validateApiBaseUrl('ftp://api.example.com/v1'), /http 或 https/);
    });

    it('rejects credentials, query strings, and fragments', () => {
        assert.throws(() => validateApiBaseUrl('https://user:pass@example.com/v1'), /用户名或密码/);
        assert.throws(() => validateApiBaseUrl('https://example.com/v1?token=one'), /查询参数或片段/);
        assert.throws(() => validateApiBaseUrl('https://example.com/v1#key'), /查询参数或片段/);
    });
});

describe('readImageFiles', () => {
    it('accepts only documented image_0 through image_9 upload fields', () => {
        const formData = new FormData();
        formData.append('avatar', makePngFile('ignored-avatar.png'));
        formData.append('image_streaming_strategy', 'force-sse');
        formData.append('image_1', makePngFile('accepted-1.png'));
        formData.append('image_9', makePngFile('accepted-9.png'));

        assert.deepEqual(
            readImageFiles(formData).map((file) => file.name),
            ['accepted-1.png', 'accepted-9.png']
        );
    });

    it('rejects undocumented image-like upload fields instead of ignoring them', () => {
        const formData = new FormData();
        formData.append('image_foo', makePngFile('ignored-foo.png'));
        formData.append('image_0', makePngFile('accepted-0.png'));

        assert.throws(() => readImageFiles(formData), /图片字段 image_foo 无效/);
    });

    it('rejects zero-padded and out-of-range image upload fields', () => {
        const formData = new FormData();
        formData.append('image_01', makePngFile('ignored-01.png'));
        formData.append('image_10', makePngFile('ignored-10.png'));

        assert.throws(() => readImageFiles(formData), /图片字段 image_01 无效/);
    });

    it('rejects documented image fields when their value is not a file', () => {
        const formData = new FormData();
        formData.append('image_0', 'not-a-file');

        assert.throws(() => readImageFiles(formData), /image_0 必须是图片文件/);
    });

    it('returns uploaded images sorted by numeric field index', () => {
        const formData = new FormData();
        formData.append('image_1', makePngFile('second.png'));
        formData.append('image_0', makePngFile('first.png'));

        assert.deepEqual(
            readImageFiles(formData).map((file) => file.name),
            ['first.png', 'second.png']
        );
    });

    it('rejects duplicate image upload fields', () => {
        const formData = new FormData();
        formData.append('image_0', makePngFile('first.png'));
        formData.append('image_0', makePngFile('duplicate.png'));

        assert.throws(() => readImageFiles(formData), /图片字段 image_0 重复/);
    });
});

function makePngFile(name: string): File {
    return new File([Buffer.from(PNG_BASE64, 'base64')], name, { type: 'image/png' });
}

const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAC0lEQVR4nGNk+A8AAwMBASp7pYQAAAAASUVORK5CYII=';

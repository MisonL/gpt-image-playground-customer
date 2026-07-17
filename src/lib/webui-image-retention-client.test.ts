import {
    mergeWebuiImageRetentionResults,
    readApiErrorMessage,
    readWebuiImageFileOperationResults,
    readWebuiImageRetentionFilenames
} from './webui-image-retention-client';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('WebUI image retention client contract', () => {
    it('parses permanent filenames and file operation results from valid API responses', () => {
        assert.deepEqual(readWebuiImageRetentionFilenames({ filenames: ['one.png', 'two.png', 'one.png'] }), [
            'one.png',
            'two.png'
        ]);
        assert.deepEqual(
            readWebuiImageFileOperationResults({
                results: [
                    { filename: 'one.png', success: true },
                    { filename: 'two.png', success: false, fileAbsent: true, error: '文件不存在。' }
                ]
            }),
            [
                { filename: 'one.png', success: true },
                { filename: 'two.png', success: false, fileAbsent: true, error: '文件不存在。' }
            ]
        );
        assert.equal(readApiErrorMessage({ error: '未授权。' }), '未授权。');
    });

    it('rejects malformed API payloads instead of silently accepting them', () => {
        assert.throws(() => readWebuiImageRetentionFilenames({ filenames: ['one.png', 2] }), /格式无效/);
        assert.throws(() => readWebuiImageFileOperationResults({ results: [{ filename: 'one.png' }] }), /格式无效/);
        assert.equal(readApiErrorMessage({ message: 'not an error field' }), undefined);
    });

    it('merges only successful file operations into the permanent filename set', () => {
        const results = [
            { filename: 'kept.png', success: true },
            { filename: 'failed.png', success: false, fileAbsent: true, error: '文件不存在。' }
        ];

        assert.deepEqual([...mergeWebuiImageRetentionResults(new Set(['existing.png']), 'preserve', results)].sort(), [
            'existing.png',
            'kept.png'
        ]);
        assert.deepEqual(
            [...mergeWebuiImageRetentionResults(new Set(['kept.png', 'failed.png']), 'release', results)].sort(),
            []
        );
    });
});

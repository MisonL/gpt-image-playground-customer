import {
    mergeWebuiImageRetentionResults,
    readWebuiImageFileOperationResults,
    readWebuiImageRetentionFilenames
} from './webui-image-retention-client';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('WebUI image retention client contract', () => {
    it('parses cleanup-protected filenames and file operation results from valid API responses', () => {
        assert.deepEqual(readWebuiImageRetentionFilenames({ filenames: ['one.png', 'two.png', 'one.png'] }), [
            'one.png',
            'two.png'
        ]);
        assert.deepEqual(
            readWebuiImageFileOperationResults({
                results: [
                    { filename: 'one.png', success: true },
                    {
                        filename: 'two.png',
                        success: false,
                        fileAbsent: true,
                        markerRemoved: true,
                        error: '文件不存在。'
                    }
                ]
            }),
            [
                { filename: 'one.png', success: true },
                {
                    filename: 'two.png',
                    success: false,
                    fileAbsent: true,
                    markerRemoved: true,
                    error: '文件不存在。'
                }
            ]
        );
    });

    it('rejects malformed API payloads instead of silently accepting them', () => {
        assert.throws(() => readWebuiImageRetentionFilenames({ filenames: ['one.png', 2] }), /格式无效/);
        assert.throws(() => readWebuiImageFileOperationResults({ results: [{ filename: 'one.png' }] }), /格式无效/);
    });

    it('merges only confirmed cleanup-protection changes into the filename set', () => {
        const results = [
            { filename: 'kept.png', success: true },
            {
                filename: 'released.png',
                success: false,
                fileAbsent: true,
                markerRemoved: true,
                error: '文件不存在。'
            },
            {
                filename: 'marker-failed.png',
                success: false,
                fileDeleted: true,
                markerRemoved: false,
                error: '图片已删除，但自动清理保护未能清理。'
            }
        ];

        assert.deepEqual([...mergeWebuiImageRetentionResults(new Set(['existing.png']), 'preserve', results)].sort(), [
            'existing.png',
            'kept.png'
        ]);
        assert.deepEqual(
            [
                ...mergeWebuiImageRetentionResults(
                    new Set(['kept.png', 'released.png', 'marker-failed.png']),
                    'release',
                    results
                )
            ].sort(),
            ['marker-failed.png']
        );
    });
});

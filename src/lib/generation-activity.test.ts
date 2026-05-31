import {
    buildFailureActivityDetail,
    buildGenerationActivityItems,
    type GenerationActivityItem
} from './generation-activity';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const messages: Record<string, string> = {
    'error.unexpected': '发生未知错误。',
    'history.activityEditingDetail': '正在根据参考图生成新画面，完成后会进入最近生成。',
    'history.activityFailed': '生成失败',
    'history.activityFailedDetail': '{message} 建议检查 API 设置后重试，或切换可用渠道。',
    'history.activityGenerating': '正在生成',
    'history.activityGeneratingDetail': '正在把当前创作单送去生成，完成后会进入最近生成。',
    'history.activityPreparingEdit': '正在准备编辑素材',
    'history.activityPreparingEditDetail': '正在读取当前图片，完成后会切换到编辑创作单。',
    'history.activitySaved': '图片保存完成',
    'history.activitySavedDetail': '本次结果共 {count} 张，已可继续编辑或下载。',
    'history.activityStreaming': '流式预览已更新',
    'history.activityStreamingDetail': '已收到 {count} 张过程预览。'
};

function t(key: string, values?: Record<string, string | number>): string {
    return (messages[key] || key).replace(/\{(\w+)\}/g, (match, valueKey) => String(values?.[valueKey] ?? match));
}

function ids(items: GenerationActivityItem[]): string[] {
    return items.map((item) => item.id);
}

describe('buildGenerationActivityItems', () => {
    it('reports request start, streaming preview, and failure reason from live state flags', () => {
        const items = buildGenerationActivityItems({
            isLoading: true,
            isSendingToEdit: false,
            mode: 'edit',
            streamingPreviewCount: 2,
            errorMessage: '上游服务不可用',
            completedGenerationCount: 1,
            t
        });

        assert.deepEqual(ids(items), ['generating', 'streaming-preview', 'failed']);
        assert.match(items[0].detail, /参考图生成新画面/);
        assert.match(items[1].detail, /2 张过程预览/);
        assert.match(items[2].detail, /上游服务不可用/);
        assert.match(items[2].detail, /建议检查 API 设置后重试/);
    });

    it('reports saved completion only after loading ends with a completed generation count', () => {
        const items = buildGenerationActivityItems({
            isLoading: false,
            isSendingToEdit: false,
            mode: 'generate',
            streamingPreviewCount: 0,
            completedGenerationCount: 1,
            t
        });

        assert.deepEqual(ids(items), ['saved']);
        assert.match(items[0].detail, /1 张/);
    });

    it('does not report saved completion without a completed generation count', () => {
        const items = buildGenerationActivityItems({
            isLoading: false,
            isSendingToEdit: false,
            mode: 'generate',
            streamingPreviewCount: 0,
            completedGenerationCount: null,
            t
        });

        assert.deepEqual(items, []);
    });

    it('keeps existing API advice instead of appending a second retry suggestion', () => {
        const detail = buildFailureActivityDetail('API 请求失败。建议：稍后重试。', t);

        assert.equal(detail, 'API 请求失败。建议：稍后重试。');
    });
});

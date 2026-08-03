import { findBatchPromptOverLimitIndex, formatBatchPromptHistory, readBatchPromptLines } from './batch-prompts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('readBatchPromptLines', () => {
    it('keeps non-empty prompts in user order', () => {
        assert.deepEqual(readBatchPromptLines('  午后咖啡馆窗边  \n\n奶油色卧室一角\r\n  周末花店门口  '), [
            '午后咖啡馆窗边',
            '奶油色卧室一角',
            '周末花店门口'
        ]);
    });

    it('does not invent prompts from empty lines', () => {
        assert.deepEqual(readBatchPromptLines('\n  \r\n'), []);
    });

    it('identifies the first prompt that exceeds the configured length', () => {
        assert.equal(findBatchPromptOverLimitIndex(['short', 'x'.repeat(11), 'long'], 10), 1);
        assert.equal(findBatchPromptOverLimitIndex(['short', 'exactly-ten'], 10), 1);
        assert.equal(findBatchPromptOverLimitIndex(['short', 'exactly-ten'], 11), null);
    });
});

describe('formatBatchPromptHistory', () => {
    it('stores batch prompts as a readable multiline history prompt', () => {
        assert.equal(formatBatchPromptHistory(['第一张', '第二张']), '第一张\n第二张');
    });
});

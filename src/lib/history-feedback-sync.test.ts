import {
    buildHistoryFeedbackDeleteKey,
    buildHistoryFeedbackDeletePayload,
    buildHistoryFeedbackDeleteTargets,
    buildHistoryFeedbackSyncPayload,
    buildHistoryFeedbackSyncPayloads,
    buildHistoryFeedbackSyncInputs,
    buildHistoryFeedbackSyncKey,
    buildHistoryFeedbackTargets,
    parseHistoryFeedbackDeleteQueue,
    parseHistoryFeedbackSyncQueue,
    removeHistoryFeedbackDeleteQueuePayload,
    removeHistoryFeedbackDeleteQueueTargets,
    removeHistoryFeedbackSyncQueueItem,
    removeHistoryFeedbackSyncQueueTargets,
    removeHistoryFeedbackSyncQueueTargetsForDelete,
    pruneHistoryFeedbackDeleteQueueForSyncQueue,
    serializeHistoryFeedbackDeleteQueue,
    serializeHistoryFeedbackSyncQueue,
    shouldFeedbackDeleteClearSync,
    shouldFeedbackSyncClearDelete,
    shouldReplaceHistoryFeedbackDeletePayload,
    upsertHistoryFeedbackDeleteQueue,
    upsertHistoryFeedbackSyncQueue
} from './history-feedback-sync';
import type { HistoryMetadata } from './history-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

function historyItem(overrides: Partial<HistoryMetadata> = {}): HistoryMetadata {
    return {
        timestamp: 0,
        images: [],
        durationMs: 0,
        quality: 'high',
        background: 'auto',
        moderation: 'auto',
        prompt: 'test prompt',
        mode: 'generate',
        costDetails: null,
        ...overrides
    };
}

function historyItems(items: Array<Partial<HistoryMetadata>>): HistoryMetadata[] {
    return items.map((item) => historyItem(item));
}

describe('buildHistoryFeedbackTargets', () => {
    it('deduplicates page request ids while preserving filenames when available', () => {
        const item = historyItem({
            clientRequestIds: ['web-a', 'web-b'],
            images: [
                { filename: 'a.png', clientRequestId: 'web-a' },
                { filename: 'c.png', clientRequestId: 'web-c' }
            ]
        });

        assert.deepEqual(buildHistoryFeedbackTargets(item), [
            { type: 'page_request', id: 'web-a', filename: 'a.png' },
            { type: 'page_request', id: 'web-b' },
            { type: 'page_request', id: 'web-c', filename: 'c.png' }
        ]);
    });

    it('normalizes target ids before building feedback targets', () => {
        const overlongId = 'x'.repeat(201);
        const item = historyItem({
            clientRequestIds: [' web-a ', '   ', overlongId],
            images: [
                { filename: 'a.png', clientRequestId: ' web-a ' },
                { filename: 'blank.png', clientRequestId: '   ' },
                { filename: 'long.png', clientRequestId: overlongId },
                { filename: 'b.png', clientRequestId: ' web-b ' }
            ]
        });

        assert.deepEqual(buildHistoryFeedbackTargets(item), [
            { type: 'page_request', id: 'web-a', filename: 'a.png' },
            { type: 'page_request', id: 'web-b', filename: 'b.png' }
        ]);
    });

    it('builds sync inputs for persisted feedback with request ids', () => {
        const history = historyItems([
            {
                timestamp: 1,
                clientRequestIds: ['web-old'],
                images: [],
                resultFeedback: { value: 'usable', updatedAt: 100, note: 'keep this' }
            },
            {
                timestamp: 2,
                images: [{ filename: 'missing-id.png' }],
                resultFeedback: { value: 'needs_revision', updatedAt: 200 }
            },
            {
                timestamp: 3,
                images: [{ filename: 'new.png', clientRequestId: 'web-new' }]
            }
        ]);

        const syncInputs = buildHistoryFeedbackSyncInputs(history);

        assert.equal(syncInputs.length, 1);
        assert.equal(syncInputs[0].item.timestamp, 1);
        assert.equal(syncInputs[0].value, 'usable');
        assert.equal(syncInputs[0].updatedAt, 100);
        assert.equal(syncInputs[0].note, 'keep this');
    });

    it('creates a stable sync key from target ids and feedback content', () => {
        const input = buildHistoryFeedbackSyncInputs(
            historyItems([
                {
                    timestamp: 10,
                    clientRequestIds: [' web-b ', 'web-a'],
                    images: [{ filename: 'a.png', clientRequestId: ' web-b ' }],
                    resultFeedback: { value: 'needs_revision', updatedAt: 123, note: ' revise ' }
                }
            ])
        )[0];

        assert.equal(buildHistoryFeedbackSyncKey(input), '10|web-a,web-b|needs_revision|123|revise');
    });

    it('builds serializable sync payloads without retaining full history entries', () => {
        const payloads = buildHistoryFeedbackSyncPayloads(
            historyItems([
                {
                    timestamp: 10,
                    clientRequestIds: ['web-a'],
                    images: [{ filename: 'a.png', clientRequestId: 'web-a' }],
                    resultFeedback: { value: 'usable', updatedAt: 123, note: ' ok ' }
                }
            ])
        );

        assert.deepEqual(payloads, [
            {
                key: '10|web-a|usable|123|ok',
                itemTimestamp: 10,
                targets: [{ type: 'page_request', id: 'web-a', filename: 'a.png' }],
                value: 'usable',
                updatedAt: 123,
                note: 'ok'
            }
        ]);
        assert.equal('item' in payloads[0], false);
    });

    it('does not build sync payloads from non-serializable feedback timestamps', () => {
        const history = historyItems([
            {
                timestamp: 10,
                clientRequestIds: ['web-a'],
                images: [],
                resultFeedback: { value: 'usable', updatedAt: 1e20 }
            }
        ]);

        assert.deepEqual(buildHistoryFeedbackSyncInputs(history), []);
        assert.equal(
            buildHistoryFeedbackSyncPayload({
                item: historyItem({
                    timestamp: 10,
                    clientRequestIds: ['web-a'],
                    images: []
                }),
                value: 'usable',
                updatedAt: 1e20
            }),
            undefined
        );
    });

    it('ignores malformed persisted sync queues', () => {
        assert.deepEqual(parseHistoryFeedbackSyncQueue('not-json'), []);
        assert.deepEqual(parseHistoryFeedbackSyncQueue(JSON.stringify([{ key: 'bad', targets: [] }])), []);
        assert.deepEqual(
            parseHistoryFeedbackSyncQueue(
                JSON.stringify([
                    {
                        key: 'bad-date',
                        targets: [{ type: 'page_request', id: 'web-a' }],
                        value: 'usable',
                        updatedAt: 1e20
                    }
                ])
            ),
            []
        );
        assert.deepEqual(
            parseHistoryFeedbackSyncQueue(
                JSON.stringify([
                    {
                        key: 'mixed-targets',
                        targets: [
                            { type: 'page_request', id: '   ' },
                            { type: 'page_request', id: ' web-a ', filename: 'a.png' },
                            { type: 'page_request', id: 'x'.repeat(201), filename: 'long.png' }
                        ],
                        value: 'usable',
                        updatedAt: 100
                    }
                ])
            ),
            [
                {
                    key: 'mixed-targets',
                    targets: [{ type: 'page_request', id: 'web-a', filename: 'a.png' }],
                    value: 'usable',
                    updatedAt: 100
                }
            ]
        );
    });

    it('normalizes persisted sync queues through current non-downgrade rules', () => {
        const newer = {
            key: 'sync-new',
            targets: [
                { type: 'page_request' as const, id: 'web-a' },
                { type: 'page_request' as const, id: 'web-a', filename: 'a.png' }
            ],
            value: 'needs_revision' as const,
            updatedAt: 300
        };
        const older = {
            key: 'sync-old',
            targets: [{ type: 'page_request' as const, id: 'web-a' }],
            value: 'usable' as const,
            updatedAt: 200
        };

        assert.deepEqual(parseHistoryFeedbackSyncQueue(JSON.stringify([newer, older])), [
            {
                key: 'sync-new',
                targets: [{ type: 'page_request', id: 'web-a', filename: 'a.png' }],
                value: 'needs_revision',
                updatedAt: 300
            }
        ]);
    });

    it('serializes, parses, upserts, and removes persisted sync queue entries', () => {
        const older = buildHistoryFeedbackSyncPayload(
            buildHistoryFeedbackSyncInputs(
                historyItems([
                    {
                        timestamp: 1,
                        clientRequestIds: ['web-a'],
                        images: [],
                        resultFeedback: { value: 'usable', updatedAt: 100 }
                    }
                ])
            )[0]
        );
        const newer = buildHistoryFeedbackSyncPayload(
            buildHistoryFeedbackSyncInputs(
                historyItems([
                    {
                        timestamp: 1,
                        clientRequestIds: ['web-a'],
                        images: [],
                        resultFeedback: { value: 'needs_revision', updatedAt: 200, note: 'fix' }
                    }
                ])
            )[0]
        );
        const other = buildHistoryFeedbackSyncPayload(
            buildHistoryFeedbackSyncInputs(
                historyItems([
                    {
                        timestamp: 2,
                        clientRequestIds: ['web-b'],
                        images: [],
                        resultFeedback: { value: 'usable', updatedAt: 150 }
                    }
                ])
            )[0]
        );
        assert.ok(older);
        assert.ok(newer);
        assert.ok(other);

        const queue = upsertHistoryFeedbackSyncQueue(upsertHistoryFeedbackSyncQueue([older], newer), other);
        assert.deepEqual(
            queue.map((item) => item.key),
            [newer.key, other.key]
        );

        const parsed = parseHistoryFeedbackSyncQueue(serializeHistoryFeedbackSyncQueue(queue));
        assert.deepEqual(parsed, queue);
        assert.deepEqual(removeHistoryFeedbackSyncQueueItem(parsed, newer.key), [other]);
        assert.deepEqual(removeHistoryFeedbackSyncQueueTargets(parsed, [{ type: 'page_request', id: ' web-b ' }]), [
            newer
        ]);
    });

    it('keeps remaining sync targets when only one target is removed', () => {
        const payload = buildHistoryFeedbackSyncPayload(
            buildHistoryFeedbackSyncInputs(
                historyItems([
                    {
                        timestamp: 10,
                        clientRequestIds: ['web-a', 'web-b'],
                        images: [],
                        resultFeedback: { value: 'usable', updatedAt: 100 }
                    }
                ])
            )[0]
        );
        assert.ok(payload);

        const remaining = removeHistoryFeedbackSyncQueueTargets([payload], [{ type: 'page_request', id: 'web-a' }]);

        assert.deepEqual(remaining, [
            {
                ...payload,
                key: '10|web-b|usable|100|',
                targets: [{ type: 'page_request', id: 'web-b' }]
            }
        ]);
    });

    it('does not downgrade queued sync payloads with older feedback timestamps', () => {
        const newer = {
            key: 'sync-new',
            targets: [{ type: 'page_request' as const, id: 'web-a' }],
            value: 'needs_revision' as const,
            updatedAt: 300
        };
        const older = {
            key: 'sync-old',
            targets: [{ type: 'page_request' as const, id: 'web-a' }],
            value: 'usable' as const,
            updatedAt: 200
        };
        const sameTimestamp = {
            key: 'sync-same-time',
            targets: [{ type: 'page_request' as const, id: 'web-a' }],
            value: 'usable' as const,
            updatedAt: 300
        };

        assert.deepEqual(upsertHistoryFeedbackSyncQueue([newer], older), [newer]);
        assert.deepEqual(upsertHistoryFeedbackSyncQueue([newer], sameTimestamp), [newer]);
    });

    it('replaces older queued sync payloads with newer feedback timestamps', () => {
        const older = {
            key: 'sync-old',
            targets: [{ type: 'page_request' as const, id: 'web-a' }],
            value: 'usable' as const,
            updatedAt: 200
        };
        const newer = {
            key: 'sync-new',
            targets: [{ type: 'page_request' as const, id: 'web-a' }],
            value: 'needs_revision' as const,
            updatedAt: 300
        };

        assert.deepEqual(upsertHistoryFeedbackSyncQueue([older], newer), [newer]);
    });

    it('caps persisted sync queue length', () => {
        const queue = Array.from({ length: 3 }, (_, index) => ({
            key: `key-${index}`,
            targets: [{ type: 'page_request' as const, id: `web-${index}` }],
            value: 'usable' as const,
            updatedAt: index
        })).reduce<ReturnType<typeof upsertHistoryFeedbackSyncQueue>>(
            (current, payload) => upsertHistoryFeedbackSyncQueue(current, payload, 2),
            []
        );

        assert.deepEqual(
            queue.map((item) => item.key),
            ['key-1', 'key-2']
        );
    });

    it('deduplicates delete targets across history entries', () => {
        const history = historyItems([
            {
                clientRequestIds: ['web-a'],
                images: [{ filename: 'a.png', clientRequestId: 'web-a' }]
            },
            {
                clientRequestIds: ['web-a', 'web-b'],
                images: [{ filename: 'b.png', clientRequestId: 'web-b' }]
            }
        ]);

        assert.deepEqual(buildHistoryFeedbackDeleteTargets(history), [
            { type: 'page_request', id: 'web-a', filename: 'a.png' },
            { type: 'page_request', id: 'web-b', filename: 'b.png' }
        ]);
    });

    it('creates a stable delete key from deduplicated targets', () => {
        assert.equal(
            buildHistoryFeedbackDeleteKey([
                { type: 'page_request', id: ' web-b ' },
                { type: 'page_request', id: 'web-a', filename: 'a.png' },
                { type: 'page_request', id: 'web-a' }
            ]),
            '["web-a","web-b"]'
        );
    });

    it('does not build delete payloads from non-serializable delete timestamps', () => {
        assert.equal(buildHistoryFeedbackDeletePayload([{ type: 'page_request', id: 'web-a' }], 1e20), undefined);
    });

    it('serializes, parses, upserts, and removes persisted delete queue targets', () => {
        const initialPayload = buildHistoryFeedbackDeletePayload(
            [{ type: 'page_request', id: 'web-a', filename: 'old-a.png' }],
            100
        );
        const nextPayload = buildHistoryFeedbackDeletePayload(
            [
                { type: 'page_request', id: 'web-a' },
                { type: 'page_request', id: 'web-b', filename: 'b.png' }
            ],
            200
        );
        assert.ok(initialPayload);
        assert.ok(nextPayload);

        const queue = upsertHistoryFeedbackDeleteQueue([initialPayload], nextPayload);

        assert.deepEqual(queue, [
            {
                key: '["web-a","web-b"]',
                targets: [
                    { type: 'page_request', id: 'web-a' },
                    { type: 'page_request', id: 'web-b', filename: 'b.png' }
                ],
                deletedAt: 200
            }
        ]);
        assert.deepEqual(parseHistoryFeedbackDeleteQueue(serializeHistoryFeedbackDeleteQueue(queue)), queue);
        assert.deepEqual(removeHistoryFeedbackDeleteQueueTargets(queue, [{ type: 'page_request', id: ' web-a ' }]), [
            {
                key: '["web-b"]',
                targets: [{ type: 'page_request', id: 'web-b', filename: 'b.png' }],
                deletedAt: 200
            }
        ]);
    });

    it('removes only the completed delete payload from persisted delete queues', () => {
        const completed = buildHistoryFeedbackDeletePayload(
            [
                { type: 'page_request' as const, id: 'web-a' },
                { type: 'page_request' as const, id: 'web-b' }
            ],
            100
        );
        const newer = buildHistoryFeedbackDeletePayload([{ type: 'page_request' as const, id: 'web-a' }], 200);
        assert.ok(completed);
        assert.ok(newer);

        assert.deepEqual(removeHistoryFeedbackDeleteQueuePayload([completed, newer], completed), [
            { key: '["web-a"]', targets: [{ type: 'page_request', id: 'web-a' }], deletedAt: 200 }
        ]);
        assert.deepEqual(
            removeHistoryFeedbackDeleteQueuePayload([completed, newer], {
                key: '["web-a"]',
                targets: [{ type: 'page_request', id: 'web-a' }],
                deletedAt: 100
            }),
            [
                { key: '["web-b"]', targets: [{ type: 'page_request', id: 'web-b' }], deletedAt: 100 },
                { key: '["web-a"]', targets: [{ type: 'page_request', id: 'web-a' }], deletedAt: 200 }
            ]
        );
    });

    it('ignores malformed persisted delete queues and caps queue length', () => {
        assert.deepEqual(parseHistoryFeedbackDeleteQueue('not-json'), []);
        assert.deepEqual(parseHistoryFeedbackDeleteQueue(JSON.stringify([{ type: 'agent_request', id: 'bad' }])), []);
        assert.deepEqual(
            parseHistoryFeedbackDeleteQueue(
                JSON.stringify([
                    {
                        targets: [{ type: 'page_request', id: 'web-a' }],
                        deletedAt: 1e20
                    }
                ])
            ),
            []
        );
        assert.deepEqual(
            parseHistoryFeedbackDeleteQueue(
                JSON.stringify([
                    {
                        targets: [
                            { type: 'page_request', id: '   ' },
                            { type: 'page_request', id: ' web-a ', filename: 'a.png' },
                            { type: 'page_request', id: 'x'.repeat(201), filename: 'long.png' }
                        ],
                        deletedAt: 100
                    }
                ])
            ),
            [
                {
                    key: '["web-a"]',
                    targets: [{ type: 'page_request', id: 'web-a', filename: 'a.png' }],
                    deletedAt: 100
                }
            ]
        );

        const queue = Array.from({ length: 3 }, (_, index) => {
            const payload = buildHistoryFeedbackDeletePayload(
                [{ type: 'page_request' as const, id: `web-${index}` }],
                index
            );
            if (!payload) throw new Error('expected delete payload');
            return payload;
        }).reduce<ReturnType<typeof upsertHistoryFeedbackDeleteQueue>>(
            (current, payload) => upsertHistoryFeedbackDeleteQueue(current, payload, 2),
            []
        );

        assert.deepEqual(queue, [
            { key: '["web-1"]', targets: [{ type: 'page_request', id: 'web-1' }], deletedAt: 1 },
            { key: '["web-2"]', targets: [{ type: 'page_request', id: 'web-2' }], deletedAt: 2 }
        ]);
    });

    it('does not downgrade queued delete payloads with older delete timestamps', () => {
        const newer = buildHistoryFeedbackDeletePayload(
            [
                { type: 'page_request' as const, id: 'web-a', filename: 'a.png' },
                { type: 'page_request' as const, id: 'web-b', filename: 'b.png' }
            ],
            300
        );
        const older = buildHistoryFeedbackDeletePayload(
            [
                { type: 'page_request' as const, id: 'web-a' },
                { type: 'page_request' as const, id: 'web-c', filename: 'c.png' }
            ],
            200
        );
        assert.ok(newer);
        assert.ok(older);

        assert.deepEqual(upsertHistoryFeedbackDeleteQueue([newer], older), [
            newer,
            {
                key: '["web-c"]',
                targets: [{ type: 'page_request', id: 'web-c', filename: 'c.png' }],
                deletedAt: 200
            }
        ]);
    });

    it('replaces queued delete payloads only when the incoming delete timestamp is newer', () => {
        const existing = buildHistoryFeedbackDeletePayload([{ type: 'page_request' as const, id: 'web-a' }], 100);
        const older = buildHistoryFeedbackDeletePayload([{ type: 'page_request' as const, id: 'web-a' }], 50);
        const newer = buildHistoryFeedbackDeletePayload([{ type: 'page_request' as const, id: 'web-a' }], 200);
        const unbounded = buildHistoryFeedbackDeletePayload([{ type: 'page_request' as const, id: 'web-a' }]);
        assert.ok(existing);
        assert.ok(older);
        assert.ok(newer);
        assert.ok(unbounded);

        assert.equal(shouldReplaceHistoryFeedbackDeletePayload(existing, older), false);
        assert.equal(shouldReplaceHistoryFeedbackDeletePayload(existing, unbounded), false);
        assert.equal(shouldReplaceHistoryFeedbackDeletePayload(existing, newer), true);
        assert.equal(shouldReplaceHistoryFeedbackDeletePayload(unbounded, existing), true);
    });

    it('parses legacy persisted delete target arrays as unbounded delete payloads', () => {
        assert.deepEqual(
            parseHistoryFeedbackDeleteQueue(
                JSON.stringify([
                    { type: 'page_request', id: 'web-a' },
                    { type: 'page_request', id: 'web-a', filename: 'a.png' }
                ])
            ),
            [{ key: '["web-a"]', targets: [{ type: 'page_request', id: 'web-a', filename: 'a.png' }] }]
        );
    });

    it('keeps timestamped delete payloads when persisted queues mix legacy and current formats', () => {
        assert.deepEqual(
            parseHistoryFeedbackDeleteQueue(
                JSON.stringify([
                    { type: 'page_request', id: 'web-a' },
                    {
                        key: 'old-key-is-rebuilt',
                        targets: [{ type: 'page_request', id: 'web-a', filename: 'a.png' }],
                        deletedAt: 300
                    }
                ])
            ),
            [
                {
                    key: '["web-a"]',
                    targets: [{ type: 'page_request', id: 'web-a', filename: 'a.png' }],
                    deletedAt: 300
                }
            ]
        );
    });

    it('prunes persisted delete targets that have pending feedback syncs', () => {
        const deleteQueue = [
            buildHistoryFeedbackDeletePayload([{ type: 'page_request' as const, id: 'web-a' }], 50),
            buildHistoryFeedbackDeletePayload([{ type: 'page_request' as const, id: 'web-b' }], 100),
            buildHistoryFeedbackDeletePayload([{ type: 'page_request' as const, id: 'web-c' }], 100)
        ].filter((payload): payload is NonNullable<typeof payload> => payload !== undefined);
        const syncQueue = [
            {
                key: 'sync-a',
                targets: [{ type: 'page_request' as const, id: 'web-a' }],
                value: 'usable' as const,
                updatedAt: 100
            },
            {
                key: 'sync-c',
                targets: [{ type: 'page_request' as const, id: 'web-c' }],
                value: 'needs_revision' as const,
                updatedAt: 200
            }
        ];

        assert.deepEqual(pruneHistoryFeedbackDeleteQueueForSyncQueue(deleteQueue, syncQueue), [
            { key: '["web-b"]', targets: [{ type: 'page_request', id: 'web-b' }], deletedAt: 100 }
        ]);
    });

    it('keeps newer sync payloads when pruning sync queues for stale deletes', () => {
        const olderSync = {
            key: 'sync-old',
            targets: [{ type: 'page_request' as const, id: 'web-a' }],
            value: 'usable' as const,
            updatedAt: 100
        };
        const newerSync = {
            key: 'sync-new',
            targets: [{ type: 'page_request' as const, id: 'web-b' }],
            value: 'needs_revision' as const,
            updatedAt: 300
        };
        const deletePayload = buildHistoryFeedbackDeletePayload(
            [
                { type: 'page_request' as const, id: 'web-a' },
                { type: 'page_request' as const, id: 'web-b' }
            ],
            200
        );
        assert.ok(deletePayload);

        assert.equal(shouldFeedbackDeleteClearSync(deletePayload, olderSync), true);
        assert.equal(shouldFeedbackDeleteClearSync(deletePayload, newerSync), false);
        assert.deepEqual(removeHistoryFeedbackSyncQueueTargetsForDelete([olderSync, newerSync], deletePayload), [
            newerSync
        ]);
    });

    it('treats legacy unbounded deletes as clearing overlapping sync payloads', () => {
        const syncPayload = {
            key: 'sync-new',
            targets: [{ type: 'page_request' as const, id: 'web-a' }],
            value: 'usable' as const,
            updatedAt: 300
        };
        const deletePayload = buildHistoryFeedbackDeletePayload([{ type: 'page_request' as const, id: 'web-a' }]);
        assert.ok(deletePayload);

        assert.equal(shouldFeedbackDeleteClearSync(deletePayload, syncPayload), true);
        assert.deepEqual(removeHistoryFeedbackSyncQueueTargetsForDelete([syncPayload], deletePayload), []);
    });

    it('keeps legacy unbounded deletes when pruning deletes against sync queues', () => {
        const syncPayload = {
            key: 'sync-new',
            targets: [{ type: 'page_request' as const, id: 'web-a' }],
            value: 'usable' as const,
            updatedAt: 300
        };
        const deletePayload = buildHistoryFeedbackDeletePayload([{ type: 'page_request' as const, id: 'web-a' }]);
        assert.ok(deletePayload);

        assert.equal(shouldFeedbackSyncClearDelete(syncPayload, deletePayload), false);
        assert.deepEqual(pruneHistoryFeedbackDeleteQueueForSyncQueue([deletePayload], [syncPayload]), [deletePayload]);
    });

    it('lets deletes win when feedback sync and delete timestamps are equal', () => {
        const syncPayload = {
            key: 'sync-equal',
            targets: [{ type: 'page_request' as const, id: 'web-a' }],
            value: 'usable' as const,
            updatedAt: 200
        };
        const deletePayload = buildHistoryFeedbackDeletePayload([{ type: 'page_request' as const, id: 'web-a' }], 200);
        assert.ok(deletePayload);

        assert.equal(shouldFeedbackDeleteClearSync(deletePayload, syncPayload), true);
        assert.equal(shouldFeedbackSyncClearDelete(syncPayload, deletePayload), false);
        assert.deepEqual(removeHistoryFeedbackSyncQueueTargetsForDelete([syncPayload], deletePayload), []);
        assert.deepEqual(pruneHistoryFeedbackDeleteQueueForSyncQueue([deletePayload], [syncPayload]), [deletePayload]);
    });

    it('keeps newer delete payloads when pruning deletes against older sync queues', () => {
        const oldDelete = buildHistoryFeedbackDeletePayload([{ type: 'page_request' as const, id: 'web-a' }], 100);
        const newDelete = buildHistoryFeedbackDeletePayload([{ type: 'page_request' as const, id: 'web-b' }], 300);
        const oldSync = {
            key: 'sync-old',
            targets: [
                { type: 'page_request' as const, id: 'web-a' },
                { type: 'page_request' as const, id: 'web-b' }
            ],
            value: 'usable' as const,
            updatedAt: 200
        };
        assert.ok(oldDelete);
        assert.ok(newDelete);

        assert.equal(shouldFeedbackSyncClearDelete(oldSync, oldDelete), true);
        assert.equal(shouldFeedbackSyncClearDelete(oldSync, newDelete), false);
        assert.deepEqual(pruneHistoryFeedbackDeleteQueueForSyncQueue([oldDelete, newDelete], [oldSync]), [newDelete]);
    });
});

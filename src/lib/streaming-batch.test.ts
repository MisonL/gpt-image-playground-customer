import {
    applyStreamingClientEvent,
    BatchPausedError,
    buildStreamingBatchJobs,
    computeStreamingConcurrency,
    computeStreamingBatchRecommendation,
    canUseStreamingBatchTransport,
    resolveStreamingBatchCapacity,
    resolveStreamingBatchToggleState,
    scheduleStreamingBatch,
    shouldUseStreamingBatch
} from './streaming-batch';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('computeStreamingConcurrency', () => {
    it('defaults to one stream per credential without hardcoding the current key count', () => {
        assert.equal(computeStreamingConcurrency({ credentialCount: 5 }), 5);
    });

    it('uses an explicit per-credential budget when configured', () => {
        assert.equal(
            computeStreamingConcurrency({
                credentialCount: 4,
                maxStreamsPerCredential: 2
            }),
            8
        );
    });

    it('never returns less than one usable slot', () => {
        assert.equal(computeStreamingConcurrency({ credentialCount: 0 }), 1);
    });
});

describe('computeStreamingBatchRecommendation', () => {
    it('limits sticky routing to one credential capacity for a single affinity key', () => {
        assert.equal(
            computeStreamingBatchRecommendation({
                credentialCount: 5,
                maxStreamsPerCredential: 2,
                strategy: 'sticky'
            }),
            2
        );
    });

    it('uses the full credential pool when routing distributes requests', () => {
        assert.equal(
            computeStreamingBatchRecommendation({
                credentialCount: 5,
                maxStreamsPerCredential: 2,
                strategy: 'round_robin'
            }),
            10
        );
    });

    it('does not multiply sticky routing capacity by channel count', () => {
        assert.equal(
            computeStreamingBatchRecommendation({
                credentialCount: 5,
                maxStreamsPerCredential: 2,
                strategy: 'sticky'
            }),
            2
        );
    });

    it('returns zero when no healthy credentials are available', () => {
        assert.equal(
            computeStreamingBatchRecommendation({
                credentialCount: 0,
                maxStreamsPerCredential: 2,
                strategy: 'round_robin'
            }),
            0
        );
    });
});

describe('shouldUseStreamingBatch', () => {
    it('requires explicit user enablement so existing behavior remains sequential', () => {
        assert.equal(
            shouldUseStreamingBatch({
                enabled: true,
                userEnabled: false,
                streaming: true,
                imageCount: 3
            }),
            false
        );
    });

    it('enables fanout only for streaming batches larger than one image', () => {
        assert.equal(
            shouldUseStreamingBatch({
                enabled: true,
                userEnabled: true,
                streaming: true,
                imageCount: 3
            }),
            true
        );
        assert.equal(
            shouldUseStreamingBatch({
                enabled: true,
                userEnabled: true,
                streaming: false,
                imageCount: 3
            }),
            false
        );
        assert.equal(
            shouldUseStreamingBatch({
                enabled: true,
                userEnabled: true,
                streaming: true,
                imageCount: 1
            }),
            false
        );
    });
});

describe('canUseStreamingBatchTransport', () => {
    it('requires both a streaming request mode and a streaming strategy that is not off', () => {
        assert.equal(
            canUseStreamingBatchTransport({
                streamMode: 'auto',
                streamingStrategy: 'auto'
            }),
            true
        );
        assert.equal(
            canUseStreamingBatchTransport({
                streamMode: 'non_stream',
                streamingStrategy: 'auto'
            }),
            false
        );
        assert.equal(
            canUseStreamingBatchTransport({
                streamMode: 'auto',
                streamingStrategy: 'off'
            }),
            false
        );
    });
});

describe('resolveStreamingBatchToggleState', () => {
    it('enables the checkbox only when capacity, streaming transport, and multiple targets are present', () => {
        assert.deepEqual(
            resolveStreamingBatchToggleState({
                allowStreamingBatch: true,
                userEnabled: true,
                targetCount: 2,
                streamMode: 'auto',
                streamingStrategy: 'auto'
            }),
            {
                canEnable: true,
                checked: true,
                transportEnabled: true,
                unavailableReasonKey: 'streaming.parallelBatchUnavailableSingle'
            }
        );
    });

    it('keeps the checkbox unchecked when the user has not explicitly enabled parallel batch', () => {
        assert.deepEqual(
            resolveStreamingBatchToggleState({
                allowStreamingBatch: true,
                userEnabled: false,
                targetCount: 2,
                streamMode: 'stream',
                streamingStrategy: 'auto'
            }),
            {
                canEnable: true,
                checked: false,
                transportEnabled: true,
                unavailableReasonKey: 'streaming.parallelBatchUnavailableSingle'
            }
        );
    });

    it('reports the right unavailable reason for capacity, transport, and single-target limits', () => {
        assert.equal(
            resolveStreamingBatchToggleState({
                allowStreamingBatch: false,
                userEnabled: true,
                targetCount: 2,
                streamMode: 'auto',
                streamingStrategy: 'auto'
            }).unavailableReasonKey,
            'streaming.parallelBatchUnavailableCapacity'
        );
        assert.equal(
            resolveStreamingBatchToggleState({
                allowStreamingBatch: true,
                userEnabled: true,
                targetCount: 2,
                streamMode: 'non_stream',
                streamingStrategy: 'auto'
            }).unavailableReasonKey,
            'streaming.parallelBatchUnavailable'
        );
        assert.equal(
            resolveStreamingBatchToggleState({
                allowStreamingBatch: true,
                userEnabled: true,
                targetCount: 1,
                streamMode: 'auto',
                streamingStrategy: 'auto'
            }).unavailableReasonKey,
            'streaming.parallelBatchUnavailableSingle'
        );
    });
});

describe('resolveStreamingBatchCapacity', () => {
    it('keeps batch streaming disabled when runtime capacity is unavailable', () => {
        assert.deepEqual(
            resolveStreamingBatchCapacity({
                featureEnabled: false,
                hasRequestApiKey: true,
                requestCredentialConcurrency: 2,
                serverRecommendedConcurrency: 3
            }),
            {
                enabled: false,
                concurrency: 1
            }
        );
    });

    it('uses request credential capacity when the user provides an API key', () => {
        assert.deepEqual(
            resolveStreamingBatchCapacity({
                featureEnabled: true,
                hasRequestApiKey: true,
                requestCredentialConcurrency: 2,
                serverRecommendedConcurrency: 0
            }),
            {
                enabled: true,
                concurrency: 2
            }
        );
    });

    it('uses healthy server capacity when the request relies on the server pool', () => {
        assert.deepEqual(
            resolveStreamingBatchCapacity({
                featureEnabled: true,
                hasRequestApiKey: false,
                requestCredentialConcurrency: 2,
                serverRecommendedConcurrency: 3
            }),
            {
                enabled: true,
                concurrency: 3
            }
        );
    });

    it('disables batch streaming when no credential source has capacity', () => {
        assert.deepEqual(
            resolveStreamingBatchCapacity({
                featureEnabled: true,
                hasRequestApiKey: false,
                requestCredentialConcurrency: 2,
                serverRecommendedConcurrency: 0
            }),
            {
                enabled: false,
                concurrency: 1
            }
        );
    });
});

describe('applyStreamingClientEvent', () => {
    it('keeps completed images even when the final done event omits images', () => {
        const withCompleted = applyStreamingClientEvent(
            { completedImages: [] },
            {
                type: 'completed',
                filename: 'image-1.png',
                b64_json: 'base64',
                output_format: 'png',
                path: '/api/image/image-1.png'
            }
        );

        const withDone = applyStreamingClientEvent(withCompleted, {
            type: 'done',
            images: [],
            usage: {
                output_tokens: 1
            }
        });

        assert.deepEqual(withDone.completedImages, [
            {
                filename: 'image-1.png',
                b64_json: 'base64',
                output_format: 'png',
                path: '/api/image/image-1.png'
            }
        ]);
        assert.deepEqual(withDone.usage, { output_tokens: 1 });
    });

    it('attaches request ids from streaming events to completed images', () => {
        const withCompleted = applyStreamingClientEvent(
            { completedImages: [] },
            {
                type: 'completed',
                filename: 'image-1.png',
                b64_json: 'base64',
                output_format: 'png',
                path: '/api/image/image-1.png',
                client_request_id: 'web-request-1'
            }
        );

        assert.deepEqual(withCompleted.completedImages, [
            {
                filename: 'image-1.png',
                b64_json: 'base64',
                output_format: 'png',
                path: '/api/image/image-1.png',
                clientRequestId: 'web-request-1'
            }
        ]);
    });

    it('accepts camelCase aliases from streaming events', () => {
        const withCompleted = applyStreamingClientEvent(
            { completedImages: [] },
            {
                type: 'completed',
                filename: 'image-1.png',
                b64_json: 'base64',
                outputFormat: 'png',
                path: '/api/image/image-1.png',
                clientRequestId: 'web-request-camel'
            }
        );

        const withDone = applyStreamingClientEvent(withCompleted, {
            type: 'done',
            clientRequestId: 'web-request-camel',
            actualCost: {
                currency: 'usd-equivalent',
                confidence: 'high',
                source: 'new-api-log-token',
                actualAmount: 0.0075,
                upstreamProvider: 'new-api'
            }
        });

        assert.deepEqual(withDone.completedImages, [
            {
                filename: 'image-1.png',
                b64_json: 'base64',
                output_format: 'png',
                path: '/api/image/image-1.png',
                clientRequestId: 'web-request-camel'
            }
        ]);
        assert.equal(withDone.actualCost?.actualAmount, 0.0075);
    });

    it('fills missing image request ids from the final done event', () => {
        const withDone = applyStreamingClientEvent(
            {
                completedImages: [
                    {
                        filename: 'image-1.png',
                        b64_json: 'base64',
                        output_format: 'png',
                        path: '/api/image/image-1.png'
                    }
                ]
            },
            {
                type: 'done',
                usage: { output_tokens: 1 },
                client_request_id: 'web-request-2'
            }
        );

        assert.deepEqual(withDone.completedImages, [
            {
                filename: 'image-1.png',
                b64_json: 'base64',
                output_format: 'png',
                path: '/api/image/image-1.png',
                clientRequestId: 'web-request-2'
            }
        ]);
    });

    it('keeps actual cost details from the final done event', () => {
        const withDone = applyStreamingClientEvent(
            { completedImages: [] },
            {
                type: 'done',
                images: [],
                actual_cost: {
                    currency: 'usd-equivalent',
                    confidence: 'high',
                    source: 'new-api-log-token',
                    actualAmount: 0.0075,
                    upstreamProvider: 'new-api'
                }
            }
        );

        assert.deepEqual(withDone.actualCost, {
            currency: 'usd-equivalent',
            confidence: 'high',
            source: 'new-api-log-token',
            actualAmount: 0.0075,
            upstreamProvider: 'new-api'
        });
    });

    it('rejects completed events that omit output format', () => {
        const initial = {
            completedImages: []
        };

        assert.throws(
            () =>
                applyStreamingClientEvent(initial, {
                    type: 'completed',
                    filename: 'image-1.png'
                }),
            /output_format/
        );
    });

    it('rejects malformed actual cost details from the final done event', () => {
        assert.throws(
            () =>
                applyStreamingClientEvent(
                    { completedImages: [] },
                    {
                        type: 'done',
                        actual_cost: { source: 'new-api-log-token' } as never
                    }
                ),
            /actual_cost/
        );
    });
});

describe('buildStreamingBatchJobs', () => {
    it('splits a multi-image streaming batch into single-image jobs', () => {
        assert.deepEqual(buildStreamingBatchJobs(3), [
            { id: 'job-0', outputIndex: 0 },
            { id: 'job-1', outputIndex: 1 },
            { id: 'job-2', outputIndex: 2 }
        ]);
    });
});

describe('scheduleStreamingBatch', () => {
    it('respects the concurrency window while preserving output order', async () => {
        const running: string[] = [];
        const maxRunningSnapshots: number[] = [];

        const results = await scheduleStreamingBatch(buildStreamingBatchJobs(5), {
            concurrency: 2,
            runJob: async (job) => {
                running.push(job.id);
                maxRunningSnapshots.push(running.length);
                await Promise.resolve();
                running.splice(running.indexOf(job.id), 1);
                return `result-${job.outputIndex}`;
            }
        });

        assert.deepEqual(results, ['result-0', 'result-1', 'result-2', 'result-3', 'result-4']);
        assert.equal(Math.max(...maxRunningSnapshots), 2);
    });

    it('keeps successful jobs when one job fails', async () => {
        const results = await scheduleStreamingBatch(buildStreamingBatchJobs(3), {
            concurrency: 2,
            runJob: async (job) => {
                if (job.outputIndex === 1) {
                    throw new Error('upstream failed');
                }
                return `result-${job.outputIndex}`;
            }
        });

        assert.equal(results[0], 'result-0');
        assert.equal(results[2], 'result-2');
        assert.ok(results[1] instanceof Error);
        assert.equal((results[1] as Error).message, 'upstream failed');
    });

    it('stops assigning new jobs after a pause request', async () => {
        let started = 0;
        const results = await scheduleStreamingBatch(buildStreamingBatchJobs(4), {
            concurrency: 1,
            runJob: async (job) => {
                started += 1;
                return `result-${job.outputIndex}`;
            },
            shouldPause: () => started >= 2
        });

        assert.deepEqual(results.slice(0, 2), ['result-0', 'result-1']);
        assert.ok(results[2] instanceof BatchPausedError);
        assert.ok(results[3] instanceof BatchPausedError);
        assert.equal((results[2] as Error).message, '批量生成已暂停，任务尚未开始。');
        assert.equal(started, 2);
    });
});

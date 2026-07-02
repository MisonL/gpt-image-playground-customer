import type { ImageGenerationBackend, ImageStreamingStrategy } from './image-upstream-strategy';

export type StreamingOperation = 'generate' | 'edit';

export type StreamingAvailabilityKey = {
    channelId?: string;
    sourceId?: string;
    imageBackend: ImageGenerationBackend;
    streamingStrategy: ImageStreamingStrategy;
    operation: StreamingOperation;
};

export type StreamingAvailabilityMark = StreamingAvailabilityKey & {
    date: string;
    at: number;
    reason: string;
    status?: number;
    code?: string;
};

export type StreamingAvailabilitySummary = {
    reset_date: string;
    mark_count: number;
    active_marks: Array<{
        channel_id: string;
        source_id?: string;
        image_backend: ImageGenerationBackend;
        streaming_strategy: ImageStreamingStrategy;
        operation: StreamingOperation;
        reason: string;
        at: number;
        status?: number;
        code?: string;
    }>;
};

type RegistryOptions = {
    now?: () => Date;
};

const FALLBACK_CHANNEL_ID = 'request-override';

export function createStreamingAvailabilityRegistry(options: RegistryOptions = {}) {
    const now = options.now || (() => new Date());
    let currentDate = readLocalDate(now());
    const marks = new Map<string, StreamingAvailabilityMark>();

    function resetIfNewDay() {
        const nextDate = readLocalDate(now());
        if (nextDate === currentDate) return;
        currentDate = nextDate;
        marks.clear();
    }

    function buildMarkKey(input: StreamingAvailabilityKey): string {
        return [
            input.channelId || input.sourceId || FALLBACK_CHANNEL_ID,
            input.imageBackend,
            input.streamingStrategy,
            input.operation
        ].join('|');
    }

    return {
        isUnavailable(input: StreamingAvailabilityKey): boolean {
            resetIfNewDay();
            return marks.has(buildMarkKey(input));
        },
        markUnavailable(
            input: StreamingAvailabilityKey & { reason: string; status?: number; code?: string }
        ): StreamingAvailabilityMark {
            resetIfNewDay();
            const mark: StreamingAvailabilityMark = {
                channelId: input.channelId,
                sourceId: input.sourceId,
                imageBackend: input.imageBackend,
                streamingStrategy: input.streamingStrategy,
                operation: input.operation,
                date: currentDate,
                at: now().getTime(),
                reason: input.reason,
                ...(input.status !== undefined ? { status: input.status } : {}),
                ...(input.code !== undefined ? { code: input.code } : {})
            };
            marks.set(buildMarkKey(input), mark);
            return mark;
        },
        summary(): StreamingAvailabilitySummary {
            resetIfNewDay();
            return {
                reset_date: currentDate,
                mark_count: marks.size,
                active_marks: Array.from(marks.values()).map((mark) => ({
                    channel_id: mark.channelId || FALLBACK_CHANNEL_ID,
                    ...(mark.sourceId ? { source_id: mark.sourceId } : {}),
                    image_backend: mark.imageBackend,
                    streaming_strategy: mark.streamingStrategy,
                    operation: mark.operation,
                    reason: mark.reason,
                    at: mark.at,
                    ...(mark.status !== undefined ? { status: mark.status } : {}),
                    ...(mark.code !== undefined ? { code: mark.code } : {})
                }))
            };
        }
    };
}

function readLocalDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

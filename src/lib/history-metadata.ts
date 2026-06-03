import { formatBatchPromptHistory, readBatchPromptLines } from './batch-prompts';
import { calculateApiCost, type CostDetails, type GptImageModel } from './cost-utils';
import type { EditingFormData } from '@/components/editing-form';
import type { GenerationFormData } from '@/components/generation-form';
import { getPresetDimensions } from './size-utils';
import type { ApiImageResponseItem } from './streaming-batch';
import type { ActualCostDetails } from './upstream-cost/resolve';

export type HistoryImage = {
    filename: string;
    clientRequestId?: string;
};

export type HistoryMetadata = {
    timestamp: number;
    images: HistoryImage[];
    status?: 'completed' | 'failed';
    failureMessage?: string;
    storageModeUsed?: 'fs' | 'indexeddb';
    durationMs: number;
    quality: GenerationFormData['quality'];
    background: GenerationFormData['background'];
    moderation: GenerationFormData['moderation'];
    prompt: string;
    mode: 'generate' | 'edit';
    costDetails: CostDetails | null;
    actualCostDetails?: ActualCostDetails;
    output_format?: GenerationFormData['output_format'];
    model?: GptImageModel;
    size?: string;
    image_backend?: GenerationFormData['image_backend'];
    streaming_strategy?: GenerationFormData['streaming_strategy'];
    responsesModel?: string;
    thinking?: GenerationFormData['thinking'];
    promptOptimization?: GenerationFormData['promptOptimization'];
    forceWeb?: boolean;
    enableParallelBatch?: boolean;
    clientRequestIds?: string[];
};

export type RequestMode = HistoryMetadata['mode'];

export function uniqueStrings(values: Array<string | undefined>): string[] {
    return Array.from(
        new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))
    );
}

export function resolveHistoryImageClientRequestId(item: HistoryMetadata, imageIndex: number): string | undefined {
    const imageRequestId = item.images[imageIndex]?.clientRequestId;
    if (imageRequestId) return imageRequestId;
    if (!item.clientRequestIds || item.clientRequestIds.length === 0) return undefined;
    if (item.clientRequestIds.length === item.images.length) return item.clientRequestIds[imageIndex];
    if (item.images.length === 1) return item.clientRequestIds[0];
    return undefined;
}

export function isFailedHistoryItem(item: HistoryMetadata): boolean {
    return item.status === 'failed';
}

export function readHistoryImageCountSelection(count: number): number | null {
    return [1, 2, 4, 8].includes(count) ? count : null;
}

function matchPresetFromAnyModel(rawSize: string): Exclude<GenerationFormData['size'], 'auto' | 'custom'> | null {
    const presets: Array<Exclude<GenerationFormData['size'], 'auto' | 'custom'>> = ['square', 'landscape', 'portrait'];
    const models: GptImageModel[] = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'];
    return (
        presets.find((preset) =>
            models.some((candidateModel) => rawSize === getPresetDimensions(preset, candidateModel))
        ) ?? null
    );
}

export function readHistorySizeSelection(
    item: HistoryMetadata,
    model: GptImageModel
): {
    size: GenerationFormData['size'];
    customWidth: number | null;
    customHeight: number | null;
    restored: boolean;
} {
    const rawSize = item.size;
    if (!rawSize || rawSize === 'auto') {
        return { size: 'auto', customWidth: null, customHeight: null, restored: Boolean(rawSize) };
    }

    const presets: Array<Exclude<GenerationFormData['size'], 'auto' | 'custom'>> = ['square', 'landscape', 'portrait'];
    const matchedPreset = presets.find(
        (preset) => rawSize === preset || rawSize === getPresetDimensions(preset, model)
    );
    if (matchedPreset) {
        return { size: matchedPreset, customWidth: null, customHeight: null, restored: true };
    }

    const crossModelPreset = matchPresetFromAnyModel(rawSize);
    if (crossModelPreset) {
        return { size: crossModelPreset, customWidth: null, customHeight: null, restored: true };
    }

    const customMatch = /^(\d+)x(\d+)$/.exec(rawSize);
    if (customMatch && model === 'gpt-image-2') {
        return {
            size: 'custom',
            customWidth: Number(customMatch[1]),
            customHeight: Number(customMatch[2]),
            restored: true
        };
    }

    return { size: 'auto', customWidth: null, customHeight: null, restored: false };
}

export function buildHistoryGenerationFormData(
    item: HistoryMetadata,
    fallback: GenerationFormData
): GenerationFormData {
    const nextModel = item.model ?? fallback.model;
    const sizeSelection = readHistorySizeSelection(item, nextModel);
    const outputFormat = item.output_format ?? fallback.output_format;

    if (isFailedHistoryItem(item)) {
        const failedBatchPrompts = readBatchPromptLines(item.prompt);
        return {
            ...fallback,
            prompt: failedBatchPrompts[0] ?? item.prompt,
            size: sizeSelection.size,
            customWidth: sizeSelection.customWidth ?? fallback.customWidth,
            customHeight: sizeSelection.customHeight ?? fallback.customHeight,
            quality: item.quality,
            output_format: outputFormat,
            ...(outputFormat === 'jpeg' || outputFormat === 'webp'
                ? { output_compression: fallback.output_compression }
                : {}),
            background: item.background,
            moderation: item.moderation,
            model: nextModel,
            image_backend: item.image_backend ?? 'server-default',
            streaming_strategy: item.streaming_strategy ?? 'server-default',
            responsesModel: item.responsesModel ?? '',
            thinking: item.thinking ?? 'server-default',
            promptOptimization: item.promptOptimization ?? 'server-default',
            forceWeb: item.forceWeb === true,
            enableParallelBatch: item.enableParallelBatch === true,
            batchPrompts: failedBatchPrompts.length > 1 ? failedBatchPrompts : undefined
        };
    }

    const imageCount = readHistoryImageCountSelection(item.images.length);

    return {
        ...fallback,
        prompt: item.prompt,
        n: imageCount ?? fallback.n,
        size: sizeSelection.size,
        customWidth: sizeSelection.customWidth ?? fallback.customWidth,
        customHeight: sizeSelection.customHeight ?? fallback.customHeight,
        quality: item.quality,
        output_format: outputFormat,
        ...(outputFormat === 'jpeg' || outputFormat === 'webp'
            ? { output_compression: fallback.output_compression }
            : {}),
        background: item.background,
        moderation: item.moderation,
        model: nextModel,
        image_backend: item.image_backend ?? 'server-default',
        streaming_strategy: item.streaming_strategy ?? 'server-default',
        responsesModel: item.responsesModel ?? '',
        thinking: item.thinking ?? 'server-default',
        promptOptimization: item.promptOptimization ?? 'server-default',
        forceWeb: item.forceWeb === true,
        enableParallelBatch: item.enableParallelBatch === true,
        batchPrompts: undefined
    };
}

function getRequestModel(formData: GenerationFormData | EditingFormData, requestMode: RequestMode): GptImageModel {
    return requestMode === 'generate' ? (formData as GenerationFormData).model : (formData as EditingFormData).model;
}

function getRequestSize(formData: GenerationFormData | EditingFormData, requestMode: RequestMode): string {
    const currentModel = getRequestModel(formData, requestMode);
    if (formData.size === 'custom') {
        return `${formData.customWidth}x${formData.customHeight}`;
    }
    return getPresetDimensions(formData.size, currentModel) ?? formData.size;
}

function getRequestPrompt(formData: GenerationFormData | EditingFormData, requestMode: RequestMode): string {
    if (requestMode === 'generate') {
        const genData = formData as GenerationFormData;
        return genData.batchPrompts && genData.batchPrompts.length > 0
            ? formatBatchPromptHistory(genData.batchPrompts)
            : genData.prompt;
    }
    return formData.prompt;
}

export function buildCompletedHistoryEntry(input: {
    images: ApiImageResponseItem[];
    usage: unknown;
    actualCost: ActualCostDetails | undefined;
    durationMs: number;
    formData: GenerationFormData | EditingFormData;
    requestMode: RequestMode;
    storageMode: 'fs' | 'indexeddb';
    promptOverride?: string;
}): HistoryMetadata {
    const clientRequestIds = uniqueStrings(input.images.map((img) => img.clientRequestId));
    const currentModel = getRequestModel(input.formData, input.requestMode);
    const costDetails = calculateApiCost(input.usage as Parameters<typeof calculateApiCost>[0], currentModel);
    return {
        timestamp: Date.now(),
        images: input.images.map((img) => ({
            filename: img.filename,
            ...(img.clientRequestId ? { clientRequestId: img.clientRequestId } : {})
        })),
        storageModeUsed: input.storageMode,
        durationMs: input.durationMs,
        quality: input.formData.quality,
        background: input.requestMode === 'generate' ? (input.formData as GenerationFormData).background : 'auto',
        moderation: input.formData.moderation,
        output_format: input.formData.output_format,
        prompt: input.promptOverride ?? getRequestPrompt(input.formData, input.requestMode),
        mode: input.requestMode,
        costDetails,
        ...(input.actualCost
            ? {
                  actualCostDetails: {
                      ...input.actualCost,
                      ...(costDetails ? { estimatedUsd: costDetails.estimated_cost_usd } : {})
                  }
              }
            : {}),
        model: currentModel,
        size: getRequestSize(input.formData, input.requestMode),
        image_backend: input.formData.image_backend,
        streaming_strategy: input.formData.streaming_strategy,
        responsesModel: input.formData.responsesModel,
        thinking: input.formData.thinking,
        promptOptimization: input.formData.promptOptimization,
        forceWeb: input.formData.forceWeb === true,
        enableParallelBatch: input.formData.enableParallelBatch === true,
        ...(clientRequestIds.length > 0 ? { clientRequestIds } : {})
    };
}

export function buildFailedHistoryEntry(input: {
    message: string;
    durationMs: number;
    formData: GenerationFormData | EditingFormData;
    requestMode: RequestMode;
    storageMode: 'fs' | 'indexeddb';
}): HistoryMetadata {
    return {
        timestamp: Date.now(),
        images: [],
        status: 'failed',
        failureMessage: input.message,
        storageModeUsed: input.storageMode,
        durationMs: input.durationMs,
        quality: input.formData.quality,
        background: input.requestMode === 'generate' ? (input.formData as GenerationFormData).background : 'auto',
        moderation: input.formData.moderation,
        output_format: input.formData.output_format,
        prompt: getRequestPrompt(input.formData, input.requestMode),
        mode: input.requestMode,
        costDetails: null,
        model: getRequestModel(input.formData, input.requestMode),
        size: getRequestSize(input.formData, input.requestMode),
        image_backend: input.formData.image_backend,
        streaming_strategy: input.formData.streaming_strategy,
        responsesModel: input.formData.responsesModel,
        thinking: input.formData.thinking,
        promptOptimization: input.formData.promptOptimization,
        forceWeb: input.formData.forceWeb === true,
        enableParallelBatch: input.formData.enableParallelBatch === true
    };
}

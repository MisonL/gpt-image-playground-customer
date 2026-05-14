'use client';

import { ApiSettingsDialog, type ApiSettings } from '@/components/api-settings-dialog';
import { AppControls } from '@/components/app-controls';
import { EditingForm, type EditingFormData } from '@/components/editing-form';
import { GenerationForm, type GenerationFormData } from '@/components/generation-form';
import { HistoryPanel } from '@/components/history-panel';
import { ImageOutput } from '@/components/image-output';
import { PasswordDialog } from '@/components/password-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
    buildApiErrorNotice,
    buildBatchPartialFailureMessage,
    buildUserFacingApiErrorMessage,
    type ApiErrorNotice
} from '@/lib/api-error-guidance';
import { calculateApiCost, type CostDetails, type GptImageModel } from '@/lib/cost-utils';
import { db, type ImageRecord } from '@/lib/db';
import { useI18n } from '@/lib/i18n';
import { getPresetDimensions, validateGptImage2Size } from '@/lib/size-utils';
import {
    applyStreamingClientEvent,
    buildStreamingBatchJobs,
    isRuntimeStreamingBatchEnabled,
    resolveStreamingBatchCapacity,
    scheduleStreamingBatch,
    shouldUseStreamingBatch,
    type ApiImageResponseItem,
    type StreamingBatchJob,
    type StreamingClientEvent,
    type StreamingClientState
} from '@/lib/streaming-batch';
import type { ActualCostDetails } from '@/lib/upstream-cost/resolve';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, Loader2, Terminal } from 'lucide-react';
import * as React from 'react';

type HistoryImage = {
    filename: string;
    clientRequestId?: string;
};

export type HistoryMetadata = {
    timestamp: number;
    images: HistoryImage[];
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
    clientRequestIds?: string[];
};

type DrawnPoint = {
    x: number;
    y: number;
    size: number;
};

const MAX_EDIT_IMAGES = 10;
const apiSettingsLocalStorageKey = 'openaiImageApiSettings';
const emptyApiSettings: ApiSettings = { apiKey: '', baseUrl: '' };
const sseEventDelimiterPattern = /\r?\n\r?\n/;
type RequestMode = 'generate' | 'edit';
type ApiCallRetryArgs = [GenerationFormData | EditingFormData, RequestMode, boolean, 1 | 2 | 3];

function createClientRequestId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `web-${crypto.randomUUID()}`;
    }
    return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
    return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)));
}

function resolveHistoryImageClientRequestId(item: HistoryMetadata, imageIndex: number): string | undefined {
    const imageRequestId = item.images[imageIndex]?.clientRequestId;
    if (imageRequestId) return imageRequestId;
    if (!item.clientRequestIds || item.clientRequestIds.length === 0) return undefined;
    if (item.clientRequestIds.length === item.images.length) return item.clientRequestIds[imageIndex];
    if (item.images.length === 1) return item.clientRequestIds[0];
    return undefined;
}

function readLocalStorageValue(key: string): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
}

function readStoredHistory(): HistoryMetadata[] {
    const storedHistory = readLocalStorageValue('openaiImageHistory');
    if (!storedHistory) return [];
    try {
        const parsedHistory: unknown = JSON.parse(storedHistory);
        if (Array.isArray(parsedHistory)) return parsedHistory as HistoryMetadata[];
        console.warn('localStorage 中发现无效历史记录数据。');
        window.localStorage.removeItem('openaiImageHistory');
    } catch (e) {
        console.error('加载或解析 localStorage 历史记录失败：', e);
        window.localStorage.removeItem('openaiImageHistory');
    }
    return [];
}

function readStoredApiSettings(): ApiSettings {
    const storedApiSettings = readLocalStorageValue(apiSettingsLocalStorageKey);
    if (!storedApiSettings) return emptyApiSettings;
    try {
        const parsedSettings = JSON.parse(storedApiSettings) as Partial<ApiSettings>;
        return {
            apiKey: typeof parsedSettings.apiKey === 'string' ? parsedSettings.apiKey : '',
            baseUrl: typeof parsedSettings.baseUrl === 'string' ? parsedSettings.baseUrl : ''
        };
    } catch (error) {
        console.error('从 localStorage 加载 API 设置失败：', error);
        window.localStorage.removeItem(apiSettingsLocalStorageKey);
        return emptyApiSettings;
    }
}

function readStoredDeletePreference(): boolean {
    return readLocalStorageValue('imageGenSkipDeleteConfirm') === 'true';
}

function getMimeTypeFromFormat(format: string): string {
    if (format === 'jpeg') return 'image/jpeg';
    if (format === 'webp') return 'image/webp';

    return 'image/png';
}

const explicitModeClient = process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE;

const vercelEnvClient = process.env.NEXT_PUBLIC_VERCEL_ENV;
const isOnVercelClient = vercelEnvClient === 'production' || vercelEnvClient === 'preview';

let effectiveStorageModeClient: 'fs' | 'indexeddb';

if (explicitModeClient === 'fs') {
    effectiveStorageModeClient = 'fs';
} else if (explicitModeClient === 'indexeddb') {
    effectiveStorageModeClient = 'indexeddb';
} else if (isOnVercelClient) {
    effectiveStorageModeClient = 'indexeddb';
} else {
    effectiveStorageModeClient = 'fs';
}

type ApiImageResult = {
    path: string;
    filename: string;
    clientRequestId?: string;
};

type ApiUsage = {
    input_tokens_details?: {
        text_tokens?: number;
        image_tokens?: number;
    };
    output_tokens?: number;
};

type RuntimeCapabilities = {
    streamingBatch: {
        enabled: boolean;
        recommendedConcurrency: number;
        requestCredentialConcurrency: number;
        channelCount?: number;
        healthyChannelCount?: number;
        unhealthyChannelCount?: number;
        lastFailure?: {
            at: number;
            scope: 'credential' | 'channel';
            status?: number;
            code?: string;
            requestId?: string;
        };
    };
};

class ApiRequestError extends Error {
    readonly status?: number;

    constructor(message: string, status?: number) {
        super(message);
        this.name = 'ApiRequestError';
        this.status = status;
    }
}

function summarizeApiError(error: unknown, fallbackMessage: string): { message: string; status?: number } {
    if (error instanceof ApiRequestError) {
        return { message: error.message, status: error.status };
    }
    if (error instanceof Error) {
        return { message: error.message };
    }
    return { message: fallbackMessage };
}

function renderErrorDescription(error: ApiErrorNotice): React.ReactNode {
    return (
        <div className='grid gap-2'>
            <p>{error.message}</p>
            {error.links.map((link) => (
                <a
                    className='w-fit rounded-md border border-red-400/50 px-2 py-1 font-medium text-red-100 underline-offset-2 hover:bg-red-900/30 hover:underline'
                    href={link.url}
                    key={link.url}
                    rel='noreferrer'
                    target='_blank'
                >
                    {link.label}
                </a>
            ))}
        </div>
    );
}

function mergeUsageValues(usages: unknown[]): ApiUsage | undefined {
    const merged: ApiUsage = {
        input_tokens_details: {
            text_tokens: 0,
            image_tokens: 0
        },
        output_tokens: 0
    };
    let hasUsage = false;

    usages.forEach((usage) => {
        if (!usage || typeof usage !== 'object') return;
        const candidate = usage as ApiUsage;
        const textTokens = candidate.input_tokens_details?.text_tokens;
        const imageTokens = candidate.input_tokens_details?.image_tokens;
        const outputTokens = candidate.output_tokens;
        if (typeof textTokens === 'number') {
            merged.input_tokens_details!.text_tokens! += textTokens;
            hasUsage = true;
        }
        if (typeof imageTokens === 'number') {
            merged.input_tokens_details!.image_tokens! += imageTokens;
            hasUsage = true;
        }
        if (typeof outputTokens === 'number') {
            merged.output_tokens! += outputTokens;
            hasUsage = true;
        }
    });

    return hasUsage ? merged : undefined;
}

function mergeActualCostValues(costs: Array<ActualCostDetails | undefined>): ActualCostDetails | undefined {
    const present = costs.filter((cost): cost is ActualCostDetails => cost !== undefined);
    if (present.length === 0) return undefined;

    const actualCosts = present.filter((cost) => cost.source === 'new-api-log-token');
    if (actualCosts.length === present.length) {
        const actualQuota = actualCosts.reduce((sum, cost) => sum + (cost.actualQuota ?? 0), 0);
        const actualAmount = actualCosts.reduce((sum, cost) => sum + (cost.actualAmount ?? 0), 0);
        return {
            actualAmount: Math.round(actualAmount * 1_000_000) / 1_000_000,
            actualQuota,
            currency: 'usd-equivalent',
            source: 'new-api-log-token',
            confidence: actualCosts.every((cost) => cost.confidence === 'high') ? 'high' : 'low',
            upstreamProvider: 'new-api',
            reason: actualCosts.length > 1 ? `已汇总 ${actualCosts.length} 个子请求的实际扣费。` : undefined
        };
    }

    return {
        currency: 'usd-equivalent',
        source: 'unavailable',
        confidence: 'low',
        upstreamProvider: 'new-api',
        reason: '批量请求中存在未匹配到实际扣费的子请求，未将估算值标记为实际扣费。'
    };
}

export default function HomePage() {
    const { t } = useI18n();
    const createErrorNotice = React.useCallback(
        (message: string) => buildApiErrorNotice(message, t('error.openSuperApi')),
        [t]
    );
    const [mode, setMode] = React.useState<'generate' | 'edit'>('generate');
    const [isPasswordRequiredByBackend, setIsPasswordRequiredByBackend] = React.useState<boolean | null>(null);
    const [clientPasswordHash, setClientPasswordHash] = React.useState<string | null>(null);
    const [isLoading, setIsLoading] = React.useState(false);
    const [isSendingToEdit, setIsSendingToEdit] = React.useState(false);
    const [error, setError] = React.useState<ApiErrorNotice | null>(null);
    const [latestImageBatch, setLatestImageBatch] = React.useState<ApiImageResult[] | null>(null);
    const [imageOutputView, setImageOutputView] = React.useState<'grid' | number>('grid');
    const [history, setHistory] = React.useState<HistoryMetadata[]>([]);
    const hasLoadedStoredHistoryRef = React.useRef(false);
    const blobUrlCacheRef = React.useRef<Map<string, string>>(new Map());
    const [isPasswordDialogOpen, setIsPasswordDialogOpen] = React.useState(false);
    const [isApiSettingsDialogOpen, setIsApiSettingsDialogOpen] = React.useState(false);
    const [apiSettings, setApiSettings] = React.useState<ApiSettings>(emptyApiSettings);
    const [runtimeCapabilities, setRuntimeCapabilities] = React.useState<RuntimeCapabilities | null>(null);
    const [passwordDialogContext, setPasswordDialogContext] = React.useState<'initial' | 'retry'>('initial');
    const [lastApiCallArgs, setLastApiCallArgs] = React.useState<ApiCallRetryArgs | null>(null);
    const [skipDeleteConfirmation, setSkipDeleteConfirmation] = React.useState<boolean>(false);
    const [itemToDeleteConfirm, setItemToDeleteConfirm] = React.useState<HistoryMetadata | null>(null);
    const [dialogCheckboxStateSkipConfirm, setDialogCheckboxStateSkipConfirm] = React.useState<boolean>(false);
    const [openLogsSignal, setOpenLogsSignal] = React.useState(0);
    const outputPanelRef = React.useRef<HTMLDivElement | null>(null);

    const allDbImages = useLiveQuery<ImageRecord[] | undefined>(() => db.images.toArray(), []);

    const [editImageFiles, setEditImageFiles] = React.useState<File[]>([]);
    const [editSourceImagePreviewUrls, setEditSourceImagePreviewUrls] = React.useState<string[]>([]);
    const [editPrompt, setEditPrompt] = React.useState('');
    const [editN, setEditN] = React.useState([1]);
    const [editSize, setEditSize] = React.useState<EditingFormData['size']>('auto');
    const [editCustomWidth, setEditCustomWidth] = React.useState<number>(1024);
    const [editCustomHeight, setEditCustomHeight] = React.useState<number>(1024);
    const [editQuality, setEditQuality] = React.useState<EditingFormData['quality']>('auto');
    const [editBrushSize, setEditBrushSize] = React.useState([20]);
    const [editShowMaskEditor, setEditShowMaskEditor] = React.useState(false);
    const [editGeneratedMaskFile, setEditGeneratedMaskFile] = React.useState<File | null>(null);
    const [editIsMaskSaved, setEditIsMaskSaved] = React.useState(false);
    const [editOriginalImageSize, setEditOriginalImageSize] = React.useState<{ width: number; height: number } | null>(
        null
    );
    const [editDrawnPoints, setEditDrawnPoints] = React.useState<DrawnPoint[]>([]);
    const [editMaskPreviewUrl, setEditMaskPreviewUrl] = React.useState<string | null>(null);

    const [genModel, setGenModel] = React.useState<GenerationFormData['model']>('gpt-image-2');
    const [genPrompt, setGenPrompt] = React.useState('');
    const [genN, setGenN] = React.useState([1]);
    const [genSize, setGenSize] = React.useState<GenerationFormData['size']>('auto');
    const [genCustomWidth, setGenCustomWidth] = React.useState<number>(1024);
    const [genCustomHeight, setGenCustomHeight] = React.useState<number>(1024);
    const [genQuality, setGenQuality] = React.useState<GenerationFormData['quality']>('high');
    const [genOutputFormat, setGenOutputFormat] = React.useState<GenerationFormData['output_format']>('png');
    const [genCompression, setGenCompression] = React.useState([100]);
    const [genBackground, setGenBackground] = React.useState<GenerationFormData['background']>('auto');
    const [genModeration, setGenModeration] = React.useState<GenerationFormData['moderation']>('auto');

    const [editModel, setEditModel] = React.useState<EditingFormData['model']>('gpt-image-2');

    // 流式状态，由生成和编辑模式共用。
    const [enableStreaming, setEnableStreaming] = React.useState(true);
    const [partialImages, setPartialImages] = React.useState<1 | 2 | 3>(2);
    // 流式预览图，存储流式过程中的局部图片 base64 data URL。
    const [streamingPreviewImages, setStreamingPreviewImages] = React.useState<Map<number, string>>(new Map());
    const streamingBatchCapacity = resolveStreamingBatchCapacity({
        featureEnabled: isRuntimeStreamingBatchEnabled({
            serverEnabled: runtimeCapabilities?.streamingBatch.enabled
        }),
        hasRequestApiKey: apiSettings.apiKey.trim().length > 0,
        requestCredentialConcurrency: runtimeCapabilities?.streamingBatch.requestCredentialConcurrency ?? 1,
        serverRecommendedConcurrency: runtimeCapabilities?.streamingBatch.recommendedConcurrency ?? 0
    });
    const streamingBatchEnabled = streamingBatchCapacity.enabled;
    const currentPrompt = mode === 'generate' ? genPrompt : editPrompt;
    const hasEditSourceImage = editImageFiles.length > 0;
    const currentGenerateSizeValidation =
        genSize === 'custom' ? validateGptImage2Size(genCustomWidth, genCustomHeight) : { valid: true as const };
    const currentEditSizeValidation =
        editSize === 'custom' ? validateGptImage2Size(editCustomWidth, editCustomHeight) : { valid: true as const };
    const canOpenLogs = isPasswordRequiredByBackend === true && !!clientPasswordHash;
    const activeLogClientRequestIds = React.useMemo(() => {
        if (!latestImageBatch || latestImageBatch.length === 0) return [];
        if (typeof imageOutputView === 'number') {
            return uniqueStrings([latestImageBatch[imageOutputView]?.clientRequestId]);
        }
        return uniqueStrings(latestImageBatch.map((image) => image.clientRequestId));
    }, [imageOutputView, latestImageBatch]);
    const activeLogFilenames = React.useMemo(() => {
        if (!latestImageBatch || latestImageBatch.length === 0) return [];
        if (typeof imageOutputView === 'number') {
            return uniqueStrings([latestImageBatch[imageOutputView]?.filename]);
        }
        return uniqueStrings(latestImageBatch.map((image) => image.filename));
    }, [imageOutputView, latestImageBatch]);
    const mobilePrimaryDisabled =
        isLoading ||
        isSendingToEdit ||
        !currentPrompt.trim() ||
        (mode === 'edit' && !hasEditSourceImage) ||
        (mode === 'generate' && !currentGenerateSizeValidation.valid) ||
        (mode === 'edit' && !currentEditSizeValidation.valid) ||
        (mode === 'edit' && editDrawnPoints.length > 0 && !editGeneratedMaskFile && !editIsMaskSaved);

    const scrollToOutput = React.useCallback(() => {
        outputPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    const getImageSrc = React.useCallback(
        (filename: string): string | undefined => {
            const cached = blobUrlCacheRef.current.get(filename);
            if (cached) return cached;

            const record = allDbImages?.find((img) => img.filename === filename);
            if (record?.blob) {
                const url = URL.createObjectURL(record.blob);
                blobUrlCacheRef.current.set(filename, url);
                return url;
            }

            return undefined;
        },
        [allDbImages]
    );

    React.useEffect(() => {
        const cache = blobUrlCacheRef.current;
        return () => {
            cache.forEach((url) => URL.revokeObjectURL(url));
            cache.clear();
        };
    }, []);

    React.useEffect(() => {
        queueMicrotask(() => {
            setHistory(readStoredHistory());
            hasLoadedStoredHistoryRef.current = true;
        });
    }, []);

    React.useEffect(() => {
        return () => {
            editSourceImagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [editSourceImagePreviewUrls]);

    React.useEffect(() => {
        const fetchAuthStatus = async () => {
            try {
                const response = await fetch('/api/auth-status');
                if (!response.ok) {
                    throw new Error('获取鉴权状态失败');
                }
                const data = await response.json();
                setIsPasswordRequiredByBackend(data.passwordRequired);
            } catch (error) {
                console.error('获取鉴权状态失败：', error);
                setIsPasswordRequiredByBackend(false);
            }
        };

        fetchAuthStatus();
        queueMicrotask(() => {
            setClientPasswordHash(readLocalStorageValue('clientPasswordHash'));
            setApiSettings(readStoredApiSettings());
        });
    }, []);

    const refreshRuntimeCapabilities = React.useCallback(async (): Promise<RuntimeCapabilities | null> => {
        try {
            const response = await fetch('/api/runtime-capabilities');
            if (!response.ok) {
                throw new Error('获取运行时能力失败');
            }
            const data = (await response.json()) as RuntimeCapabilities;
            setRuntimeCapabilities(data);
            return data;
        } catch (error) {
            console.error('获取运行时能力失败：', error);
            setRuntimeCapabilities(null);
            return null;
        }
    }, []);

    React.useEffect(() => {
        queueMicrotask(() => {
            refreshRuntimeCapabilities();
        });
    }, [refreshRuntimeCapabilities]);

    React.useEffect(() => {
        if (!hasLoadedStoredHistoryRef.current) return;
        try {
            localStorage.setItem('openaiImageHistory', JSON.stringify(history));
        } catch (e) {
            console.error('保存历史记录到 localStorage 失败：', e);
        }
    }, [history]);

    React.useEffect(() => {
        return () => {
            editSourceImagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [editSourceImagePreviewUrls]);

    React.useEffect(() => {
        queueMicrotask(() => {
            setSkipDeleteConfirmation(readStoredDeletePreference());
        });
    }, []);

    React.useEffect(() => {
        localStorage.setItem('imageGenSkipDeleteConfirm', String(skipDeleteConfirmation));
    }, [skipDeleteConfirmation]);

    React.useEffect(() => {
        const handlePaste = (event: ClipboardEvent) => {
            if (mode !== 'edit' || !event.clipboardData) {
                return;
            }

            if (editImageFiles.length >= MAX_EDIT_IMAGES) {
                alert(t('alert.pasteMaxImages', { count: MAX_EDIT_IMAGES }));
                return;
            }

            const items = event.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const file = items[i].getAsFile();
                    if (file) {
                        event.preventDefault();

                        const previewUrl = URL.createObjectURL(file);

                        setEditImageFiles((prevFiles) => [...prevFiles, file]);
                        setEditSourceImagePreviewUrls((prevUrls) => [...prevUrls, previewUrl]);

                        break;
                    }
                }
            }
        };

        window.addEventListener('paste', handlePaste);

        return () => {
            window.removeEventListener('paste', handlePaste);
        };
    }, [mode, editImageFiles.length, t]);

    async function sha256Client(text: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    const handleSavePassword = async (password: string) => {
        if (!password.trim()) {
            setError(createErrorNotice(t('password.empty')));
            return;
        }
        try {
            const hash = await sha256Client(password);
            localStorage.setItem('clientPasswordHash', hash);
            setClientPasswordHash(hash);
            setError(null);
            setIsPasswordDialogOpen(false);
            if (passwordDialogContext === 'retry' && lastApiCallArgs) {
                const retryArgs = lastApiCallArgs;
                setLastApiCallArgs(null);
                await handleApiCall(...retryArgs);
            }
        } catch (e) {
            console.error('计算密码哈希失败：', e);
            setError(createErrorNotice(t('password.hashError')));
        }
    };

    const handleOpenPasswordDialog = () => {
        setPasswordDialogContext('initial');
        setIsPasswordDialogOpen(true);
    };

    const handleSaveApiSettings = (settings: ApiSettings) => {
        setApiSettings(settings);
        if (settings.apiKey || settings.baseUrl) {
            localStorage.setItem(apiSettingsLocalStorageKey, JSON.stringify(settings));
        } else {
            localStorage.removeItem(apiSettingsLocalStorageKey);
        }
    };

    const buildHistoryEntry = React.useCallback(
        (
            images: ApiImageResponseItem[],
            usage: unknown,
            actualCost: ActualCostDetails | undefined,
            durationMsValue: number
        ): HistoryMetadata => {
            const isGenerateMode = mode === 'generate';
            const currentModel = isGenerateMode ? genModel : editModel;
            const clientRequestIds = uniqueStrings(images.map((img) => img.clientRequestId));
            const requestSize = isGenerateMode
                ? genSize === 'custom'
                    ? `${genCustomWidth}x${genCustomHeight}`
                    : (getPresetDimensions(genSize, genModel) ?? genSize)
                : editSize === 'custom'
                  ? `${editCustomWidth}x${editCustomHeight}`
                  : (getPresetDimensions(editSize, editModel) ?? editSize);
            const costDetails = calculateApiCost(usage as Parameters<typeof calculateApiCost>[0], currentModel);
            return {
                timestamp: Date.now(),
                images: images.map((img) => ({
                    filename: img.filename,
                    ...(img.clientRequestId ? { clientRequestId: img.clientRequestId } : {})
                })),
                storageModeUsed: effectiveStorageModeClient,
                durationMs: durationMsValue,
                quality: isGenerateMode ? genQuality : editQuality,
                background: isGenerateMode ? genBackground : 'auto',
                moderation: isGenerateMode ? genModeration : 'auto',
                output_format: isGenerateMode ? genOutputFormat : 'png',
                prompt: isGenerateMode ? genPrompt : editPrompt,
                mode,
                costDetails,
                ...(actualCost
                    ? {
                          actualCostDetails: {
                              ...actualCost,
                              ...(costDetails ? { estimatedUsd: costDetails.estimated_cost_usd } : {})
                          }
                      }
                    : {}),
                model: currentModel,
                size: requestSize,
                ...(clientRequestIds.length > 0 ? { clientRequestIds } : {})
            };
        },
        [
            editCustomHeight,
            editCustomWidth,
            editModel,
            editPrompt,
            editQuality,
            editSize,
            genBackground,
            genCustomHeight,
            genCustomWidth,
            genModel,
            genModeration,
            genOutputFormat,
            genPrompt,
            genQuality,
            genSize,
            mode
        ]
    );

    const materializeImages = React.useCallback(
        async (images: ApiImageResponseItem[]): Promise<ApiImageResult[]> => {
            if (effectiveStorageModeClient === 'indexeddb') {
                const indexedDbImages = await Promise.all(
                    images.map(async (img) => {
                        if (!img.b64_json) {
                            throw new Error(t('error.imageMissingBase64', { filename: img.filename }));
                        }
                        const byteCharacters = atob(img.b64_json);
                        const byteNumbers = new Array(byteCharacters.length);
                        for (let i = 0; i < byteCharacters.length; i++) {
                            byteNumbers[i] = byteCharacters.charCodeAt(i);
                        }
                        const byteArray = new Uint8Array(byteNumbers);
                        const blob = new Blob([byteArray], { type: getMimeTypeFromFormat(img.output_format) });

                        await db.images.put({ filename: img.filename, blob });

                        const existingUrl = blobUrlCacheRef.current.get(img.filename);
                        if (existingUrl) {
                            URL.revokeObjectURL(existingUrl);
                        }
                        const blobUrl = URL.createObjectURL(blob);
                        blobUrlCacheRef.current.set(img.filename, blobUrl);
                        return { filename: img.filename, path: blobUrl, ...(img.clientRequestId ? { clientRequestId: img.clientRequestId } : {}) };
                    })
                );
                return indexedDbImages;
            }

            const fsImages = images
                .filter((img) => !!img.path)
                .map((img) => ({ path: img.path!, filename: img.filename, ...(img.clientRequestId ? { clientRequestId: img.clientRequestId } : {}) }));
            if (fsImages.length !== images.length) {
                throw new Error(t('error.apiOmittedPaths'));
            }
            return fsImages;
        },
        [t]
    );

    const commitCompletedImages = React.useCallback(
        async (
            images: ApiImageResponseItem[],
            usage: unknown,
            actualCost: ActualCostDetails | undefined,
            durationMsValue: number,
            clearStreaming = false
        ) => {
            if (images.length === 0) {
                throw new Error(t('error.noImages'));
            }

            const processedImages = await materializeImages(images);
            setLatestImageBatch(processedImages);
            setImageOutputView(processedImages.length > 1 ? 'grid' : 0);
            if (clearStreaming) {
                setStreamingPreviewImages(new Map());
            }
            setHistory((prevHistory) => [buildHistoryEntry(images, usage, actualCost, durationMsValue), ...prevHistory]);
        },
        [buildHistoryEntry, materializeImages, t]
    );

    const buildApiFormData = React.useCallback(
        (
            formData: GenerationFormData | EditingFormData,
            requestMode: RequestMode,
            options: {
                forceSingleImage?: boolean;
                streaming: boolean;
                partialImages: 1 | 2 | 3;
            }
        ) => {
            const apiFormData = new FormData();
            if (isPasswordRequiredByBackend && clientPasswordHash) {
                apiFormData.append('passwordHash', clientPasswordHash);
            } else if (isPasswordRequiredByBackend && !clientPasswordHash) {
                throw new Error(t('error.passwordRequired'));
            }
            apiFormData.append('mode', requestMode);
            if (apiSettings.apiKey) {
                apiFormData.append('apiKey', apiSettings.apiKey);
            }
            if (apiSettings.baseUrl) {
                apiFormData.append('apiBaseUrl', apiSettings.baseUrl);
            }

            if (options.streaming) {
                apiFormData.append('stream', 'true');
                apiFormData.append('partial_images', options.partialImages.toString());
            }
            apiFormData.append('clientRequestId', createClientRequestId());

            if (requestMode === 'generate') {
                const genData = formData as GenerationFormData;
                apiFormData.append('model', genData.model);
                apiFormData.append('prompt', genData.prompt);
                apiFormData.append('n', options.forceSingleImage ? '1' : genData.n.toString());
                const genSizeToSend =
                    genData.size === 'custom'
                        ? `${genData.customWidth}x${genData.customHeight}`
                        : (getPresetDimensions(genData.size, genData.model) ?? genData.size);
                apiFormData.append('size', genSizeToSend);
                apiFormData.append('quality', genData.quality);
                apiFormData.append('output_format', genData.output_format);
                if (
                    (genData.output_format === 'jpeg' || genData.output_format === 'webp') &&
                    genData.output_compression !== undefined
                ) {
                    apiFormData.append('output_compression', genData.output_compression.toString());
                }
                apiFormData.append('background', genData.background);
                apiFormData.append('moderation', genData.moderation);
            } else {
                const editData = formData as EditingFormData;
                apiFormData.append('model', editData.model);
                apiFormData.append('prompt', editData.prompt);
                apiFormData.append('n', options.forceSingleImage ? '1' : editData.n.toString());
                const editSizeToSend =
                    editData.size === 'custom'
                        ? `${editData.customWidth}x${editData.customHeight}`
                        : (getPresetDimensions(editData.size, editData.model) ?? editData.size);
                apiFormData.append('size', editSizeToSend);
                apiFormData.append('quality', editData.quality);

                editData.imageFiles.forEach((file, index) => {
                    apiFormData.append(`image_${index}`, file, file.name);
                });
                if (editData.maskFile) {
                    apiFormData.append('mask', editData.maskFile, editData.maskFile.name);
                }
            }

            return apiFormData;
        },
        [
            apiSettings.apiKey,
            apiSettings.baseUrl,
            clientPasswordHash,
            isPasswordRequiredByBackend,
            t
        ]
    );

    const executeImageRequest = React.useCallback(
        async (
            apiFormData: FormData,
            options: {
                previewIndexOffset?: number;
                retryFormData?: GenerationFormData | EditingFormData;
                retryMode?: RequestMode;
                retryStreaming?: boolean;
                retryPartialImages?: 1 | 2 | 3;
            } = {}
        ): Promise<{ images: ApiImageResponseItem[]; usage: unknown; actualCost?: ActualCostDetails }> => {
            const formClientRequestId = String(apiFormData.get('clientRequestId') || '');
            const response = await fetch('/api/images', {
                method: 'POST',
                body: apiFormData
            });

            const contentType = response.headers.get('content-type');
            if (contentType?.includes('text/event-stream')) {
                if (!response.body) {
                    throw new Error(t('error.responseBodyNull'));
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let streamingState: StreamingClientState = {
                    completedImages: []
                };

                const processSseEvent = async (rawEvent: string) => {
                    const dataLines = rawEvent
                        .split(/\r?\n/)
                        .filter((line) => line.startsWith('data: '))
                        .map((line) => line.slice(6));
                    if (dataLines.length === 0) return;

                    const event = JSON.parse(dataLines.join('\n'));
                    if (event.type === 'partial_image') {
                        const imageIndex = options.previewIndexOffset ?? event.index ?? 0;
                        const dataUrl = `data:image/png;base64,${event.b64_json}`;
                        setStreamingPreviewImages((prev) => {
                            const newMap = new Map(prev);
                            newMap.set(imageIndex, dataUrl);
                            return newMap;
                        });
                    } else if (event.type === 'error') {
                        throw new ApiRequestError(event.error || t('error.streaming'), event.status);
                    } else if (event.type === 'completed' || event.type === 'done') {
                        streamingState = applyStreamingClientEvent(streamingState, event as StreamingClientEvent);
                    }
                };

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const events = buffer.split(sseEventDelimiterPattern);
                    buffer = events.pop() || '';

                    for (const eventText of events) {
                        await processSseEvent(eventText);
                    }
                }
                const remainingEvent = buffer.trim();
                if (remainingEvent) {
                    await processSseEvent(remainingEvent);
                }

                return {
                    images: streamingState.completedImages.map((image) => ({
                        ...image,
                        ...(image.clientRequestId || !formClientRequestId ? {} : { clientRequestId: formClientRequestId })
                    })),
                    usage: streamingState.usage,
                    actualCost: streamingState.actualCost ?? undefined
                };
            }

            let result: {
                error?: string;
                images?: ApiImageResponseItem[];
                usage?: unknown;
                actualCost?: ActualCostDetails;
                clientRequestId?: string;
            };
            try {
                result = await response.json();
            } catch (error) {
                if (!response.ok) {
                    throw new ApiRequestError(t('error.apiFailed', { status: response.status }), response.status);
                }
                throw error;
            }

            if (!response.ok) {
                if (response.status === 401 && isPasswordRequiredByBackend) {
                    setError(createErrorNotice(t('error.unauthorized')));
                    setPasswordDialogContext('retry');
                    if (
                        options.retryFormData &&
                        options.retryMode &&
                        options.retryStreaming !== undefined &&
                        options.retryPartialImages !== undefined
                    ) {
                        setLastApiCallArgs([
                            options.retryFormData,
                            options.retryMode,
                            options.retryStreaming,
                            options.retryPartialImages
                        ]);
                    }
                    setIsPasswordDialogOpen(true);
                    throw new ApiRequestError(t('error.unauthorized'), 401);
                }
                throw new ApiRequestError(result.error || t('error.apiFailed', { status: response.status }), response.status);
            }

            return {
                images: (result.images || []).map((image) => ({
                    ...image,
                    ...(image.clientRequestId || !(result.clientRequestId || formClientRequestId)
                        ? {}
                        : { clientRequestId: result.clientRequestId || formClientRequestId })
                })),
                usage: result.usage,
                actualCost: result.actualCost
            };
        },
        [createErrorNotice, isPasswordRequiredByBackend, t]
    );

    async function handleApiCall(
        formData: GenerationFormData | EditingFormData,
        requestMode: RequestMode = mode,
        requestStreaming: boolean = enableStreaming,
        requestPartialImages: 1 | 2 | 3 = partialImages
    ) {
        const startTime = Date.now();
        let durationMs = 0;

        setIsLoading(true);
        setError(null);
        setLatestImageBatch(null);
        setImageOutputView('grid');
        setStreamingPreviewImages(new Map());
        if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
            window.setTimeout(scrollToOutput, 80);
        }

        try {
            const latestRuntimeCapabilities = await refreshRuntimeCapabilities();
            const currentStreamingBatchCapacity = resolveStreamingBatchCapacity({
                featureEnabled: isRuntimeStreamingBatchEnabled({
                    serverEnabled: latestRuntimeCapabilities?.streamingBatch.enabled
                }),
                hasRequestApiKey: apiSettings.apiKey.trim().length > 0,
                requestCredentialConcurrency: latestRuntimeCapabilities?.streamingBatch.requestCredentialConcurrency ?? 1,
                serverRecommendedConcurrency: latestRuntimeCapabilities?.streamingBatch.recommendedConcurrency ?? 0
            });
            if (isPasswordRequiredByBackend && !clientPasswordHash) {
                setError(createErrorNotice(t('error.passwordRequired')));
                setPasswordDialogContext('initial');
                setIsPasswordDialogOpen(true);
                return;
            }

            const imageCount =
                requestMode === 'generate' ? (formData as GenerationFormData).n : (formData as EditingFormData).n;
            const useStreamingBatch = shouldUseStreamingBatch({
                enabled: currentStreamingBatchCapacity.enabled,
                streaming: requestStreaming,
                imageCount
            });
            const executeImageRequestForCurrentOptions = async (
                options: { forceSingleImage: boolean; previewIndexOffset?: number } = { forceSingleImage: false }
            ) => {
                return executeImageRequest(
                    buildApiFormData(formData, requestMode, {
                        forceSingleImage: options.forceSingleImage,
                        streaming: requestStreaming,
                        partialImages: requestPartialImages
                    }),
                    {
                        previewIndexOffset: options.previewIndexOffset,
                        retryFormData: formData,
                        retryMode: requestMode,
                        retryStreaming: requestStreaming,
                        retryPartialImages: requestPartialImages
                    }
                );
            };

            if (useStreamingBatch) {
                const jobs = buildStreamingBatchJobs(imageCount);
                const batchResults = await scheduleStreamingBatch(
                    jobs,
                    currentStreamingBatchCapacity.concurrency,
                    async (job: StreamingBatchJob) => {
                        return executeImageRequestForCurrentOptions({ forceSingleImage: true, previewIndexOffset: job.outputIndex });
                    }
                );
                const errors = batchResults.filter((result): result is Error => result instanceof Error);
                const successes = batchResults.filter(
                    (result): result is { images: ApiImageResponseItem[]; usage: unknown; actualCost?: ActualCostDetails } =>
                        !(result instanceof Error)
                );
                if (errors.some((error) => error instanceof ApiRequestError && error.status === 401)) {
                    return;
                }
                if (successes.length === 0) {
                    throw errors[0] || new Error(t('error.noImages'));
                }
                const images = successes.flatMap((result) => result.images);
                const usage = mergeUsageValues(successes.map((result) => result.usage));
                const actualCost = mergeActualCostValues(successes.map((result) => result.actualCost));
                durationMs = Date.now() - startTime;
                await commitCompletedImages(images, usage, actualCost, durationMs, true);
                if (errors.length > 0) {
                    await refreshRuntimeCapabilities();
                    setError(
                        createErrorNotice(
                            buildBatchPartialFailureMessage({
                                failed: errors.length,
                                total: jobs.length,
                                errors: errors.map((error) => summarizeApiError(error, t('error.unexpected'))),
                                t
                            })
                        )
                    );
                }
                return;
            }

            const result = await executeImageRequestForCurrentOptions();
            durationMs = Date.now() - startTime;
            await commitCompletedImages(result.images || [], result.usage, result.actualCost, durationMs);
        } catch (err: unknown) {
            durationMs = Date.now() - startTime;
            console.error(`API 调用在 ${durationMs}ms 后失败：`, err);
            const errorSummary = summarizeApiError(err, t('error.unexpected'));
            setError(createErrorNotice(buildUserFacingApiErrorMessage({ ...errorSummary, t })));
            setLatestImageBatch(null);
            setStreamingPreviewImages(new Map());
            await refreshRuntimeCapabilities();
        } finally {
            if (durationMs === 0) durationMs = Date.now() - startTime;
            setIsLoading(false);
        }
    }

    function handleMobilePrimaryAction() {
        if (mode === 'generate') {
            void handleApiCall({
                prompt: genPrompt,
                n: genN[0],
                size: genSize,
                customWidth: genCustomWidth,
                customHeight: genCustomHeight,
                quality: genQuality,
                output_format: genOutputFormat,
                ...(genOutputFormat === 'jpeg' || genOutputFormat === 'webp'
                    ? { output_compression: genCompression[0] }
                    : {}),
                background: genBackground,
                moderation: genModeration,
                model: genModel
            });
            return;
        }
        void handleApiCall({
            prompt: editPrompt,
            n: editN[0],
            size: editSize,
            customWidth: editCustomWidth,
            customHeight: editCustomHeight,
            quality: editQuality,
            imageFiles: editImageFiles,
            maskFile: editGeneratedMaskFile,
            model: editModel
        });
    }

    const handleHistorySelect = React.useCallback(
        (item: HistoryMetadata) => {
            const originalStorageMode = item.storageModeUsed || 'fs';

            const selectedBatchPromises = item.images.map(async (imgInfo, imageIndex) => {
                let path: string | undefined;
                if (originalStorageMode === 'indexeddb') {
                    path = getImageSrc(imgInfo.filename);
                } else {
                    path = `/api/image/${imgInfo.filename}`;
                }

                const clientRequestId = resolveHistoryImageClientRequestId(item, imageIndex);
                if (path) {
                    return {
                        path,
                        filename: imgInfo.filename,
                        ...(clientRequestId ? { clientRequestId } : {})
                    };
                } else {
                    console.warn(
                        `Could not get image source for history item: ${imgInfo.filename} (mode: ${originalStorageMode})`
                    );
                    setError(createErrorNotice(t('error.historyImageLoad', { filename: imgInfo.filename })));
                    return null;
                }
            });

            Promise.all(selectedBatchPromises).then((resolvedBatch) => {
                const validImages = resolvedBatch.filter(Boolean) as ApiImageResult[];

                if (validImages.length !== item.images.length) {
                    setError(createErrorNotice(t('error.historySomeMissing')));
                } else {
                    setError(null);
                }

                setLatestImageBatch(validImages.length > 0 ? validImages : null);
                setImageOutputView(validImages.length > 1 ? 'grid' : 0);
            });
        },
        [createErrorNotice, getImageSrc, t]
    );

    const handleClearHistory = React.useCallback(async () => {
        const confirmationMessage =
            effectiveStorageModeClient === 'indexeddb'
                ? t('confirm.clearHistoryIndexedDb')
                : t('confirm.clearHistoryFs');

        if (window.confirm(confirmationMessage)) {
            setHistory([]);
            setLatestImageBatch(null);
            setImageOutputView('grid');
            setError(null);

            try {
                localStorage.removeItem('openaiImageHistory');

                if (effectiveStorageModeClient === 'indexeddb') {
                    await db.images.clear();
                    blobUrlCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
                    blobUrlCacheRef.current.clear();
                }
            } catch (e) {
                console.error('清空历史记录失败：', e);
                setError(createErrorNotice(t('error.clearHistory', { message: e instanceof Error ? e.message : String(e) })));
            }
        }
    }, [createErrorNotice, t]);

    const handleSendToEdit = async (filename: string) => {
        if (isSendingToEdit) return;
        setIsSendingToEdit(true);
        setError(null);

        const alreadyExists = editImageFiles.some((file) => file.name === filename);
        if (mode === 'edit' && alreadyExists) {
            setIsSendingToEdit(false);
            return;
        }

        if (mode === 'edit' && editImageFiles.length >= MAX_EDIT_IMAGES) {
            setError(createErrorNotice(t('error.maxEditImages', { count: MAX_EDIT_IMAGES })));
            setIsSendingToEdit(false);
            return;
        }

        try {
            let blob: Blob | undefined;
            let mimeType: string = 'image/png';

            if (effectiveStorageModeClient === 'indexeddb') {
                const record = allDbImages?.find((img) => img.filename === filename);
                if (record?.blob) {
                    blob = record.blob;
                    mimeType = blob.type || mimeType;
                } else {
                    throw new Error(t('error.imageNotFoundDb', { filename }));
                }
            } else {
                const response = await fetch(`/api/image/${filename}`);
                if (!response.ok) {
                    throw new Error(t('error.fetchImage', { statusText: response.statusText }));
                }
                blob = await response.blob();
                mimeType = response.headers.get('Content-Type') || mimeType;
            }

            if (!blob) {
                throw new Error(t('error.retrieveImage', { filename }));
            }

            const newFile = new File([blob], filename, { type: mimeType });
            const newPreviewUrl = URL.createObjectURL(blob);

            editSourceImagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));

            setEditImageFiles([newFile]);
            setEditSourceImagePreviewUrls([newPreviewUrl]);

            if (mode === 'generate') {
                setMode('edit');
            }
        } catch (err: unknown) {
            console.error('发送图片到编辑模式失败：', err);
            const errorMessage = err instanceof Error ? err.message : t('error.sendToEdit');
            setError(createErrorNotice(errorMessage));
        } finally {
            setIsSendingToEdit(false);
        }
    };

    const executeDeleteItem = React.useCallback(
        async (item: HistoryMetadata) => {
            if (!item) return;
            setError(null);

            const { images: imagesInEntry, storageModeUsed, timestamp } = item;
            const filenamesToDelete = imagesInEntry.map((img) => img.filename);

            try {
                if (storageModeUsed === 'indexeddb') {
                    await db.images.where('filename').anyOf(filenamesToDelete).delete();
                    filenamesToDelete.forEach((fn) => {
                        const url = blobUrlCacheRef.current.get(fn);
                        if (url) URL.revokeObjectURL(url);
                        blobUrlCacheRef.current.delete(fn);
                    });
                } else if (storageModeUsed === 'fs') {
                    const apiPayload: { filenames: string[]; passwordHash?: string } = {
                        filenames: filenamesToDelete
                    };
                    if (isPasswordRequiredByBackend && clientPasswordHash) {
                        apiPayload.passwordHash = clientPasswordHash;
                    }

                    const response = await fetch('/api/image-delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(apiPayload)
                    });

                    const result = await response.json();
                    if (!response.ok) {
                        throw new Error(result.error || `API deletion failed with status ${response.status}`);
                    }
                }

                setHistory((prevHistory) => prevHistory.filter((h) => h.timestamp !== timestamp));
                setLatestImageBatch((prev) =>
                    prev && prev.some((img) => filenamesToDelete.includes(img.filename)) ? null : prev
                );
            } catch (e: unknown) {
                console.error('删除条目失败：', e);
                setError(createErrorNotice(e instanceof Error ? e.message : t('error.deleteUnexpected')));
            } finally {
                setItemToDeleteConfirm(null);
            }
        },
        [clientPasswordHash, createErrorNotice, isPasswordRequiredByBackend, t]
    );

    const handleRequestDeleteItem = React.useCallback(
        (item: HistoryMetadata) => {
            if (!skipDeleteConfirmation) {
                setDialogCheckboxStateSkipConfirm(skipDeleteConfirmation);
                setItemToDeleteConfirm(item);
            } else {
                executeDeleteItem(item);
            }
        },
        [skipDeleteConfirmation, executeDeleteItem]
    );

    const handleConfirmDeletion = React.useCallback(() => {
        if (itemToDeleteConfirm) {
            executeDeleteItem(itemToDeleteConfirm);
            setSkipDeleteConfirmation(dialogCheckboxStateSkipConfirm);
        }
    }, [itemToDeleteConfirm, executeDeleteItem, dialogCheckboxStateSkipConfirm]);

    const handleCancelDeletion = React.useCallback(() => {
        setItemToDeleteConfirm(null);
    }, []);

    return (
        <main className='bg-background text-foreground flex min-h-screen flex-col items-center p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-8 md:pb-[calc(6rem+env(safe-area-inset-bottom))] lg:p-12'>
            <PasswordDialog
                isOpen={isPasswordDialogOpen}
                onOpenChange={setIsPasswordDialogOpen}
                onSave={handleSavePassword}
                title={passwordDialogContext === 'retry' ? t('password.required') : t('password.configure')}
                description={
                    passwordDialogContext === 'retry'
                        ? t('password.retryDescription')
                        : t('password.initialDescription')
                }
            />
            {isApiSettingsDialogOpen ? (
                <ApiSettingsDialog
                    isOpen={isApiSettingsDialogOpen}
                    onOpenChange={setIsApiSettingsDialogOpen}
                    settings={apiSettings}
                    onSave={handleSaveApiSettings}
                />
            ) : null}
            <div className='w-full max-w-screen-2xl space-y-6'>
                <AppControls onOpenApiSettings={() => setIsApiSettingsDialogOpen(true)} />
                <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
                    <div className='relative flex flex-col lg:col-span-1 lg:h-[70vh] lg:min-h-[600px]'>
                        <div className={mode === 'generate' ? 'block w-full lg:h-full' : 'hidden'}>
                            <GenerationForm
                                onSubmit={handleApiCall}
                                isLoading={isLoading}
                                currentMode={mode}
                                onModeChange={setMode}
                                isPasswordRequiredByBackend={isPasswordRequiredByBackend}
                                clientPasswordHash={clientPasswordHash}
                                onOpenPasswordDialog={handleOpenPasswordDialog}
                                model={genModel}
                                setModel={setGenModel}
                                prompt={genPrompt}
                                setPrompt={setGenPrompt}
                                n={genN}
                                setN={setGenN}
                                size={genSize}
                                setSize={setGenSize}
                                customWidth={genCustomWidth}
                                setCustomWidth={setGenCustomWidth}
                                customHeight={genCustomHeight}
                                setCustomHeight={setGenCustomHeight}
                                quality={genQuality}
                                setQuality={setGenQuality}
                                outputFormat={genOutputFormat}
                                setOutputFormat={setGenOutputFormat}
                                compression={genCompression}
                                setCompression={setGenCompression}
                                background={genBackground}
                                setBackground={setGenBackground}
                                moderation={genModeration}
                                setModeration={setGenModeration}
                                enableStreaming={enableStreaming}
                                setEnableStreaming={setEnableStreaming}
                                allowStreamingBatch={streamingBatchEnabled}
                                partialImages={partialImages}
                                setPartialImages={setPartialImages}
                            />
                        </div>
                        <div className={mode === 'edit' ? 'block w-full lg:h-full' : 'hidden'}>
                            <EditingForm
                                onSubmit={handleApiCall}
                                isLoading={isLoading || isSendingToEdit}
                                currentMode={mode}
                                onModeChange={setMode}
                                isPasswordRequiredByBackend={isPasswordRequiredByBackend}
                                clientPasswordHash={clientPasswordHash}
                                onOpenPasswordDialog={handleOpenPasswordDialog}
                                editModel={editModel}
                                setEditModel={setEditModel}
                                imageFiles={editImageFiles}
                                sourceImagePreviewUrls={editSourceImagePreviewUrls}
                                setImageFiles={setEditImageFiles}
                                setSourceImagePreviewUrls={setEditSourceImagePreviewUrls}
                                maxImages={MAX_EDIT_IMAGES}
                                editPrompt={editPrompt}
                                setEditPrompt={setEditPrompt}
                                editN={editN}
                                setEditN={setEditN}
                                editSize={editSize}
                                setEditSize={setEditSize}
                                editCustomWidth={editCustomWidth}
                                setEditCustomWidth={setEditCustomWidth}
                                editCustomHeight={editCustomHeight}
                                setEditCustomHeight={setEditCustomHeight}
                                editQuality={editQuality}
                                setEditQuality={setEditQuality}
                                editBrushSize={editBrushSize}
                                setEditBrushSize={setEditBrushSize}
                                editShowMaskEditor={editShowMaskEditor}
                                setEditShowMaskEditor={setEditShowMaskEditor}
                                editGeneratedMaskFile={editGeneratedMaskFile}
                                setEditGeneratedMaskFile={setEditGeneratedMaskFile}
                                editIsMaskSaved={editIsMaskSaved}
                                setEditIsMaskSaved={setEditIsMaskSaved}
                                editOriginalImageSize={editOriginalImageSize}
                                setEditOriginalImageSize={setEditOriginalImageSize}
                                editDrawnPoints={editDrawnPoints}
                                setEditDrawnPoints={setEditDrawnPoints}
                                editMaskPreviewUrl={editMaskPreviewUrl}
                                setEditMaskPreviewUrl={setEditMaskPreviewUrl}
                                enableStreaming={enableStreaming}
                                setEnableStreaming={setEnableStreaming}
                                allowStreamingBatch={streamingBatchEnabled}
                                partialImages={partialImages}
                                setPartialImages={setPartialImages}
                            />
                        </div>
                    </div>
                    <div
                        ref={outputPanelRef}
                        className='scroll-mt-4 flex min-h-[420px] flex-col lg:col-span-1 lg:h-[70vh] lg:min-h-[600px]'>
                        {error && (
                            <Alert variant='destructive' className='mb-4 border-red-500/50 bg-red-900/20 text-red-300'>
                                <AlertTitle className='text-red-200'>{t('common.error')}</AlertTitle>
                                <AlertDescription>{renderErrorDescription(error)}</AlertDescription>
                            </Alert>
                        )}
                        <ImageOutput
                            imageBatch={latestImageBatch}
                            viewMode={imageOutputView}
                            onViewChange={setImageOutputView}
                            altText={t('output.alt')}
                            isLoading={isLoading || isSendingToEdit}
                            onSendToEdit={handleSendToEdit}
                            currentMode={mode}
                            baseImagePreviewUrl={editSourceImagePreviewUrls[0] || null}
                            streamingPreviewImages={streamingPreviewImages}
                            clientPasswordHash={clientPasswordHash}
                            canOpenLogs={canOpenLogs}
                            openLogsSignal={openLogsSignal}
                            logClientRequestIds={activeLogClientRequestIds}
                            logFilenames={activeLogFilenames}
                        />
                    </div>
                </div>

                <div className='min-h-[450px]'>
                    <HistoryPanel
                        history={history}
                        onSelectImage={handleHistorySelect}
                        onClearHistory={handleClearHistory}
                        getImageSrc={getImageSrc}
                        onDeleteItemRequest={handleRequestDeleteItem}
                        itemPendingDeleteConfirmation={itemToDeleteConfirm}
                        onConfirmDeletion={handleConfirmDeletion}
                        onCancelDeletion={handleCancelDeletion}
                        deletePreferenceDialogValue={dialogCheckboxStateSkipConfirm}
                        onDeletePreferenceDialogChange={setDialogCheckboxStateSkipConfirm}
                    />
                </div>
            </div>
            <div className='bg-background/92 border-border fixed right-0 bottom-0 left-0 z-40 border-t p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden supports-[backdrop-filter]:bg-background/85'>
                <div className='mx-auto grid max-w-screen-sm grid-cols-[1fr_auto_auto] gap-2'>
                    <Button
                        type='button'
                        onClick={handleMobilePrimaryAction}
                        disabled={mobilePrimaryDisabled}
                        className='bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground'>
                        {(isLoading || isSendingToEdit) && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                        {mode === 'generate'
                            ? isLoading
                                ? t('generate.loading')
                                : t('generate.submit')
                            : isLoading || isSendingToEdit
                              ? t('edit.loading')
                              : t('edit.submit')}
                    </Button>
                    <Button
                        type='button'
                        variant='outline'
                        size='icon'
                        onClick={scrollToOutput}
                        className='text-muted-foreground hover:text-foreground'
                        aria-label={t('ux.jumpToResult')}>
                        <ArrowDown className='h-4 w-4' />
                    </Button>
                    {canOpenLogs && (
                        <Button
                            type='button'
                            variant='outline'
                            size='icon'
                            onClick={() => setOpenLogsSignal((value) => value + 1)}
                            className='text-muted-foreground hover:text-foreground'
                            aria-label={t('logs.open')}>
                            <Terminal className='h-4 w-4' />
                        </Button>
                    )}
                </div>
            </div>
        </main>
    );
}

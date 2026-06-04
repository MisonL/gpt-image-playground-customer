'use client';

import { ApiSettingsDialog, type ApiSettings } from '@/components/api-settings-dialog';
import { EditingForm, type EditingFormData, type EditingReuseContext } from '@/components/editing-form';
import { GenerationForm, type GenerationFormData, type WorkbenchReuseContext } from '@/components/generation-form';
import { HistoryPanel, type InspirationItem, type PromptApplySource } from '@/components/history-panel';
import { ImageOutput } from '@/components/image-output';
import type { WorkbenchMode } from '@/components/mode-toggle';
import { PasswordDialog } from '@/components/password-dialog';
import { ShareDialog, type ShareDialogValues } from '@/components/share-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { WorkbenchProDock } from '@/components/workbench-pro-dock';
import { WorkbenchStatusStrip } from '@/components/workbench-status-strip';
import {
    buildApiErrorNotice,
    buildBatchPartialFailureMessage,
    buildUserFacingApiErrorMessage,
    type ApiErrorNotice
} from '@/lib/api-error-guidance';
import { formatBatchPromptHistory, readBatchPromptLines } from '@/lib/batch-prompts';
import { db, type ImageRecord } from '@/lib/db';
import {
    advanceGenerationBatchProgress,
    buildGenerationActivityItems,
    collectFailedBatchPrompts,
    countCompletedBatchResults,
    type GenerationBatchProgress
} from '@/lib/generation-activity';
import { resolveHistoryCompareImage } from '@/lib/history-compare';
import {
    buildCompletedHistoryEntry,
    buildFailedHistoryEntry,
    buildHistoryGenerationFormData,
    readHistoryImageCountSelection,
    readHistorySizeSelection,
    resolveHistoryImageClientRequestId,
    uniqueStrings,
    type HistoryMetadata,
    type RequestMode
} from '@/lib/history-metadata';
import { useI18n } from '@/lib/i18n';
import {
    IMAGE_UPSTREAM_FORM_SERVER_DEFAULT,
    appendImageUpstreamOverrideFields,
    isResponsesImageBackendRuntimeEnabled,
    normalizeImageUpstreamRuntimeFields,
    shouldAllowResponsesHistoryRoute,
    shouldBlockResponsesRequestWithoutModel,
    shouldBlockExplicitResponsesRequest,
    type ImageUpstreamFormBackend
} from '@/lib/image-upstream-form';
import type { ImageStreamMode, ImageStreamingStrategy } from '@/lib/image-upstream-strategy';
import { resolveMobileCreationSheetGesture } from '@/lib/mobile-creation-sheet-gesture';
import { resolveMobilePrimaryDisabledReason } from '@/lib/mobile-primary-action-state';
import { hasPreservedDisplayedAuthError, isPagePasswordAuthErrorCode } from '@/lib/page-password-auth';
import { sha256Hex } from '@/lib/sha256';
import { createImageShareFromBlob } from '@/lib/share-client';
import { getPresetDimensions, validateGptImage2Size } from '@/lib/size-utils';
import {
    applyStreamingClientEvent,
    BatchPausedError,
    buildStreamingBatchJobs,
    canUseStreamingBatchTransport,
    resolveStreamingBatchCapacity,
    resolveStreamingBatchToggleState,
    scheduleStreamingBatch,
    shouldUseStreamingBatch,
    type ApiImageResponseItem,
    type StreamingBatchJob,
    type StreamingClientEvent,
    type StreamingClientState
} from '@/lib/streaming-batch';
import { getStreamingStatusLabel } from '@/lib/streaming-status-label';
import type { ActualCostDetails } from '@/lib/upstream-cost/resolve';
import { formatEstimatedCredits } from '@/lib/workbench-cost-label';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowUp, Flower2, HelpCircle, Loader2, Lock, Pause, PenLine, Settings2, Activity, X } from 'lucide-react';
import * as React from 'react';

type DrawnPoint = {
    x: number;
    y: number;
    size: number;
};

type MobileDrawerPointerStart = {
    x: number;
    y: number;
};

const MAX_EDIT_IMAGES = 10;
const apiSettingsLocalStorageKey = 'openaiImageApiSettings';
const inspirationsLocalStorageKey = 'openaiImageInspirations';
const emptyApiSettings: ApiSettings = { apiKey: '', baseUrl: '' };
const sseEventDelimiterPattern = /\r?\n\r?\n/;
type ApiCallRetryArgs = [GenerationFormData | EditingFormData, RequestMode, ImageStreamMode, 1 | 2 | 3, boolean];
type PasswordVerificationResult = 'valid' | 'invalid' | 'unavailable';

function getImageBackendLabel(backend: ImageUpstreamFormBackend, t: (key: string) => string): string {
    if (backend === 'images-api') return t('upstream.backendImages');
    if (backend === 'responses-image-generation') return t('upstream.backendResponses');
    return t('upstream.workbenchDefaultRoute');
}

function createClientRequestId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `web-${crypto.randomUUID()}`;
    }
    return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

type StoredInspirationsReadResult = {
    items: InspirationItem[];
    shouldPersist: boolean;
    shouldRemove: boolean;
};

function readStoredInspirations(): StoredInspirationsReadResult {
    const storedInspirations = readLocalStorageValue(inspirationsLocalStorageKey);
    if (!storedInspirations) {
        return { items: [], shouldPersist: false, shouldRemove: false };
    }
    try {
        const parsedInspirations: unknown = JSON.parse(storedInspirations);
        if (!Array.isArray(parsedInspirations)) {
            return { items: [], shouldPersist: false, shouldRemove: true };
        }
        const validInspirations = parsedInspirations.filter(
            (item): item is InspirationItem =>
                item !== null &&
                typeof item === 'object' &&
                typeof (item as InspirationItem).id === 'number' &&
                typeof (item as InspirationItem).prompt === 'string' &&
                typeof (item as InspirationItem).createdAt === 'number'
        );
        const migratedInspirations = validInspirations.filter((item) => !(item.id < 0 && item.createdAt === 0));
        return {
            items: migratedInspirations,
            shouldPersist: migratedInspirations.length !== parsedInspirations.length,
            shouldRemove: false
        };
    } catch (error) {
        console.error('加载或解析灵感相册失败：', error);
        return { items: [], shouldPersist: false, shouldRemove: true };
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
    storageMode?: HistoryMetadata['storageModeUsed'];
};

type ImageStorageMode = NonNullable<HistoryMetadata['storageModeUsed']>;

type ApiUsage = {
    input_tokens_details?: {
        text_tokens?: number;
        image_tokens?: number;
    };
    output_tokens?: number;
};

type RuntimeCapabilities = {
    streaming?: {
        defaultMode?: ImageStreamMode;
        defaultStrategy?: ImageStreamingStrategy;
    };
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
    responsesImageBackend?: {
        enabled: boolean;
        mode?: 'experimental';
        requiredEnv?: string[];
        optionalEnv?: string[];
        hasDefaultModel?: boolean;
        missingEnv?: string[];
    };
};

class ApiRequestError extends Error {
    readonly status?: number;
    readonly preserveDisplayedError: boolean;

    constructor(message: string, status?: number, options: { preserveDisplayedError?: boolean } = {}) {
        super(message);
        this.name = 'ApiRequestError';
        this.status = status;
        this.preserveDisplayedError = options.preserveDisplayedError === true;
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
                    className='border-destructive/45 text-destructive hover:bg-destructive/10 w-fit rounded-md border px-2 py-1 font-medium underline-offset-2 hover:underline'
                    href={link.url}
                    key={link.url}
                    rel='noreferrer'
                    target='_blank'>
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
    const { locale, t } = useI18n();
    const createErrorNotice = React.useCallback((message: string) => buildApiErrorNotice(message), []);
    const [mode, setMode] = React.useState<'generate' | 'edit'>('generate');
    const [workbenchMode, setWorkbenchMode] = React.useState<WorkbenchMode>('generate');
    const [reuseContext, setReuseContext] = React.useState<WorkbenchReuseContext | null>(null);
    const [editReuseContext, setEditReuseContext] = React.useState<EditingReuseContext | null>(null);
    const [isPasswordRequiredByBackend, setIsPasswordRequiredByBackend] = React.useState<boolean | null>(null);
    const [clientPasswordHash, setClientPasswordHash] = React.useState<string | null>(null);
    const [isEntryAuthenticated, setIsEntryAuthenticated] = React.useState(false);
    const [isLoading, setIsLoading] = React.useState(false);
    const [isSendingToEdit, setIsSendingToEdit] = React.useState(false);
    const [error, setError] = React.useState<ApiErrorNotice | null>(null);
    const [generationFailureMessage, setGenerationFailureMessage] = React.useState<string | null>(null);
    const [failedBatchPrompts, setFailedBatchPrompts] = React.useState<string[]>([]);
    const [latestImageBatch, setLatestImageBatch] = React.useState<ApiImageResult[] | null>(null);
    const [activeResultSource, setActiveResultSource] = React.useState<HistoryMetadata | null>(null);
    const [completedGenerationCount, setCompletedGenerationCount] = React.useState<number | null>(null);
    const [imageOutputView, setImageOutputView] = React.useState<'grid' | number>('grid');
    const [history, setHistory] = React.useState<HistoryMetadata[]>([]);
    const [inspirations, setInspirations] = React.useState<InspirationItem[]>([]);
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
    const [shareDialogOpen, setShareDialogOpen] = React.useState(false);
    const [shareTargetFilename, setShareTargetFilename] = React.useState<string | null>(null);
    const [shareTargetStorageMode, setShareTargetStorageMode] = React.useState<HistoryMetadata['storageModeUsed']>();
    const [shareUrl, setShareUrl] = React.useState<string | null>(null);
    const [shareError, setShareError] = React.useState<string | null>(null);
    const [isCreatingShare, setIsCreatingShare] = React.useState(false);
    const [isMobileCreationDrawerOpen, setIsMobileCreationDrawerOpen] = React.useState(false);
    const outputPanelRef = React.useRef<HTMLDivElement | null>(null);
    const mobileCreationDrawerCloseButtonRef = React.useRef<HTMLButtonElement | null>(null);
    const mobileDrawerPointerStartRef = React.useRef<MobileDrawerPointerStart | null>(null);
    const mobileDrawerGestureHandledAtRef = React.useRef(0);

    const allDbImages = useLiveQuery<ImageRecord[] | undefined>(() => db.images.toArray(), []);

    const [editImageFiles, setEditImageFiles] = React.useState<File[]>([]);
    const [editSourceImagePreviewUrls, setEditSourceImagePreviewUrlsState] = React.useState<string[]>([]);
    const editSourceImagePreviewUrlsRef = React.useRef<string[]>([]);
    const updateEditSourceImagePreviewUrls = React.useCallback((nextUrls: string[]) => {
        const nextUrlSet = new Set(nextUrls);
        editSourceImagePreviewUrlsRef.current.forEach((url) => {
            if (!nextUrlSet.has(url)) {
                URL.revokeObjectURL(url);
            }
        });
        editSourceImagePreviewUrlsRef.current = nextUrls;
        setEditSourceImagePreviewUrlsState(nextUrls);
    }, []);
    const [editPrompt, setEditPrompt] = React.useState('');
    const [editN, setEditN] = React.useState([1]);
    const [editSize, setEditSize] = React.useState<EditingFormData['size']>('auto');
    const [editCustomWidth, setEditCustomWidth] = React.useState<number>(1024);
    const [editCustomHeight, setEditCustomHeight] = React.useState<number>(1024);
    const [editQuality, setEditQuality] = React.useState<EditingFormData['quality']>('auto');
    const [editOutputFormat, setEditOutputFormat] = React.useState<EditingFormData['output_format']>('png');
    const [editCompression, setEditCompression] = React.useState([100]);
    const [editModeration, setEditModeration] = React.useState<EditingFormData['moderation']>('auto');
    const [editBrushSize, setEditBrushSize] = React.useState([20]);
    const [editShowMaskEditor, setEditShowMaskEditor] = React.useState(false);
    const [editGeneratedMaskFile, setEditGeneratedMaskFile] = React.useState<File | null>(null);
    const [editIsMaskSaved, setEditIsMaskSaved] = React.useState(false);
    const [editOriginalImageSize, setEditOriginalImageSize] = React.useState<{ width: number; height: number } | null>(
        null
    );
    const [editDrawnPoints, setEditDrawnPoints] = React.useState<DrawnPoint[]>([]);
    const [editMaskPreviewUrl, setEditMaskPreviewUrl] = React.useState<string | null>(null);
    const [editImageBackend, setEditImageBackend] = React.useState<EditingFormData['image_backend']>(
        IMAGE_UPSTREAM_FORM_SERVER_DEFAULT
    );
    const [editStreamingStrategy, setEditStreamingStrategy] = React.useState<EditingFormData['streaming_strategy']>(
        IMAGE_UPSTREAM_FORM_SERVER_DEFAULT
    );
    const [editResponsesModel, setEditResponsesModel] = React.useState('');
    const [editThinking, setEditThinking] = React.useState<EditingFormData['thinking']>(
        IMAGE_UPSTREAM_FORM_SERVER_DEFAULT
    );
    const [editPromptOptimization, setEditPromptOptimization] = React.useState<EditingFormData['promptOptimization']>(
        IMAGE_UPSTREAM_FORM_SERVER_DEFAULT
    );
    const [editForceWeb, setEditForceWeb] = React.useState(false);

    const [genModel, setGenModel] = React.useState<GenerationFormData['model']>('gpt-image-2');
    const [genPrompt, setGenPrompt] = React.useState('');
    const [genBatchPromptText, setGenBatchPromptText] = React.useState('');
    const [genN, setGenN] = React.useState([1]);
    const [genSize, setGenSize] = React.useState<GenerationFormData['size']>('auto');
    const [genCustomWidth, setGenCustomWidth] = React.useState<number>(1024);
    const [genCustomHeight, setGenCustomHeight] = React.useState<number>(1024);
    const [genQuality, setGenQuality] = React.useState<GenerationFormData['quality']>('high');
    const [genOutputFormat, setGenOutputFormat] = React.useState<GenerationFormData['output_format']>('png');
    const [genCompression, setGenCompression] = React.useState([100]);
    const [genBackground, setGenBackground] = React.useState<GenerationFormData['background']>('auto');
    const [genModeration, setGenModeration] = React.useState<GenerationFormData['moderation']>('auto');
    const [genImageBackend, setGenImageBackend] = React.useState<GenerationFormData['image_backend']>(
        IMAGE_UPSTREAM_FORM_SERVER_DEFAULT
    );
    const [genStreamingStrategy, setGenStreamingStrategy] = React.useState<GenerationFormData['streaming_strategy']>(
        IMAGE_UPSTREAM_FORM_SERVER_DEFAULT
    );
    const [genResponsesModel, setGenResponsesModel] = React.useState('');
    const [genThinking, setGenThinking] = React.useState<GenerationFormData['thinking']>(
        IMAGE_UPSTREAM_FORM_SERVER_DEFAULT
    );
    const [genPromptOptimization, setGenPromptOptimization] = React.useState<GenerationFormData['promptOptimization']>(
        IMAGE_UPSTREAM_FORM_SERVER_DEFAULT
    );
    const [genForceWeb, setGenForceWeb] = React.useState(false);

    const [editModel, setEditModel] = React.useState<EditingFormData['model']>('gpt-image-2');

    // 流式状态，由生成和编辑模式共用。
    const [streamMode, setStreamMode] = React.useState<ImageStreamMode>('auto');
    const [partialImages, setPartialImages] = React.useState<1 | 2 | 3>(1);
    const [enableParallelBatch, setEnableParallelBatch] = React.useState(false);
    const [activeRequestStreaming, setActiveRequestStreaming] = React.useState(false);
    // 流式预览图，存储流式过程中的局部图片 base64 data URL。
    const [streamingPreviewImages, setStreamingPreviewImages] = React.useState<Map<number, string>>(new Map());
    const [batchProgress, setBatchProgress] = React.useState<GenerationBatchProgress | null>(null);
    const [isBatchPauseRequested, setIsBatchPauseRequested] = React.useState(false);
    const batchPauseRequestedRef = React.useRef(false);
    const defaultStreamingStrategy = runtimeCapabilities?.streaming?.defaultStrategy ?? 'auto';
    const allowResponsesImageBackend = isResponsesImageBackendRuntimeEnabled(runtimeCapabilities ?? {});
    const allowResponsesHistoryRoute = shouldAllowResponsesHistoryRoute({
        runtimeCapabilitiesAvailable: runtimeCapabilities !== null,
        allowResponsesImageBackend
    });
    const hasDefaultResponsesModel = runtimeCapabilities?.responsesImageBackend?.hasDefaultModel === true;
    const streamingBatchCapacity = resolveStreamingBatchCapacity({
        featureEnabled: runtimeCapabilities?.streamingBatch.enabled === true,
        hasRequestApiKey: apiSettings.apiKey.trim().length > 0,
        requestCredentialConcurrency: runtimeCapabilities?.streamingBatch.requestCredentialConcurrency ?? 1,
        serverRecommendedConcurrency: runtimeCapabilities?.streamingBatch.recommendedConcurrency ?? 0
    });
    const streamingBatchEnabled = streamingBatchCapacity.enabled;
    const isPromptBatchMode = mode === 'generate' && workbenchMode === 'batch';
    const currentPrompt =
        mode === 'generate' && workbenchMode === 'batch'
            ? genBatchPromptText
            : mode === 'generate'
              ? genPrompt
              : editPrompt;
    const hasEditSourceImage = editImageFiles.length > 0;
    const currentGenerateSizeValidation =
        genSize === 'custom' ? validateGptImage2Size(genCustomWidth, genCustomHeight) : { valid: true as const };
    const currentEditSizeValidation =
        editSize === 'custom' ? validateGptImage2Size(editCustomWidth, editCustomHeight) : { valid: true as const };
    const canOpenLogs = isPasswordRequiredByBackend === true && !!clientPasswordHash;
    const usesEditControls = workbenchMode === 'edit';
    const activeWorkbenchModel = usesEditControls ? editModel : genModel;
    const activeWorkbenchBackend = usesEditControls ? editImageBackend : genImageBackend;
    const activeWorkbenchStreamingStrategy = usesEditControls ? editStreamingStrategy : genStreamingStrategy;
    const activeEffectiveStreamingStrategy =
        activeWorkbenchStreamingStrategy === IMAGE_UPSTREAM_FORM_SERVER_DEFAULT
            ? defaultStreamingStrategy
            : activeWorkbenchStreamingStrategy;
    const activeWorkbenchBackendLabel = getImageBackendLabel(activeWorkbenchBackend, t);
    const activeTaskCount =
        mode === 'generate' && workbenchMode === 'batch'
            ? readBatchPromptLines(genBatchPromptText).length
            : mode === 'generate'
              ? genN[0]
              : editN[0];
    const activeEstimatedCostLabel = t('workbench.estimatedCost', {
        credits: formatEstimatedCredits(activeTaskCount)
    });
    const activeParallelBatchVisible = resolveStreamingBatchToggleState({
        allowStreamingBatch: streamingBatchEnabled,
        userEnabled: enableParallelBatch,
        targetCount: activeTaskCount,
        streamMode,
        streamingStrategy: activeEffectiveStreamingStrategy
    }).checked;
    const mobileCanSaveInspiration = !isLoading && !isSendingToEdit && currentPrompt.trim().length > 0;
    const hasRandomInspirationPrompt = inspirations.some((item) => item.prompt.trim().length > 0);
    const pickRandomInspirationPrompt = React.useCallback(() => {
        const savedPrompts = inspirations.map((item) => item.prompt.trim()).filter((prompt) => prompt.length > 0);
        if (savedPrompts.length === 0) return '';
        return savedPrompts[Math.floor(Math.random() * savedPrompts.length)] ?? '';
    }, [inspirations]);

    React.useEffect(() => {
        if (allowResponsesImageBackend || runtimeCapabilities === null) return;
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            setGenImageBackend((current) =>
                current === 'responses-image-generation' ? IMAGE_UPSTREAM_FORM_SERVER_DEFAULT : current
            );
            setEditImageBackend((current) =>
                current === 'responses-image-generation' ? IMAGE_UPSTREAM_FORM_SERVER_DEFAULT : current
            );
            setGenStreamingStrategy((current) =>
                current === 'responses-sse' ? IMAGE_UPSTREAM_FORM_SERVER_DEFAULT : current
            );
            setEditStreamingStrategy((current) =>
                current === 'responses-sse' ? IMAGE_UPSTREAM_FORM_SERVER_DEFAULT : current
            );
            setGenResponsesModel('');
            setEditResponsesModel('');
            setGenThinking(IMAGE_UPSTREAM_FORM_SERVER_DEFAULT);
            setEditThinking(IMAGE_UPSTREAM_FORM_SERVER_DEFAULT);
            setGenPromptOptimization(IMAGE_UPSTREAM_FORM_SERVER_DEFAULT);
            setEditPromptOptimization(IMAGE_UPSTREAM_FORM_SERVER_DEFAULT);
        });
        return () => {
            cancelled = true;
        };
    }, [allowResponsesImageBackend, runtimeCapabilities]);
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
    const generationActivityItems = React.useMemo(
        () =>
            buildGenerationActivityItems({
                isLoading,
                isSendingToEdit,
                mode,
                streamingPreviewCount: streamingPreviewImages.size,
                errorMessage: error?.message,
                completedGenerationCount,
                batchProgress,
                t
            }),
        [
            batchProgress,
            completedGenerationCount,
            error?.message,
            isLoading,
            isSendingToEdit,
            mode,
            streamingPreviewImages.size,
            t
        ]
    );
    const mobilePrimaryDisabledReason = resolveMobilePrimaryDisabledReason({
        isLoading,
        isSendingToEdit,
        mode,
        isBatchMode: workbenchMode === 'batch',
        prompt: currentPrompt,
        batchPromptCount: workbenchMode === 'batch' ? readBatchPromptLines(genBatchPromptText).length : 0,
        hasEditSourceImage,
        hasUnsavedMask: editDrawnPoints.length > 0 && !editGeneratedMaskFile && !editIsMaskSaved,
        imageBackend: mode === 'generate' ? genImageBackend : editImageBackend,
        responsesModel: mode === 'generate' ? genResponsesModel : editResponsesModel,
        hasDefaultResponsesModel,
        generateSizeValidation: currentGenerateSizeValidation,
        editSizeValidation: currentEditSizeValidation,
        t
    });
    const mobilePrimaryDisabled = isLoading || isSendingToEdit || Boolean(mobilePrimaryDisabledReason);
    const currentResultPrompt = activeResultSource?.prompt.trim() || currentPrompt.trim();
    const canCreateResultVariant = !isLoading && Boolean(latestImageBatch) && Boolean(currentResultPrompt);
    const canReuseResultPrompt = Boolean(currentResultPrompt);
    const canPausePromptBatch = isLoading && isPromptBatchMode && Boolean(batchProgress);

    const handleBatchPromptTextChange = React.useCallback((nextText: React.SetStateAction<string>) => {
        setGenBatchPromptText(nextText);
        setFailedBatchPrompts([]);
    }, []);

    const handlePauseBatch = React.useCallback(() => {
        batchPauseRequestedRef.current = true;
        setIsBatchPauseRequested(true);
    }, []);

    const handleWorkbenchModeChange = React.useCallback(
        (nextMode: WorkbenchMode) => {
            setWorkbenchMode(nextMode);
            if (nextMode !== 'reuse') {
                setReuseContext(null);
            }
            if (nextMode !== 'edit') {
                setEditReuseContext(null);
            }
            if (nextMode === 'edit') {
                setMode('edit');
                return;
            }
            if (nextMode === 'batch') {
                setGenN([1]);
                setGenBatchPromptText((current) => (current.trim() ? current : genPrompt));
            }
            setMode('generate');
        },
        [genPrompt]
    );

    const scrollToOutput = React.useCallback(() => {
        const outputTop = outputPanelRef.current?.getBoundingClientRect().top;
        if (typeof outputTop !== 'number') return;
        window.scrollTo({
            top: window.scrollY + outputTop - 12,
            behavior: 'smooth'
        });
    }, []);

    const blurActiveMobileTrigger = React.useCallback(() => {
        if (typeof document === 'undefined') return;
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
    }, []);

    const openMobileCreationDrawer = React.useCallback(() => {
        blurActiveMobileTrigger();
        setIsMobileCreationDrawerOpen(true);
    }, [blurActiveMobileTrigger]);

    const closeMobileCreationDrawer = React.useCallback(() => {
        blurActiveMobileTrigger();
        setIsMobileCreationDrawerOpen(false);
    }, [blurActiveMobileTrigger]);

    const toggleMobileCreationDrawer = React.useCallback(() => {
        setIsMobileCreationDrawerOpen((isOpen) => {
            if (!isOpen) {
                blurActiveMobileTrigger();
            }
            return !isOpen;
        });
    }, [blurActiveMobileTrigger]);

    const beginMobileCreationDrawerGesture = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        mobileDrawerPointerStartRef.current = {
            x: event.clientX,
            y: event.clientY
        };
    }, []);

    const finishMobileCreationDrawerGesture = React.useCallback(
        (event: React.PointerEvent<HTMLElement>) => {
            const start = mobileDrawerPointerStartRef.current;
            mobileDrawerPointerStartRef.current = null;
            if (!start) return;

            const gesture = resolveMobileCreationSheetGesture({
                startX: start.x,
                startY: start.y,
                currentX: event.clientX,
                currentY: event.clientY
            });
            if (gesture === 'open') {
                mobileDrawerGestureHandledAtRef.current = Date.now();
                openMobileCreationDrawer();
            } else if (gesture === 'close') {
                mobileDrawerGestureHandledAtRef.current = Date.now();
                closeMobileCreationDrawer();
            }
        },
        [closeMobileCreationDrawer, openMobileCreationDrawer]
    );

    const cancelMobileCreationDrawerGesture = React.useCallback(() => {
        mobileDrawerPointerStartRef.current = null;
    }, []);

    const handleMobileCreationDrawerHandleClick = React.useCallback(() => {
        if (Date.now() - mobileDrawerGestureHandledAtRef.current < 500) {
            mobileDrawerGestureHandledAtRef.current = 0;
            return;
        }
        toggleMobileCreationDrawer();
    }, [toggleMobileCreationDrawer]);

    React.useEffect(() => {
        if (!isMobileCreationDrawerOpen || typeof document === 'undefined') return;

        const previousBodyOverflow = document.body.style.overflow;
        const previousHtmlOverflow = document.documentElement.style.overflow;
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = previousBodyOverflow;
            document.documentElement.style.overflow = previousHtmlOverflow;
        };
    }, [isMobileCreationDrawerOpen]);

    React.useEffect(() => {
        if (!isMobileCreationDrawerOpen) return;

        requestAnimationFrame(() => {
            mobileCreationDrawerCloseButtonRef.current?.focus();
        });
    }, [isMobileCreationDrawerOpen]);

    React.useEffect(() => {
        if (!isMobileCreationDrawerOpen || typeof window === 'undefined') return;

        const desktopMediaQuery = window.matchMedia('(min-width: 1024px)');
        const closeDrawerOnDesktop = () => {
            if (desktopMediaQuery.matches) {
                setIsMobileCreationDrawerOpen(false);
            }
        };

        closeDrawerOnDesktop();
        desktopMediaQuery.addEventListener('change', closeDrawerOnDesktop);
        return () => {
            desktopMediaQuery.removeEventListener('change', closeDrawerOnDesktop);
        };
    }, [isMobileCreationDrawerOpen]);

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
    const historyCompareImage = React.useMemo(
        () =>
            resolveHistoryCompareImage({
                history,
                currentFilenames: latestImageBatch?.map((image) => image.filename) ?? [],
                getIndexedDbImageSrc: getImageSrc
            }),
        [getImageSrc, history, latestImageBatch]
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
            const storedInspirations = readStoredInspirations();
            setInspirations(storedInspirations.items);
            if (storedInspirations.shouldRemove) {
                window.localStorage.removeItem(inspirationsLocalStorageKey);
            } else if (storedInspirations.shouldPersist) {
                window.localStorage.setItem(inspirationsLocalStorageKey, JSON.stringify(storedInspirations.items));
            }
            hasLoadedStoredHistoryRef.current = true;
        });
    }, []);

    React.useEffect(() => {
        editSourceImagePreviewUrlsRef.current = editSourceImagePreviewUrls;
    }, [editSourceImagePreviewUrls]);

    const verifyEntryPasswordHash = React.useCallback(
        async (passwordHash: string): Promise<PasswordVerificationResult> => {
            try {
                const response = await fetch('/api/auth-verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ passwordHash })
                });

                if (response.ok) {
                    return 'valid';
                }
                if (response.status === 401) {
                    try {
                        const result = (await response.json()) as { code?: string };
                        return isPagePasswordAuthErrorCode(result.code) ? 'invalid' : 'unavailable';
                    } catch {
                        return 'unavailable';
                    }
                }
                return 'unavailable';
            } catch (error) {
                console.error('验证入口访问码失败：', error);
                return 'unavailable';
            }
        },
        []
    );

    const promptForExpiredPassword = React.useCallback(() => {
        localStorage.removeItem('clientPasswordHash');
        setClientPasswordHash(null);
        setIsEntryAuthenticated(false);
        setPasswordDialogContext('retry');
        setIsPasswordDialogOpen(true);
        setError(createErrorNotice(t('error.passwordExpired')));
    }, [createErrorNotice, t]);

    const refreshImageAccessCookie = React.useCallback(
        async (passwordHash = clientPasswordHash): Promise<boolean> => {
            if (!isPasswordRequiredByBackend) {
                return true;
            }
            if (!passwordHash) {
                promptForExpiredPassword();
                return false;
            }

            const verificationResult = await verifyEntryPasswordHash(passwordHash);
            if (verificationResult === 'valid') {
                setIsEntryAuthenticated(true);
                return true;
            }
            if (verificationResult === 'unavailable') {
                setError(createErrorNotice(t('error.authVerifyUnavailable')));
                return false;
            }

            promptForExpiredPassword();
            return false;
        },
        [
            clientPasswordHash,
            createErrorNotice,
            isPasswordRequiredByBackend,
            promptForExpiredPassword,
            t,
            verifyEntryPasswordHash
        ]
    );

    React.useEffect(() => {
        const fetchAuthStatus = async () => {
            try {
                const response = await fetch('/api/auth-status');
                if (!response.ok) {
                    throw new Error('获取鉴权状态失败');
                }
                const data = await response.json();
                const passwordRequired = Boolean(data.passwordRequired);
                setIsPasswordRequiredByBackend(passwordRequired);

                const storedPasswordHash = readLocalStorageValue('clientPasswordHash');
                if (!passwordRequired) {
                    setClientPasswordHash(storedPasswordHash);
                    setIsEntryAuthenticated(true);
                    return;
                }

                if (storedPasswordHash) {
                    const storedVerificationResult = await verifyEntryPasswordHash(storedPasswordHash);
                    if (storedVerificationResult === 'valid') {
                        setClientPasswordHash(storedPasswordHash);
                        setIsEntryAuthenticated(true);
                        return;
                    }
                    if (storedVerificationResult === 'unavailable') {
                        setClientPasswordHash(storedPasswordHash);
                        setPasswordDialogContext('retry');
                        setIsEntryAuthenticated(false);
                        setError(createErrorNotice(t('error.authVerifyUnavailable')));
                        return;
                    }
                }

                localStorage.removeItem('clientPasswordHash');
                setClientPasswordHash(null);
                setPasswordDialogContext('initial');
                setIsEntryAuthenticated(false);
            } catch (error) {
                console.error('获取鉴权状态失败：', error);
                setIsPasswordRequiredByBackend(false);
                setIsEntryAuthenticated(true);
            }
        };

        fetchAuthStatus();
        queueMicrotask(() => {
            setApiSettings(readStoredApiSettings());
        });
    }, [createErrorNotice, t, verifyEntryPasswordHash]);

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
        if (!hasLoadedStoredHistoryRef.current) return;
        try {
            localStorage.setItem(inspirationsLocalStorageKey, JSON.stringify(inspirations));
        } catch (e) {
            console.error('保存灵感相册到 localStorage 失败：', e);
        }
    }, [inspirations]);

    React.useEffect(() => {
        return () => {
            editSourceImagePreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
            editSourceImagePreviewUrlsRef.current = [];
        };
    }, []);

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
                        updateEditSourceImagePreviewUrls([...editSourceImagePreviewUrlsRef.current, previewUrl]);

                        break;
                    }
                }
            }
        };

        window.addEventListener('paste', handlePaste);

        return () => {
            window.removeEventListener('paste', handlePaste);
        };
    }, [mode, editImageFiles.length, t, updateEditSourceImagePreviewUrls]);

    const handleSavePassword = async (password: string) => {
        if (!password.trim()) {
            setError(createErrorNotice(t('password.empty')));
            return;
        }
        try {
            const hash = await sha256Hex(password);
            const passwordVerificationResult = isPasswordRequiredByBackend
                ? await verifyEntryPasswordHash(hash)
                : 'valid';
            if (passwordVerificationResult === 'unavailable') {
                setError(createErrorNotice(t('error.authVerifyUnavailable')));
                return;
            }
            if (passwordVerificationResult === 'invalid') {
                localStorage.removeItem('clientPasswordHash');
                setClientPasswordHash(null);
                setIsEntryAuthenticated(false);
                setError(createErrorNotice(t('error.unauthorized')));
                setIsPasswordDialogOpen(true);
                return;
            }

            localStorage.setItem('clientPasswordHash', hash);
            setClientPasswordHash(hash);
            setIsEntryAuthenticated(true);
            setError(null);
            setIsPasswordDialogOpen(false);
            if (passwordDialogContext === 'retry' && lastApiCallArgs) {
                const retryArgs = lastApiCallArgs;
                setLastApiCallArgs(null);
                await handleApiCall(...retryArgs, hash);
            }
        } catch (e) {
            console.error('计算访问码哈希失败：', e);
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
                        return {
                            filename: img.filename,
                            path: blobUrl,
                            ...(img.clientRequestId ? { clientRequestId: img.clientRequestId } : {})
                        };
                    })
                );
                return indexedDbImages;
            }

            const fsImages = images
                .filter((img) => !!img.path)
                .map((img) => ({
                    path: img.path!,
                    filename: img.filename,
                    ...(img.clientRequestId ? { clientRequestId: img.clientRequestId } : {})
                }));
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
            formData: GenerationFormData | EditingFormData,
            requestMode: RequestMode,
            clearStreaming = false,
            promptOverride?: string
        ) => {
            if (images.length === 0) {
                throw new Error(t('error.noImages'));
            }

            const processedImages = await materializeImages(images);
            const processedImagesWithStorage = processedImages.map((image) => ({
                ...image,
                storageMode: effectiveStorageModeClient
            }));
            setLatestImageBatch(processedImagesWithStorage);
            setCompletedGenerationCount(processedImages.length);
            setImageOutputView(processedImages.length > 1 ? 'grid' : 0);
            if (clearStreaming) {
                setStreamingPreviewImages(new Map());
            }
            const historyEntry = buildCompletedHistoryEntry({
                images,
                usage,
                actualCost,
                durationMs: durationMsValue,
                formData,
                requestMode,
                storageMode: effectiveStorageModeClient,
                promptOverride
            });
            setActiveResultSource(historyEntry);
            setHistory((prevHistory) => [historyEntry, ...prevHistory]);
        },
        [materializeImages, t]
    );

    const buildApiFormData = React.useCallback(
        (
            formData: GenerationFormData | EditingFormData,
            requestMode: RequestMode,
            options: {
                forceSingleImage?: boolean;
                streamMode: ImageStreamMode;
                partialImages: 1 | 2 | 3;
                passwordHash?: string | null;
            }
        ) => {
            const apiFormData = new FormData();
            const effectivePasswordHash = options.passwordHash ?? clientPasswordHash;
            if (isPasswordRequiredByBackend && effectivePasswordHash) {
                apiFormData.append('passwordHash', effectivePasswordHash);
            } else if (isPasswordRequiredByBackend && !effectivePasswordHash) {
                throw new Error(t('error.passwordRequired'));
            }
            apiFormData.append('mode', requestMode);
            if (apiSettings.apiKey) {
                apiFormData.append('apiKey', apiSettings.apiKey);
            }
            if (apiSettings.baseUrl) {
                apiFormData.append('apiBaseUrl', apiSettings.baseUrl);
            }

            apiFormData.append('stream_mode', options.streamMode);
            if (options.streamMode !== 'non_stream') {
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
                appendImageUpstreamOverrideFields(apiFormData, {
                    imageBackend: genData.image_backend,
                    streamingStrategy: genData.streaming_strategy,
                    responsesModel: genData.responsesModel,
                    thinking: genData.thinking,
                    promptOptimization: genData.promptOptimization,
                    forceWeb: genData.forceWeb
                });
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
                apiFormData.append('output_format', editData.output_format);
                if (
                    (editData.output_format === 'jpeg' || editData.output_format === 'webp') &&
                    editData.output_compression !== undefined
                ) {
                    apiFormData.append('output_compression', editData.output_compression.toString());
                }
                apiFormData.append('moderation', editData.moderation);
                appendImageUpstreamOverrideFields(apiFormData, {
                    imageBackend: editData.image_backend,
                    streamingStrategy: editData.streaming_strategy,
                    responsesModel: editData.responsesModel,
                    thinking: editData.thinking,
                    promptOptimization: editData.promptOptimization,
                    forceWeb: editData.forceWeb
                });

                editData.imageFiles.forEach((file, index) => {
                    apiFormData.append(`image_${index}`, file, file.name);
                });
                if (editData.maskFile) {
                    apiFormData.append('mask', editData.maskFile, editData.maskFile.name);
                }
            }

            return apiFormData;
        },
        [apiSettings.apiKey, apiSettings.baseUrl, clientPasswordHash, isPasswordRequiredByBackend, t]
    );

    const executeImageRequest = React.useCallback(
        async (
            apiFormData: FormData,
            options: {
                previewIndexOffset?: number;
                retryFormData?: GenerationFormData | EditingFormData;
                retryMode?: RequestMode;
                retryStreamMode?: ImageStreamMode;
                retryPartialImages?: 1 | 2 | 3;
                retryEnableParallelBatch?: boolean;
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
                        ...(image.clientRequestId || !formClientRequestId
                            ? {}
                            : { clientRequestId: formClientRequestId })
                    })),
                    usage: streamingState.usage,
                    actualCost: streamingState.actualCost ?? undefined
                };
            }

            let result: {
                error?: string;
                code?: string;
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
                if (
                    response.status === 401 &&
                    isPasswordRequiredByBackend &&
                    isPagePasswordAuthErrorCode(result.code)
                ) {
                    if (
                        options.retryFormData &&
                        options.retryMode &&
                        options.retryStreamMode !== undefined &&
                        options.retryPartialImages !== undefined &&
                        options.retryEnableParallelBatch !== undefined
                    ) {
                        setLastApiCallArgs([
                            options.retryFormData,
                            options.retryMode,
                            options.retryStreamMode,
                            options.retryPartialImages,
                            options.retryEnableParallelBatch
                        ]);
                    }
                    promptForExpiredPassword();
                    throw new ApiRequestError(t('error.passwordExpired'), 401, { preserveDisplayedError: true });
                }
                throw new ApiRequestError(
                    result.error || t('error.apiFailed', { status: response.status }),
                    response.status
                );
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
        [isPasswordRequiredByBackend, promptForExpiredPassword, t]
    );

    async function handleApiCall(
        formData: GenerationFormData | EditingFormData,
        requestMode: RequestMode = mode,
        requestStreamMode: ImageStreamMode = streamMode,
        requestPartialImages: 1 | 2 | 3 = partialImages,
        requestEnableParallelBatch = formData.enableParallelBatch,
        requestPasswordHash: string | null = clientPasswordHash
    ) {
        const startTime = Date.now();
        let durationMs = 0;
        let shouldKeepRetryArgs = true;
        let effectiveFormData: GenerationFormData | EditingFormData = formData;

        setIsLoading(true);
        setActiveRequestStreaming(requestStreamMode !== 'non_stream');
        setError(null);
        setGenerationFailureMessage(null);
        setFailedBatchPrompts([]);
        setLastApiCallArgs(null);
        setLatestImageBatch(null);
        setActiveResultSource(null);
        setCompletedGenerationCount(null);
        setImageOutputView('grid');
        setStreamingPreviewImages(new Map());
        setBatchProgress(null);
        batchPauseRequestedRef.current = false;
        setIsBatchPauseRequested(false);
        if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
            setIsMobileCreationDrawerOpen(false);
            window.setTimeout(scrollToOutput, 80);
        }

        try {
            const latestRuntimeCapabilities = await refreshRuntimeCapabilities();
            const currentStreamingBatchCapacity = resolveStreamingBatchCapacity({
                featureEnabled: latestRuntimeCapabilities?.streamingBatch.enabled === true,
                hasRequestApiKey: apiSettings.apiKey.trim().length > 0,
                requestCredentialConcurrency:
                    latestRuntimeCapabilities?.streamingBatch.requestCredentialConcurrency ?? 1,
                serverRecommendedConcurrency: latestRuntimeCapabilities?.streamingBatch.recommendedConcurrency ?? 0
            });
            if (isPasswordRequiredByBackend) {
                const verificationPasswordHash = requestPasswordHash;
                if (!verificationPasswordHash) {
                    const message = t('error.passwordRequired');
                    setError(createErrorNotice(message));
                    setGenerationFailureMessage(message);
                    setPasswordDialogContext('initial');
                    setIsPasswordDialogOpen(true);
                    return;
                }

                const verificationResult = await verifyEntryPasswordHash(verificationPasswordHash);
                if (verificationResult === 'valid') {
                    setIsEntryAuthenticated(true);
                } else if (verificationResult === 'unavailable') {
                    const message = t('error.authVerifyUnavailable');
                    setError(createErrorNotice(message));
                    setGenerationFailureMessage(message);
                    return;
                } else {
                    const message = t('error.passwordExpired');
                    promptForExpiredPassword();
                    setGenerationFailureMessage(message);
                    return;
                }
            }
            const allowRuntimeResponsesImageBackend =
                isResponsesImageBackendRuntimeEnabled(latestRuntimeCapabilities ?? {});
            if (
                shouldBlockExplicitResponsesRequest({
                    imageBackend: formData.image_backend,
                    allowResponsesImageBackend: allowRuntimeResponsesImageBackend
                })
            ) {
                throw new ApiRequestError(
                    latestRuntimeCapabilities === null
                        ? t('upstream.responsesRuntimeUnavailable')
                        : t('upstream.backendResponsesUnavailable')
                );
            }
            const runtimeFormData = normalizeImageUpstreamRuntimeFields(formData, {
                allowResponsesImageBackend: allowRuntimeResponsesImageBackend
            });
            if (
                shouldBlockResponsesRequestWithoutModel({
                    imageBackend: runtimeFormData.image_backend,
                    responsesModel: runtimeFormData.responsesModel,
                    hasDefaultResponsesModel:
                        latestRuntimeCapabilities?.responsesImageBackend?.hasDefaultModel === true
                })
            ) {
                throw new ApiRequestError(t('upstream.responsesModelRequired'));
            }
            const promptBatch =
                requestMode === 'generate'
                    ? ((runtimeFormData as GenerationFormData).batchPrompts ?? [])
                          .map((prompt) => prompt.trim())
                          .filter((prompt) => prompt.length > 0)
                    : [];
            const isPromptBatch = promptBatch.length > 1;
            const historyPromptOverride =
                requestMode === 'generate' && promptBatch.length > 0
                    ? formatBatchPromptHistory(promptBatch)
                    : undefined;
            const imageCount = isPromptBatch
                ? promptBatch.length
                : requestMode === 'generate'
                  ? (runtimeFormData as GenerationFormData).n
                  : (runtimeFormData as EditingFormData).n;
            const requestStreamingStrategy =
                requestMode === 'generate'
                    ? (runtimeFormData as GenerationFormData).streaming_strategy
                    : (runtimeFormData as EditingFormData).streaming_strategy;
            const runtimeDefaultStreamingStrategy =
                latestRuntimeCapabilities?.streaming?.defaultStrategy ?? defaultStreamingStrategy;
            const effectiveRequestStreamingStrategy =
                requestStreamingStrategy === IMAGE_UPSTREAM_FORM_SERVER_DEFAULT
                    ? runtimeDefaultStreamingStrategy
                    : requestStreamingStrategy;
            const normalizedEnableParallelBatch = shouldUseStreamingBatch({
                enabled: currentStreamingBatchCapacity.enabled,
                userEnabled: requestEnableParallelBatch,
                streaming: canUseStreamingBatchTransport({
                    streamMode: requestStreamMode,
                    streamingStrategy: effectiveRequestStreamingStrategy
                }),
                imageCount
            });
            effectiveFormData = {
                ...runtimeFormData,
                enableParallelBatch: normalizedEnableParallelBatch
            };
            setLastApiCallArgs([
                effectiveFormData,
                requestMode,
                requestStreamMode,
                requestPartialImages,
                normalizedEnableParallelBatch
            ]);

            const executeImageRequestForCurrentOptions = async (
                options: { forceSingleImage: boolean; previewIndexOffset?: number; promptOverride?: string } = {
                    forceSingleImage: false
                }
            ) => {
                const requestFormData =
                    requestMode === 'generate' && options.promptOverride
                        ? {
                              ...(effectiveFormData as GenerationFormData),
                              prompt: options.promptOverride,
                              n: 1
                          }
                        : effectiveFormData;
                return executeImageRequest(
                    buildApiFormData(requestFormData, requestMode, {
                        forceSingleImage: options.forceSingleImage,
                        streamMode: requestStreamMode,
                        partialImages: requestPartialImages,
                        passwordHash: requestPasswordHash
                    }),
                    {
                        previewIndexOffset: options.previewIndexOffset,
                        retryFormData: effectiveFormData,
                        retryMode: requestMode,
                        retryStreamMode: requestStreamMode,
                        retryPartialImages: requestPartialImages,
                        retryEnableParallelBatch: normalizedEnableParallelBatch
                    }
                );
            };

            if (isPromptBatch) {
                const jobs = buildStreamingBatchJobs(promptBatch.length);
                setBatchProgress({
                    completed: 0,
                    failed: 0,
                    total: jobs.length
                });
                const batchResults = await scheduleStreamingBatch(jobs, {
                    concurrency: normalizedEnableParallelBatch ? currentStreamingBatchCapacity.concurrency : 1,
                    runJob: async (job: StreamingBatchJob) => {
                        try {
                            const result = await executeImageRequestForCurrentOptions({
                                forceSingleImage: true,
                                previewIndexOffset: job.outputIndex,
                                promptOverride: promptBatch[job.outputIndex]
                            });
                            setBatchProgress((current) => advanceGenerationBatchProgress(current, jobs.length, false));
                            return result;
                        } catch (error) {
                            setBatchProgress((current) => advanceGenerationBatchProgress(current, jobs.length, true));
                            throw error;
                        }
                    },
                    shouldPause: () => batchPauseRequestedRef.current
                });
                const errors = batchResults.filter((result): result is Error => result instanceof Error);
                const successes = batchResults.filter(
                    (
                        result
                    ): result is { images: ApiImageResponseItem[]; usage: unknown; actualCost?: ActualCostDetails } =>
                        !(result instanceof Error)
                );
                if (errors.some(hasPreservedDisplayedAuthError)) {
                    return;
                }
                const failedPromptBatch = collectFailedBatchPrompts(promptBatch, batchResults);
                if (errors.some((batchError) => batchError instanceof BatchPausedError)) {
                    setBatchProgress((current) => ({
                        completed: countCompletedBatchResults(batchResults),
                        failed: failedPromptBatch.length,
                        total: current?.total ?? jobs.length
                    }));
                }
                if (successes.length === 0) {
                    setFailedBatchPrompts(failedPromptBatch);
                    throw errors[0] || new Error(t('error.noImages'));
                }
                const images = successes.flatMap((result) => result.images);
                const usage = mergeUsageValues(successes.map((result) => result.usage));
                const actualCost = mergeActualCostValues(successes.map((result) => result.actualCost));
                durationMs = Date.now() - startTime;
                if (errors.length > 0) {
                    setFailedBatchPrompts(failedPromptBatch);
                }
                await commitCompletedImages(
                    images,
                    usage,
                    actualCost,
                    durationMs,
                    effectiveFormData,
                    requestMode,
                    true,
                    historyPromptOverride
                );
                shouldKeepRetryArgs = false;
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
                } else {
                    setFailedBatchPrompts([]);
                }
                return;
            }

            if (normalizedEnableParallelBatch) {
                const jobs = buildStreamingBatchJobs(imageCount);
                const batchResults = await scheduleStreamingBatch(jobs, {
                    concurrency: currentStreamingBatchCapacity.concurrency,
                    runJob: async (job: StreamingBatchJob) => {
                        return executeImageRequestForCurrentOptions({
                            forceSingleImage: true,
                            previewIndexOffset: job.outputIndex
                        });
                    }
                });
                const errors = batchResults.filter((result): result is Error => result instanceof Error);
                const successes = batchResults.filter(
                    (
                        result
                    ): result is { images: ApiImageResponseItem[]; usage: unknown; actualCost?: ActualCostDetails } =>
                        !(result instanceof Error)
                );
                if (errors.some(hasPreservedDisplayedAuthError)) {
                    return;
                }
                if (successes.length === 0) {
                    throw errors[0] || new Error(t('error.noImages'));
                }
                const images = successes.flatMap((result) => result.images);
                const usage = mergeUsageValues(successes.map((result) => result.usage));
                const actualCost = mergeActualCostValues(successes.map((result) => result.actualCost));
                durationMs = Date.now() - startTime;
                await commitCompletedImages(
                    images,
                    usage,
                    actualCost,
                    durationMs,
                    effectiveFormData,
                    requestMode,
                    true
                );
                shouldKeepRetryArgs = false;
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
            await commitCompletedImages(
                result.images || [],
                result.usage,
                result.actualCost,
                durationMs,
                effectiveFormData,
                requestMode,
                false,
                historyPromptOverride
            );
            shouldKeepRetryArgs = false;
        } catch (err: unknown) {
            durationMs = Date.now() - startTime;
            console.error(`API 调用在 ${durationMs}ms 后失败：`, err);
            if (hasPreservedDisplayedAuthError(err)) {
                setGenerationFailureMessage(t('error.passwordExpired'));
                setLatestImageBatch(null);
                setStreamingPreviewImages(new Map());
                return;
            }
            const errorSummary = summarizeApiError(err, t('error.unexpected'));
            const message = buildUserFacingApiErrorMessage({ ...errorSummary, t });
            setError(createErrorNotice(message));
            setGenerationFailureMessage(message);
            setLatestImageBatch(null);
            setHistory((prevHistory) => [
                buildFailedHistoryEntry({
                    message,
                    durationMs,
                    formData: effectiveFormData,
                    requestMode,
                    storageMode: effectiveStorageModeClient
                }),
                ...prevHistory
            ]);
            setStreamingPreviewImages(new Map());
            await refreshRuntimeCapabilities();
        } finally {
            if (durationMs === 0) durationMs = Date.now() - startTime;
            if (!shouldKeepRetryArgs) {
                setLastApiCallArgs(null);
            }
            setActiveRequestStreaming(false);
            setIsLoading(false);
        }
    }

    function handleMobilePrimaryAction() {
        if (mode === 'generate') {
            const batchPrompts = workbenchMode === 'batch' ? readBatchPromptLines(genBatchPromptText) : undefined;
            const formData: GenerationFormData = {
                prompt: batchPrompts && batchPrompts.length > 0 ? batchPrompts[0] : genPrompt,
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
                model: genModel,
                image_backend: genImageBackend,
                streaming_strategy: genStreamingStrategy,
                responsesModel: genResponsesModel,
                thinking: genThinking,
                promptOptimization: genPromptOptimization,
                forceWeb: genForceWeb,
                enableParallelBatch,
                ...(batchPrompts ? { batchPrompts } : {})
            };
            void handleApiCall(formData);
            return;
        }
        const formData: EditingFormData = {
            prompt: editPrompt,
            n: editN[0],
            size: editSize,
            customWidth: editCustomWidth,
            customHeight: editCustomHeight,
            quality: editQuality,
            output_format: editOutputFormat,
            ...(editOutputFormat === 'jpeg' || editOutputFormat === 'webp'
                ? { output_compression: editCompression[0] }
                : {}),
            moderation: editModeration,
            imageFiles: editImageFiles,
            maskFile: editGeneratedMaskFile,
            model: editModel,
            image_backend: editImageBackend,
            streaming_strategy: editStreamingStrategy,
            responsesModel: editResponsesModel,
            thinking: editThinking,
            promptOptimization: editPromptOptimization,
            forceWeb: editForceWeb,
            enableParallelBatch
        };
        void handleApiCall(formData);
    }

    function handleMobileSaveInspiration() {
        const trimmedPrompt = currentPrompt.trim();
        if (!trimmedPrompt) return;
        handleSaveInspiration(trimmedPrompt);
    }

    function handleMobileRandomInspiration() {
        const nextPrompt = pickRandomInspirationPrompt();
        if (!nextPrompt) return;
        if (mode === 'edit') {
            setEditPrompt(nextPrompt);
            return;
        }
        if (workbenchMode === 'batch') {
            setGenBatchPromptText(nextPrompt);
            return;
        }
        setGenPrompt(nextPrompt);
    }

    const buildCurrentGenerationFallbackFormData = React.useCallback((): GenerationFormData => {
        return {
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
            model: genModel,
            image_backend: genImageBackend,
            streaming_strategy: genStreamingStrategy,
            responsesModel: genResponsesModel,
            thinking: genThinking,
            promptOptimization: genPromptOptimization,
            forceWeb: genForceWeb,
            enableParallelBatch
        };
    }, [
        enableParallelBatch,
        genBackground,
        genCompression,
        genCustomHeight,
        genCustomWidth,
        genForceWeb,
        genImageBackend,
        genModel,
        genModeration,
        genN,
        genOutputFormat,
        genPrompt,
        genPromptOptimization,
        genQuality,
        genResponsesModel,
        genSize,
        genStreamingStrategy,
        genThinking
    ]);

    const applyHistoryGenerationFormData = React.useCallback(
        (formData: GenerationFormData, item: HistoryMetadata) => {
            const normalizedFormData = normalizeImageUpstreamRuntimeFields(formData, {
                allowResponsesImageBackend: allowResponsesHistoryRoute
            });
            const trimmedPrompt = normalizedFormData.prompt.trim();
            const restoredFields = [t('reuse.fieldPrompt')];

            setGenPrompt(trimmedPrompt || normalizedFormData.prompt);
            setGenModel(normalizedFormData.model);
            setGenSize(normalizedFormData.size);
            setGenCustomWidth(normalizedFormData.customWidth);
            setGenCustomHeight(normalizedFormData.customHeight);
            setGenQuality(normalizedFormData.quality);
            setGenBackground(normalizedFormData.background);
            setGenModeration(normalizedFormData.moderation);
            setGenOutputFormat(normalizedFormData.output_format);
            setGenImageBackend(normalizedFormData.image_backend);
            setGenStreamingStrategy(normalizedFormData.streaming_strategy);
            setGenResponsesModel(normalizedFormData.responsesModel);
            setGenThinking(normalizedFormData.thinking);
            setGenPromptOptimization(normalizedFormData.promptOptimization);
            setGenForceWeb(normalizedFormData.forceWeb);
            setEnableParallelBatch(normalizedFormData.enableParallelBatch);
            if (normalizedFormData.output_compression !== undefined) {
                setGenCompression([normalizedFormData.output_compression]);
            }

            restoredFields.push(
                t('reuse.fieldModel'),
                t('reuse.fieldSize'),
                t('reuse.fieldQuality'),
                t('reuse.fieldBackground'),
                t('reuse.fieldModeration'),
                t('reuse.fieldFormat'),
                t('reuse.fieldRoute')
            );

            if (normalizedFormData.batchPrompts && normalizedFormData.batchPrompts.length > 1) {
                setGenBatchPromptText(normalizedFormData.batchPrompts.join('\n'));
                setGenN([1]);
                setWorkbenchMode('batch');
            } else {
                setGenBatchPromptText('');
                setGenN([normalizedFormData.n]);
                restoredFields.push(t('reuse.fieldCount'));
                setWorkbenchMode('reuse');
            }

            setReuseContext({
                sourceLabel: t('reuse.sourceHistory', {
                    time: new Date(item.timestamp).toLocaleString(locale)
                }),
                restoredFields: Array.from(new Set(restoredFields)),
                promptPreview: trimmedPrompt || t('history.noPrompt')
            });
            setMode('generate');
            return normalizedFormData;
        },
        [allowResponsesHistoryRoute, locale, t]
    );

    function handleCreateVariant() {
        if (activeResultSource) {
            const formData = buildHistoryGenerationFormData(
                activeResultSource,
                buildCurrentGenerationFallbackFormData()
            );
            const normalizedFormData = applyHistoryGenerationFormData(formData, activeResultSource);
            void handleApiCall(normalizedFormData, 'generate');
            return;
        }
        handleMobilePrimaryAction();
    }

    function handleReuseCurrentPrompt() {
        if (activeResultSource) {
            const formData = buildHistoryGenerationFormData(
                activeResultSource,
                buildCurrentGenerationFallbackFormData()
            );
            applyHistoryGenerationFormData(formData, activeResultSource);
            return;
        }
        const promptToReuse = mode === 'edit' && editPrompt.trim() ? editPrompt : currentPrompt;
        const trimmedPrompt = promptToReuse.trim();
        if (trimmedPrompt) {
            setGenPrompt(trimmedPrompt);
            setReuseContext({
                sourceLabel: t('reuse.sourceCurrent'),
                restoredFields: [t('reuse.fieldPrompt')],
                promptPreview: trimmedPrompt
            });
        }
        setWorkbenchMode('reuse');
        setMode('generate');
    }

    const handleHistorySelect = React.useCallback(
        async (item: HistoryMetadata) => {
            const originalStorageMode = item.storageModeUsed || 'fs';
            if (originalStorageMode === 'fs' && !(await refreshImageAccessCookie())) {
                return;
            }
            setCompletedGenerationCount(null);

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
                        storageMode: originalStorageMode,
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
                setActiveResultSource(validImages.length > 0 ? item : null);
                setImageOutputView(validImages.length > 1 ? 'grid' : 0);
            });
        },
        [createErrorNotice, getImageSrc, refreshImageAccessCookie, t]
    );

    const handleApplyPrompt = React.useCallback(
        (prompt: string, source: PromptApplySource) => {
            const trimmedPrompt = prompt.trim();
            const restoredFields = [t('reuse.fieldPrompt')];

            if (source.type === 'history') {
                const formData = buildHistoryGenerationFormData(source.item, buildCurrentGenerationFallbackFormData());
                applyHistoryGenerationFormData(formData, source.item);
                return;
            } else {
                setGenPrompt(trimmedPrompt || prompt);
                setReuseContext({
                    sourceLabel: t('reuse.sourceInspiration', { title: source.title }),
                    restoredFields,
                    promptPreview: trimmedPrompt || t('history.noPrompt')
                });
            }

            setWorkbenchMode('reuse');
            setMode('generate');
        },
        [applyHistoryGenerationFormData, buildCurrentGenerationFallbackFormData, t]
    );

    const handleSaveInspiration = React.useCallback((prompt: string) => {
        const trimmedPrompt = prompt.trim();
        if (!trimmedPrompt) return;
        setInspirations((current) => {
            const existing = current.find((item) => item.prompt === trimmedPrompt);
            if (existing) {
                return [existing, ...current.filter((item) => item.id !== existing.id)];
            }
            return [{ id: Date.now(), prompt: trimmedPrompt, createdAt: Date.now() }, ...current].slice(0, 24);
        });
    }, []);

    const handleDeleteInspiration = React.useCallback((id: number) => {
        setInspirations((current) => current.filter((item) => item.id !== id));
    }, []);

    const handleClearHistory = React.useCallback(async () => {
        const confirmationMessage =
            effectiveStorageModeClient === 'indexeddb'
                ? t('confirm.clearHistoryIndexedDb')
                : t('confirm.clearHistoryFs');

        if (window.confirm(confirmationMessage)) {
            setHistory([]);
            setLatestImageBatch(null);
            setActiveResultSource(null);
            setCompletedGenerationCount(null);
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
                setError(
                    createErrorNotice(t('error.clearHistory', { message: e instanceof Error ? e.message : String(e) }))
                );
            }
        }
    }, [createErrorNotice, t]);

    const resolveImageBlob = React.useCallback(
        async (filename: string, storageMode: ImageStorageMode = effectiveStorageModeClient): Promise<Blob> => {
            if (storageMode === 'indexeddb') {
                const record = allDbImages?.find((img) => img.filename === filename);
                if (!record?.blob) {
                    throw new Error(t('error.imageNotFoundDb', { filename }));
                }
                return record.blob;
            }

            if (!(await refreshImageAccessCookie())) {
                throw new Error(t('error.imageAccessRefreshFailed'));
            }
            const response = await fetch(`/api/image/${filename}`);
            if (!response.ok) {
                throw new Error(t('error.fetchImage', { statusText: response.statusText }));
            }
            return response.blob();
        },
        [allDbImages, refreshImageAccessCookie, t]
    );

    const handleDownloadImage = React.useCallback(
        async (filename: string, storageMode?: HistoryMetadata['storageModeUsed']) => {
            try {
                const blob = await resolveImageBlob(filename, storageMode);
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.setTimeout(() => URL.revokeObjectURL(url), 150);
            } catch (error) {
                setError(
                    createErrorNotice(error instanceof Error ? error.message : t('error.retrieveImage', { filename }))
                );
            }
        },
        [createErrorNotice, resolveImageBlob, t]
    );

    const handleOpenShareImage = React.useCallback((filename: string, storageMode?: HistoryMetadata['storageModeUsed']) => {
        setShareTargetFilename(filename);
        setShareTargetStorageMode(storageMode);
        setShareUrl(null);
        setShareError(null);
        setShareDialogOpen(true);
    }, []);

    const handleCreateShare = React.useCallback(
        async (values: ShareDialogValues) => {
            if (!shareTargetFilename) return;
            setIsCreatingShare(true);
            setShareError(null);
            try {
                const blob = await resolveImageBlob(shareTargetFilename, shareTargetStorageMode);
                const result = await createImageShareFromBlob({
                    filename: shareTargetFilename,
                    blob,
                    values,
                    accessRefreshErrorMessage: t('error.imageAccessRefreshFailed'),
                    createFailedMessage: t('share.createFailed'),
                    refreshImageAccessCookie
                });
                setShareUrl(result.url);
            } catch (error) {
                setShareError(error instanceof Error ? error.message : t('share.createFailed'));
            } finally {
                setIsCreatingShare(false);
            }
        },
        [refreshImageAccessCookie, resolveImageBlob, shareTargetFilename, shareTargetStorageMode, t]
    );

    const handleSendToEdit = async (
        filename: string,
        storageMode: HistoryMetadata['storageModeUsed'] = effectiveStorageModeClient
    ): Promise<boolean> => {
        if (isSendingToEdit) return false;
        const sourceStorageMode = storageMode || 'fs';
        setIsSendingToEdit(true);
        setError(null);

        const alreadyExists = editImageFiles.some((file) => file.name === filename);
        if (mode === 'edit' && alreadyExists) {
            setIsSendingToEdit(false);
            return true;
        }

        if (mode === 'edit' && editImageFiles.length >= MAX_EDIT_IMAGES) {
            setError(createErrorNotice(t('error.maxEditImages', { count: MAX_EDIT_IMAGES })));
            setIsSendingToEdit(false);
            return false;
        }

        try {
            let blob: Blob | undefined;
            let mimeType: string = 'image/png';

            if (sourceStorageMode === 'indexeddb') {
                const record = allDbImages?.find((img) => img.filename === filename);
                if (record?.blob) {
                    blob = record.blob;
                    mimeType = blob.type || mimeType;
                } else {
                    throw new Error(t('error.imageNotFoundDb', { filename }));
                }
            } else {
                if (!(await refreshImageAccessCookie())) {
                    return false;
                }
                const response = await fetch(`/api/image/${filename}`);
                if (response.status === 401 && isPasswordRequiredByBackend) {
                    let result: { code?: string } = {};
                    try {
                        result = (await response.json()) as { code?: string };
                    } catch {
                        result = {};
                    }
                    if (isPagePasswordAuthErrorCode(result.code)) {
                        promptForExpiredPassword();
                    } else {
                        setError(createErrorNotice(t('error.authVerifyUnavailable')));
                    }
                    return false;
                }
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

            setEditImageFiles([newFile]);
            updateEditSourceImagePreviewUrls([newPreviewUrl]);
            setEditReuseContext(null);

            if (mode === 'generate') {
                setMode('edit');
                setWorkbenchMode('edit');
            }
            return true;
        } catch (err: unknown) {
            console.error('发送图片到编辑模式失败：', err);
            const errorMessage = err instanceof Error ? err.message : t('error.sendToEdit');
            setError(createErrorNotice(errorMessage));
            return false;
        } finally {
            setIsSendingToEdit(false);
        }
    };

    const handleSendHistoryToEdit = async (item: HistoryMetadata) => {
        const firstImage = item.images[0];
        if (!firstImage) {
            setError(createErrorNotice(t('error.historyMissingImage')));
            return;
        }

        const sent = await handleSendToEdit(firstImage.filename, item.storageModeUsed || 'fs');
        if (!sent) return;

        const nextModel = item.model ?? editModel;
        const normalizedRouteFields = normalizeImageUpstreamRuntimeFields(
            {
                image_backend: item.image_backend ?? editImageBackend,
                streaming_strategy: item.streaming_strategy ?? editStreamingStrategy,
                responsesModel: item.responsesModel ?? editResponsesModel,
                thinking: item.thinking ?? editThinking,
                promptOptimization: item.promptOptimization ?? editPromptOptimization
            },
            { allowResponsesImageBackend: allowResponsesHistoryRoute }
        );
        const sizeSelection = readHistorySizeSelection(item, nextModel);
        const restoredFields = [t('reuse.fieldReferenceImage'), t('reuse.fieldPrompt')];
        setEditPrompt(item.prompt);
        setEditModel(nextModel);
        setEditSize(sizeSelection.size);
        if (typeof sizeSelection.customWidth === 'number') {
            setEditCustomWidth(sizeSelection.customWidth);
        }
        if (typeof sizeSelection.customHeight === 'number') {
            setEditCustomHeight(sizeSelection.customHeight);
        }
        setEditQuality(item.quality);
        setEditModeration(item.moderation);
        setEnableParallelBatch(item.enableParallelBatch === true);
        setEditImageBackend(normalizedRouteFields.image_backend);
        setEditStreamingStrategy(normalizedRouteFields.streaming_strategy);
        setEditResponsesModel(normalizedRouteFields.responsesModel);
        setEditThinking(normalizedRouteFields.thinking);
        setEditPromptOptimization(normalizedRouteFields.promptOptimization);
        setEditForceWeb(item.forceWeb === true);
        const imageCount = readHistoryImageCountSelection(item.images.length);
        if (imageCount !== null) {
            setEditN([imageCount]);
            restoredFields.push(t('reuse.fieldCount'));
        }
        restoredFields.push(t('reuse.fieldModel'), t('reuse.fieldQuality'), t('reuse.fieldModeration'), t('reuse.fieldRoute'));
        if (sizeSelection.restored) {
            restoredFields.push(t('reuse.fieldSize'));
        }
        if (item.output_format) {
            setEditOutputFormat(item.output_format);
            restoredFields.push(t('reuse.fieldFormat'));
        }
        setEditReuseContext({
            sourceLabel: t('reuse.sourceHistory', {
                time: new Date(item.timestamp).toLocaleString(locale)
            }),
            restoredFields: Array.from(new Set(restoredFields)),
            promptPreview: item.prompt.trim() || t('history.noPrompt')
        });
        setMode('edit');
        setWorkbenchMode('edit');
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
                setActiveResultSource((current) => (current?.timestamp === timestamp ? null : current));
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

    const showEntryLock = isPasswordRequiredByBackend === true && !isEntryAuthenticated;
    const outputFailureMessage =
        !isLoading && !isSendingToEdit && !latestImageBatch && error?.message === generationFailureMessage
            ? generationFailureMessage
            : null;
    const canRetryLastGeneration = Boolean(lastApiCallArgs) && !isLoading && !isSendingToEdit;
    function handleRetryLastGeneration() {
        if (!lastApiCallArgs) return;
        void handleApiCall(...lastApiCallArgs, clientPasswordHash);
    }

    return (
        <main className='studio-paper text-foreground min-h-screen pb-[calc(10.5rem+env(safe-area-inset-bottom))] xl:h-dvh xl:overflow-hidden xl:pb-0'>
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
            <ShareDialog
                open={shareDialogOpen}
                onOpenChange={setShareDialogOpen}
                isCreating={isCreatingShare}
                shareUrl={shareUrl}
                error={shareError}
                onCreate={handleCreateShare}
            />
            {showEntryLock ? (
                <div className='mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-4 text-center'>
                    <div className='bg-primary text-primary-foreground border-primary/20 flex size-14 items-center justify-center rounded-full border shadow-sm'>
                        <Lock className='h-6 w-6' />
                    </div>
                    <div className='space-y-2'>
                        <h1 className='text-2xl font-semibold'>{t('password.required')}</h1>
                        <p className='text-muted-foreground text-sm'>{t('password.entryDescription')}</p>
                    </div>
                    {error && (
                        <Alert
                            variant='destructive'
                            className='border-destructive/45 bg-destructive/10 text-destructive text-left'>
                            <AlertTitle>{t('common.error')}</AlertTitle>
                            <AlertDescription>{renderErrorDescription(error)}</AlertDescription>
                        </Alert>
                    )}
                    <Button
                        type='button'
                        onClick={() => {
                            setError(null);
                            setPasswordDialogContext('initial');
                            setIsPasswordDialogOpen(true);
                        }}
                        className='px-6'>
                        {t('password.unlock')}
                    </Button>
                </div>
            ) : null}
            {!showEntryLock && isPasswordRequiredByBackend !== null ? (
                <>
                    {isMobileCreationDrawerOpen && (
                        <button
                            type='button'
                            aria-label={t('ux.closeCreationSheet')}
                            className='bg-foreground/25 fixed inset-0 z-40 lg:hidden'
                            onClick={closeMobileCreationDrawer}
                        />
                    )}
                    <div className='mx-auto flex min-h-screen w-full max-w-[1760px] flex-col px-4 py-3 lg:px-7 lg:py-5 xl:h-full xl:min-h-0'>
                        <header
                            aria-hidden={isMobileCreationDrawerOpen}
                            inert={isMobileCreationDrawerOpen}
                            className='mb-5 flex shrink-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between'>
                            <div className='flex min-w-0 items-center gap-3'>
                                <div className='flex min-w-0 items-center gap-3'>
                                    <h1 className='editorial-title truncate text-3xl font-semibold tracking-normal sm:text-4xl'>
                                        {t('app.studioTitle')}
                                    </h1>
                                    <Flower2 className='hidden h-7 w-7 rotate-12 text-[oklch(0.68_0.12_64)] sm:block' />
                                    <p className='text-muted-foreground text-sm'>{t('app.studioSubtitle')}</p>
                                </div>
                                <Button
                                    type='button'
                                    variant='outline'
                                    size='icon'
                                    onClick={() => setIsApiSettingsDialogOpen(true)}
                                    className='bg-card/80 ml-auto h-11 w-11 shrink-0 shadow-sm sm:hidden'
                                    aria-label={t('app.apiSettings')}>
                                    <Settings2 className='h-4 w-4' />
                                </Button>
                            </div>
                            <div className='flex flex-wrap items-center gap-4 sm:justify-end'>
                                <WorkbenchStatusStrip
                                    model={activeWorkbenchModel}
                                    channelLabel={activeWorkbenchBackendLabel}
                                    streamStatus={getStreamingStatusLabel(streamMode, t)}
                                    parallelBatchEnabled={activeParallelBatchVisible}
                                    costLabel={activeEstimatedCostLabel}
                                />
                                <div className='text-muted-foreground hidden items-center gap-4 sm:flex'>
                                    <HelpCircle className='h-4 w-4' aria-hidden='true' />
                                    <button
                                        type='button'
                                        onClick={() => setIsApiSettingsDialogOpen(true)}
                                        aria-label={t('app.apiSettings')}
                                        className='hover:bg-accent hover:text-foreground focus-visible:ring-ring flex h-9 w-9 items-center justify-center rounded-md transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:outline-none active:scale-[0.98]'>
                                        <Settings2 className='h-4 w-4' />
                                    </button>
                                </div>
                            </div>
                        </header>
                        <div className='grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(340px,390px)_minmax(0,1fr)] xl:min-h-0 xl:grid-cols-[minmax(330px,370px)_minmax(560px,1fr)_minmax(320px,360px)] 2xl:grid-cols-[minmax(360px,410px)_minmax(620px,1fr)_minmax(360px,430px)]'>
                            <section
                                id='mobile-creation-sheet'
                                aria-label={t('app.creationControls')}
                                className={`order-2 lg:static lg:order-1 lg:block lg:p-0 lg:shadow-none xl:min-h-0 xl:overflow-hidden ${
                                    isMobileCreationDrawerOpen
                                        ? 'border-border fixed inset-x-0 top-4 bottom-0 z-50 min-h-0 scroll-pb-28 overflow-y-auto rounded-t-lg border-t bg-[oklch(0.986_0.015_84)] px-3 pt-3 pb-[calc(8rem+env(safe-area-inset-bottom))] shadow-[0_-16px_36px_rgba(73,50,25,0.18)] lg:max-h-none lg:rounded-none'
                                        : 'hidden min-h-[620px]'
                                }`}>
                                {isMobileCreationDrawerOpen && (
                                    <div className='sticky top-0 z-10 mb-2 flex items-center justify-center lg:hidden'>
                                        <button
                                            type='button'
                                            className='flex h-11 w-24 touch-none items-center justify-center rounded-full select-none'
                                            onPointerDown={beginMobileCreationDrawerGesture}
                                            onPointerUp={finishMobileCreationDrawerGesture}
                                            onPointerCancel={cancelMobileCreationDrawerGesture}
                                            onClick={handleMobileCreationDrawerHandleClick}
                                            aria-label={t('ux.closeCreationSheet')}
                                            aria-controls='mobile-creation-sheet'
                                            aria-expanded={true}>
                                            <span className='bg-border h-1 w-10 rounded-full' aria-hidden='true' />
                                        </button>
                                        <Button
                                            ref={mobileCreationDrawerCloseButtonRef}
                                            type='button'
                                            variant='outline'
                                            size='icon'
                                            onClick={closeMobileCreationDrawer}
                                            className='bg-card/95 absolute top-0 right-0 h-11 w-11 shadow-sm'
                                            aria-label={t('ux.closeCreationSheet')}>
                                            <X className='h-4 w-4' />
                                        </Button>
                                    </div>
                                )}
                                {isMobileCreationDrawerOpen && (
                                    <div className='mb-3 grid grid-cols-2 gap-2 lg:hidden'>
                                        <Button
                                            type='button'
                                            variant='outline'
                                            size='sm'
                                            onClick={handleMobileSaveInspiration}
                                            disabled={!mobileCanSaveInspiration}
                                            className='bg-card/80 min-h-11'>
                                            {t('workbench.saveInspiration')}
                                        </Button>
                                        <Button
                                            type='button'
                                            variant='outline'
                                            size='sm'
                                            onClick={handleMobileRandomInspiration}
                                            disabled={isLoading || isSendingToEdit || !hasRandomInspirationPrompt}
                                            className='bg-card/80 min-h-11'>
                                            {t('workbench.randomInspiration')}
                                        </Button>
                                    </div>
                                )}
                                <div className={mode === 'generate' ? 'block w-full lg:h-full' : 'hidden'}>
                                    <GenerationForm
                                        onSubmit={handleApiCall}
                                        onSaveInspiration={handleSaveInspiration}
                                        canApplyRandomInspiration={hasRandomInspirationPrompt}
                                        onPickRandomInspiration={pickRandomInspirationPrompt}
                                        isLoading={isLoading}
                                        currentMode={workbenchMode}
                                        onModeChange={handleWorkbenchModeChange}
                                        reuseContext={reuseContext}
                                        onClearReuseContext={() => setReuseContext(null)}
                                        isPasswordRequiredByBackend={isPasswordRequiredByBackend}
                                        clientPasswordHash={clientPasswordHash}
                                        onOpenPasswordDialog={handleOpenPasswordDialog}
                                        model={genModel}
                                        setModel={setGenModel}
                                        prompt={genPrompt}
                                        setPrompt={setGenPrompt}
                                        batchPromptText={genBatchPromptText}
                                        setBatchPromptText={handleBatchPromptTextChange}
                                        failedBatchPrompts={failedBatchPrompts}
                                        canPauseBatch={canPausePromptBatch}
                                        isBatchPauseRequested={isBatchPauseRequested}
                                        onPauseBatch={handlePauseBatch}
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
                                        streamMode={streamMode}
                                        setStreamMode={setStreamMode}
                                        allowStreamingBatch={streamingBatchEnabled}
                                        enableParallelBatch={enableParallelBatch}
                                        setEnableParallelBatch={setEnableParallelBatch}
                                        partialImages={partialImages}
                                        setPartialImages={setPartialImages}
                                        allowResponsesImageBackend={allowResponsesImageBackend}
                                        hasDefaultResponsesModel={hasDefaultResponsesModel}
                                        imageBackend={genImageBackend}
                                        setImageBackend={setGenImageBackend}
                                        streamingStrategy={genStreamingStrategy}
                                        defaultStreamingStrategy={defaultStreamingStrategy}
                                        setStreamingStrategy={setGenStreamingStrategy}
                                        responsesModel={genResponsesModel}
                                        setResponsesModel={setGenResponsesModel}
                                        thinking={genThinking}
                                        setThinking={setGenThinking}
                                        promptOptimization={genPromptOptimization}
                                        setPromptOptimization={setGenPromptOptimization}
                                        forceWeb={genForceWeb}
                                        setForceWeb={setGenForceWeb}
                                        estimatedCostLabel={activeEstimatedCostLabel}
                                    />
                                </div>
                                <div className={mode === 'edit' ? 'block w-full lg:h-full' : 'hidden'}>
                                    <EditingForm
                                        onSubmit={handleApiCall}
                                        isLoading={isLoading || isSendingToEdit}
                                        currentMode={workbenchMode}
                                        onModeChange={handleWorkbenchModeChange}
                                        reuseContext={editReuseContext}
                                        onClearReuseContext={() => setEditReuseContext(null)}
                                        isPasswordRequiredByBackend={isPasswordRequiredByBackend}
                                        clientPasswordHash={clientPasswordHash}
                                        onOpenPasswordDialog={handleOpenPasswordDialog}
                                        editModel={editModel}
                                        setEditModel={setEditModel}
                                        imageFiles={editImageFiles}
                                        sourceImagePreviewUrls={editSourceImagePreviewUrls}
                                        setImageFiles={setEditImageFiles}
                                        setSourceImagePreviewUrls={(nextUrls) => {
                                            const resolvedUrls =
                                                typeof nextUrls === 'function'
                                                    ? nextUrls(editSourceImagePreviewUrlsRef.current)
                                                    : nextUrls;
                                            updateEditSourceImagePreviewUrls(resolvedUrls);
                                        }}
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
                                        editOutputFormat={editOutputFormat}
                                        setEditOutputFormat={setEditOutputFormat}
                                        editCompression={editCompression}
                                        setEditCompression={setEditCompression}
                                        editModeration={editModeration}
                                        setEditModeration={setEditModeration}
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
                                        streamMode={streamMode}
                                        setStreamMode={setStreamMode}
                                        allowStreamingBatch={streamingBatchEnabled}
                                        enableParallelBatch={enableParallelBatch}
                                        setEnableParallelBatch={setEnableParallelBatch}
                                        partialImages={partialImages}
                                        setPartialImages={setPartialImages}
                                        allowResponsesImageBackend={allowResponsesImageBackend}
                                        hasDefaultResponsesModel={hasDefaultResponsesModel}
                                        editImageBackend={editImageBackend}
                                        setEditImageBackend={setEditImageBackend}
                                        editStreamingStrategy={editStreamingStrategy}
                                        defaultStreamingStrategy={defaultStreamingStrategy}
                                        setEditStreamingStrategy={setEditStreamingStrategy}
                                        editResponsesModel={editResponsesModel}
                                        setEditResponsesModel={setEditResponsesModel}
                                        editThinking={editThinking}
                                        setEditThinking={setEditThinking}
                                        editPromptOptimization={editPromptOptimization}
                                        setEditPromptOptimization={setEditPromptOptimization}
                                        editForceWeb={editForceWeb}
                                        setEditForceWeb={setEditForceWeb}
                                        estimatedCostLabel={activeEstimatedCostLabel}
                                    />
                                </div>
                            </section>
                            <section
                                ref={outputPanelRef}
                                aria-label={t('app.canvasPreview')}
                                aria-hidden={isMobileCreationDrawerOpen}
                                inert={isMobileCreationDrawerOpen}
                                className='order-1 flex min-h-[380px] scroll-mt-4 flex-col sm:min-h-[460px] lg:order-2 xl:min-h-0'>
                                {error && (
                                    <Alert
                                        variant='destructive'
                                        className='border-destructive/45 bg-destructive/10 text-destructive mb-4'>
                                        <AlertTitle>{t('common.error')}</AlertTitle>
                                        <AlertDescription>{renderErrorDescription(error)}</AlertDescription>
                                    </Alert>
                                )}
                                <div className='min-h-0 flex-1'>
                                    <ImageOutput
                                        imageBatch={latestImageBatch}
                                        viewMode={imageOutputView}
                                        onViewChange={setImageOutputView}
                                        altText={t('output.alt')}
                                        isLoading={isLoading || isSendingToEdit}
                                        onSendToEdit={handleSendToEdit}
                                        onDownloadImage={handleDownloadImage}
                                        onShareImage={handleOpenShareImage}
                                        onCreateVariant={handleCreateVariant}
                                        onReusePrompt={handleReuseCurrentPrompt}
                                        failureMessage={outputFailureMessage}
                                        onRetry={canRetryLastGeneration ? handleRetryLastGeneration : undefined}
                                        compareImage={historyCompareImage}
                                        canCreateVariant={canCreateResultVariant}
                                        canReusePrompt={canReuseResultPrompt}
                                        currentMode={mode}
                                        baseImagePreviewUrl={editSourceImagePreviewUrls[0] || null}
                                        streamingPreviewImages={streamingPreviewImages}
                                        isStreamingRequest={activeRequestStreaming}
                                        clientPasswordHash={clientPasswordHash}
                                        canOpenLogs={canOpenLogs}
                                        openLogsSignal={openLogsSignal}
                                        logClientRequestIds={activeLogClientRequestIds}
                                        logFilenames={activeLogFilenames}
                                    />
                                </div>
                                <WorkbenchProDock
                                    outputFormat={mode === 'generate' ? genOutputFormat : editOutputFormat}
                                    onOutputFormatChange={
                                        mode === 'generate' ? setGenOutputFormat : setEditOutputFormat
                                    }
                                    quality={mode === 'generate' ? genQuality : editQuality}
                                    onQualityChange={mode === 'generate' ? setGenQuality : setEditQuality}
                                    model={mode === 'generate' ? genModel : editModel}
                                    onModelChange={mode === 'generate' ? setGenModel : setEditModel}
                                    size={mode === 'generate' ? genSize : editSize}
                                    streamMode={streamMode}
                                    onStreamModeChange={setStreamMode}
                                    allowStreamingBatch={streamingBatchEnabled}
                                    enableParallelBatch={enableParallelBatch}
                                    onEnableParallelBatchChange={setEnableParallelBatch}
                                    parallelBatchTargetCount={
                                        mode === 'generate' && workbenchMode === 'batch'
                                            ? readBatchPromptLines(genBatchPromptText).length
                                            : mode === 'generate'
                                              ? genN[0]
                                              : editN[0]
                                    }
                                    allowResponsesImageBackend={allowResponsesImageBackend}
                                    hasDefaultResponsesModel={hasDefaultResponsesModel}
                                    imageBackend={mode === 'generate' ? genImageBackend : editImageBackend}
                                    onImageBackendChange={
                                        mode === 'generate' ? setGenImageBackend : setEditImageBackend
                                    }
                                    streamingStrategy={
                                        mode === 'generate' ? genStreamingStrategy : editStreamingStrategy
                                    }
                                    defaultStreamingStrategy={defaultStreamingStrategy}
                                    onStreamingStrategyChange={
                                        mode === 'generate' ? setGenStreamingStrategy : setEditStreamingStrategy
                                    }
                                    responsesModel={mode === 'generate' ? genResponsesModel : editResponsesModel}
                                    onResponsesModelChange={
                                        mode === 'generate' ? setGenResponsesModel : setEditResponsesModel
                                    }
                                    disabled={isLoading || isSendingToEdit}
                                />
                            </section>
                            <aside
                                aria-label={t('history.title')}
                                aria-hidden={isMobileCreationDrawerOpen}
                                inert={isMobileCreationDrawerOpen}
                                className='order-3 min-h-[420px] lg:col-span-2 lg:min-h-[420px] xl:col-span-1 xl:min-h-0 xl:overflow-hidden'>
                                <HistoryPanel
                                    history={history}
                                    inspirations={inspirations}
                                    activityItems={generationActivityItems}
                                    onSelectImage={handleHistorySelect}
                                    onApplyPrompt={handleApplyPrompt}
                                    onSaveInspiration={handleSaveInspiration}
                                    onSendHistoryToEdit={handleSendHistoryToEdit}
                                    onDeleteInspiration={handleDeleteInspiration}
                                    onClearHistory={handleClearHistory}
                                    getImageSrc={getImageSrc}
                                    onDeleteItemRequest={handleRequestDeleteItem}
                                    itemPendingDeleteConfirmation={itemToDeleteConfirm}
                                    onConfirmDeletion={handleConfirmDeletion}
                                    onCancelDeletion={handleCancelDeletion}
                                    deletePreferenceDialogValue={dialogCheckboxStateSkipConfirm}
                                    onDeletePreferenceDialogChange={setDialogCheckboxStateSkipConfirm}
                                />
                            </aside>
                        </div>
                    </div>
                    {!isMobileCreationDrawerOpen && (
                        <div className='bg-background border-border fixed right-0 bottom-0 left-0 z-40 border-t p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-12px_30px_rgba(73,50,25,0.12)] lg:hidden'>
                            <button
                                type='button'
                                className='mx-auto mb-2 flex h-11 w-24 touch-none items-center justify-center rounded-full select-none'
                                onPointerDown={beginMobileCreationDrawerGesture}
                                onPointerUp={finishMobileCreationDrawerGesture}
                                onPointerCancel={cancelMobileCreationDrawerGesture}
                                onClick={handleMobileCreationDrawerHandleClick}
                                aria-label={t('ux.openCreationSheet')}
                                aria-controls='mobile-creation-sheet'
                                aria-expanded={false}>
                                <span className='bg-border h-1 w-10 rounded-full' aria-hidden='true' />
                            </button>
                            <div className='mx-auto max-w-screen-sm space-y-2'>
                                <div className='flex flex-wrap items-center justify-center gap-1.5 text-[11px]'>
                                    <span className='border-border bg-card/80 text-muted-foreground rounded-full border px-2 py-1'>
                                        {activeWorkbenchModel}
                                    </span>
                                    <span className='border-border bg-card/80 text-muted-foreground rounded-full border px-2 py-1'>
                                        {activeWorkbenchBackendLabel}
                                    </span>
                                    <span className='border-border bg-card/80 text-muted-foreground rounded-full border px-2 py-1'>
                                        {getStreamingStatusLabel(streamMode, t)}
                                    </span>
                                    {activeParallelBatchVisible && (
                                        <span className='border-[oklch(0.72_0.065_142)] bg-[oklch(0.94_0.032_142)] text-[oklch(0.38_0.075_148)] rounded-full border px-2 py-1'>
                                            {t('streaming.parallelBatchEnabled')}
                                        </span>
                                    )}
                                    <span className='border-primary/20 bg-primary/10 text-primary rounded-full border px-2 py-1'>
                                        {activeEstimatedCostLabel}
                                    </span>
                                </div>
                            </div>
                            <div className='mx-auto mt-2 flex max-w-screen-sm items-stretch gap-2'>
                                <Button
                                    type='button'
                                    variant='outline'
                                    size='icon'
                                    onClick={toggleMobileCreationDrawer}
                                    className='text-muted-foreground hover:text-foreground h-11 w-11 shrink-0'
                                    aria-label={t('ux.openCreationSheet')}
                                    aria-controls='mobile-creation-sheet'
                                    aria-expanded={false}>
                                    <PenLine className='h-4 w-4' />
                                </Button>
                                <Button
                                    type='button'
                                    onClick={handleMobilePrimaryAction}
                                    disabled={mobilePrimaryDisabled}
                                    className='bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground min-h-11 min-w-0 flex-1'>
                                    {(isLoading || isSendingToEdit) && (
                                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                                    )}
                                    {mode === 'generate'
                                        ? isLoading
                                            ? t('generate.loading')
                                            : t('generate.submit')
                                        : isLoading || isSendingToEdit
                                          ? t('edit.loading')
                                          : t('edit.submit')}
                                </Button>
                                {canPausePromptBatch && (
                                    <Button
                                        type='button'
                                        variant='outline'
                                        size='icon'
                                        onClick={handlePauseBatch}
                                        disabled={isBatchPauseRequested}
                                        className='text-muted-foreground hover:text-foreground h-11 w-11 shrink-0'
                                        aria-label={
                                            isBatchPauseRequested ? t('batch.pauseRequested') : t('batch.pause')
                                        }>
                                        {isBatchPauseRequested ? (
                                            <Loader2 className='h-4 w-4 animate-spin' />
                                        ) : (
                                            <Pause className='h-4 w-4' />
                                        )}
                                    </Button>
                                )}
                                <Button
                                    type='button'
                                    variant='outline'
                                    size='icon'
                                    onClick={scrollToOutput}
                                    className='text-muted-foreground hover:text-foreground h-11 w-11 shrink-0'
                                    aria-label={t('ux.jumpToResult')}>
                                    <ArrowUp className='h-4 w-4' />
                                </Button>
                                {canOpenLogs && (
                                    <Button
                                        type='button'
                                        variant='outline'
                                        size='icon'
                                        onClick={() => setOpenLogsSignal((value) => value + 1)}
                                        className='text-muted-foreground hover:text-foreground h-11 w-11 shrink-0'
                                        aria-label={t('logs.open')}>
                                        <Activity className='h-4 w-4' />
                                    </Button>
                                )}
                            </div>
                            {mobilePrimaryDisabledReason && (
                                <p className='text-muted-foreground mx-auto mt-2 max-w-screen-sm text-center text-xs leading-4'>
                                    {mobilePrimaryDisabledReason}
                                </p>
                            )}
                        </div>
                    )}
                </>
            ) : null}
        </main>
    );
}

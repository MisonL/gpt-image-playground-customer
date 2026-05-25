import type OpenAI from 'openai';

export class ImagesApiStreamError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'ImagesApiStreamError';
        this.status = status;
    }
}

type ImagesApiStreamInput = {
    apiBaseUrl?: string;
    apiKey: string;
    abortSignal?: AbortSignal;
    params: OpenAI.Images.ImageGenerateParamsStreaming;
};

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

function buildImagesGenerateUrl(apiBaseUrl: string | undefined): string {
    const normalizedBase = (apiBaseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
    return `${normalizedBase}/images/generations`;
}

function readErrorMessage(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const { error, message: rootMessage } = body as Record<string, unknown>;
    if (error && typeof error === 'object') {
        const { message } = error as Record<string, unknown>;
        if (typeof message === 'string' && message.trim()) return message.trim();
    }
    return typeof rootMessage === 'string' && rootMessage.trim() ? rootMessage.trim() : undefined;
}

async function readResponseError(response: Response): Promise<ImagesApiStreamError> {
    const { status } = response;
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    let message = text.trim();
    if (contentType.includes('application/json') && text.trim()) {
        try {
            message = readErrorMessage(JSON.parse(text)) || message;
        } catch {
            // Keep the raw text when an upstream mislabeled a non-JSON error.
        }
    }
    return new ImagesApiStreamError(message || `Images API stream request failed with HTTP ${status}.`, status);
}

function parseSseDataPayload(raw: string): unknown | undefined {
    const normalized = raw.trim();
    if (!normalized || normalized === '[DONE]') return undefined;
    return JSON.parse(normalized);
}

async function* readEventStream(response: Response): AsyncIterable<unknown> {
    if (!response.body) return;
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += value;
            const parts = buffer.split(/\r?\n\r?\n/);
            buffer = parts.pop() || '';
            for (const part of parts) {
                const payload = readSseChunk(part);
                if (payload !== undefined) yield payload;
            }
        }
        const payload = readSseChunk(buffer);
        if (payload !== undefined) yield payload;
    } finally {
        reader.releaseLock();
    }
}

function readSseChunk(chunk: string): unknown | undefined {
    if (!chunk.trim()) return undefined;
    const dataLines = chunk
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trimStart());
    if (dataLines.length === 0) return undefined;
    return parseSseDataPayload(dataLines.join('\n'));
}

export async function createImagesApiGenerateStream(input: ImagesApiStreamInput): Promise<AsyncIterable<unknown>> {
    const { abortSignal, apiBaseUrl, apiKey, params } = input;
    const response = await fetch(buildImagesGenerateUrl(apiBaseUrl), {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream, application/json'
        },
        signal: abortSignal,
        body: JSON.stringify(params)
    });
    if (!response.ok) {
        throw await readResponseError(response);
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
        return readEventStream(response);
    }
    const body = await response.json();
    return (async function* imagesJsonAsFinalEvent() {
        yield body;
    })();
}

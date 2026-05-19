export type CreateImageShareClientValues = {
    accessCode: string;
    expiresInMinutes: number | null;
};

type CreateImageShareFromBlobOptions = {
    filename: string;
    blob: Blob;
    values: CreateImageShareClientValues;
    accessRefreshErrorMessage: string;
    createFailedMessage: string;
    refreshImageAccessCookie: () => Promise<boolean>;
    fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

export async function createImageShareFromBlob(options: CreateImageShareFromBlobOptions): Promise<{ url: string }> {
    if (!(await options.refreshImageAccessCookie())) {
        throw new Error(options.accessRefreshErrorMessage);
    }

    const form = new FormData();
    form.set('sourceFilename', options.filename);
    form.set('image', new File([options.blob], options.filename, { type: options.blob.type || 'image/png' }));

    const accessCode = options.values.accessCode.trim();
    if (accessCode) {
        form.set('accessCode', accessCode);
    }
    if (typeof options.values.expiresInMinutes === 'number') {
        form.set('expiresInMinutes', String(options.values.expiresInMinutes));
    }

    const response = await (options.fetchImpl ?? fetch)('/api/shares', { method: 'POST', body: form });
    const body = (await response.json().catch(() => ({}))) as { error?: unknown; url?: unknown };
    if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : options.createFailedMessage);
    }
    if (typeof body.url !== 'string' || !body.url) {
        throw new Error(options.createFailedMessage);
    }

    return { url: body.url };
}

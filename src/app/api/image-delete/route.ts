import fs from 'fs/promises';
import { appLogger } from '@/lib/app-logger';
import { isValidImageFilename } from '@/lib/image-request-utils';
import { outputDir, verifyPasswordHash } from '@/lib/server-runtime';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

type DeleteRequestBody = {
    filenames: string[];
    passwordHash?: string;
};

type FileDeletionResult = {
    filename: string;
    success: boolean;
    error?: string;
};

export async function POST(request: NextRequest) {
    let requestBody: DeleteRequestBody;
    try {
        requestBody = await request.json();

        const appPassword = process.env.APP_PASSWORD;
        if (appPassword) {
            const clientPasswordHash = requestBody.passwordHash;

            if (!clientPasswordHash) {
                appLogger.error('Missing password hash for delete operation.');
                return NextResponse.json({ error: 'Unauthorized: Missing password hash.' }, { status: 401 });
            }
            if (!verifyPasswordHash(clientPasswordHash, appPassword)) {
                appLogger.error('Invalid password hash for delete operation.');
                return NextResponse.json({ error: 'Unauthorized: Invalid password.' }, { status: 401 });
            }
        }
    } catch (e) {
        appLogger.error('Error parsing request body for /api/image-delete:', e);
        return NextResponse.json({ error: 'Invalid request body: Must be JSON.' }, { status: 400 });
    }

    const { filenames } = requestBody;

    if (!Array.isArray(filenames) || filenames.some((fn) => typeof fn !== 'string')) {
        return NextResponse.json({ error: 'Invalid filenames: Must be an array of strings.' }, { status: 400 });
    }

    if (filenames.length === 0) {
        return NextResponse.json({ message: 'No filenames provided to delete.', results: [] }, { status: 200 });
    }

    const deletionResults: FileDeletionResult[] = [];

    for (const filename of filenames) {
        if (!isValidImageFilename(filename)) {
            appLogger.warn(`Invalid filename for deletion: ${filename}`);
            deletionResults.push({ filename, success: false, error: 'Invalid filename format.' });
            continue;
        }

        const filepath = path.join(outputDir, filename);

        try {
            await fs.unlink(filepath);
            deletionResults.push({ filename, success: true });
        } catch (error: unknown) {
            appLogger.error(`Error deleting image ${filepath}:`, error);
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
                deletionResults.push({ filename, success: false, error: 'File not found.' });
            } else {
                deletionResults.push({ filename, success: false, error: 'Failed to delete file.' });
            }
        }
    }

    const allSucceeded = deletionResults.every((r) => r.success);

    return NextResponse.json(
        {
            message: allSucceeded ? 'All files deleted successfully.' : 'Some files could not be deleted.',
            results: deletionResults
        },
        { status: allSucceeded ? 200 : 207 } // 207 Multi-Status if some failed
    );
}

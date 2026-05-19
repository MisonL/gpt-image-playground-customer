import assert from 'node:assert/strict';

export async function* upstreamEvents(events: unknown[]) {
    for (const event of events) {
        yield event;
    }
}

export async function readSseEvents(response: Response): Promise<Array<Record<string, unknown>>> {
    const text = await response.text();
    return text
        .split('\n\n')
        .filter((part) => part.trim())
        .map((part) => {
            assert.ok(part.startsWith('data: '));
            return JSON.parse(part.slice(6)) as Record<string, unknown>;
        });
}

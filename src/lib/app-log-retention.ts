export const APP_LOG_DEFAULT_MAX_ENTRIES = 300;
export const APP_LOG_MIN_ENTRIES = 100;
export const APP_LOG_MAX_CONFIGURED_ENTRIES = 5000;
export const APP_LOG_RETENTION_STORAGE = 'bounded_local_jsonl';
export const APP_LOG_MAX_ENTRIES_ENV = 'APP_LOG_MAX_ENTRIES';
export const APP_LOG_RETENTION_LOSS_MODES = [
    'entry_evicted_by_max_entries',
    'log_level_filter',
    'local_log_file_missing_or_cleared'
] as const;

export type AppLogRetentionMetadata = {
    storage: typeof APP_LOG_RETENTION_STORAGE;
    max_entries: number;
    default_max_entries: number;
    min_entries: number;
    max_configured_entries: number;
    configured_by: typeof APP_LOG_MAX_ENTRIES_ENV;
    persisted_across_process_restart: true;
    loss_modes: typeof APP_LOG_RETENTION_LOSS_MODES;
};

function readConfiguredMaxLogEntries(env: Record<string, string | undefined>): number {
    const configured = env[APP_LOG_MAX_ENTRIES_ENV]?.trim();
    if (!configured) return APP_LOG_DEFAULT_MAX_ENTRIES;
    if (!/^\d+$/.test(configured)) return APP_LOG_DEFAULT_MAX_ENTRIES;
    const parsed = Number(configured);
    if (!Number.isSafeInteger(parsed)) return APP_LOG_DEFAULT_MAX_ENTRIES;
    return Math.min(APP_LOG_MAX_CONFIGURED_ENTRIES, Math.max(APP_LOG_MIN_ENTRIES, parsed));
}

export function readAppLogRetentionMetadata(
    env: Record<string, string | undefined> = process.env
): AppLogRetentionMetadata {
    return {
        storage: APP_LOG_RETENTION_STORAGE,
        max_entries: readConfiguredMaxLogEntries(env),
        default_max_entries: APP_LOG_DEFAULT_MAX_ENTRIES,
        min_entries: APP_LOG_MIN_ENTRIES,
        max_configured_entries: APP_LOG_MAX_CONFIGURED_ENTRIES,
        configured_by: APP_LOG_MAX_ENTRIES_ENV,
        persisted_across_process_restart: true,
        loss_modes: APP_LOG_RETENTION_LOSS_MODES
    };
}

const DIGITS_PATTERN = /^\d+$/;

export const CHINESE_POSITIVE_INTEGER_MESSAGES = Object.freeze({
    digits: ({ name }) => `${name} 必须是正整数。`,
    safeInteger: ({ name }) => `${name} 必须是正整数。`,
    min: ({ name }) => `${name} 必须是正整数。`
});

export function parsePositiveIntegerConfig(value, name, fallback, options = {}) {
    const rawValue = value === undefined || value === null ? '' : String(value).trim();
    if (!rawValue) return fallback;

    const minValue = options.minValue ?? 1;
    const messages = options.messages || CHINESE_POSITIVE_INTEGER_MESSAGES;
    const context = { name, minValue };

    if (!DIGITS_PATTERN.test(rawValue)) {
        throw new Error(messages.digits(context));
    }

    const parsed = Number(rawValue);
    if (!Number.isSafeInteger(parsed)) {
        throw new Error(messages.safeInteger(context));
    }
    if (parsed < minValue) {
        throw new Error(messages.min(context));
    }
    return parsed;
}

export function readPositiveIntegerFromEnv(env, name, fallback, options = {}) {
    return parsePositiveIntegerConfig(env[name], name, fallback, options);
}

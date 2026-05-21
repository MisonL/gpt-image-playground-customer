export function readPositiveIntegerEnv(name, defaultValue, minValue = 1) {
    const rawValue = process.env[name]?.trim();
    if (!rawValue) return defaultValue;
    if (!/^\d+$/.test(rawValue)) {
        throw new Error(`${name} must be a positive integer formatted as digits`);
    }
    const value = Number.parseInt(rawValue, 10);
    if (value < minValue) {
        throw new Error(`${name} must be a positive integer greater than or equal to ${minValue}`);
    }
    return value;
}

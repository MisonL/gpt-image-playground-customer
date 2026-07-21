const minimumNodeVersion = [22, 15, 0];

export const MIN_NODE_VERSION_RANGE = '>=22.15.0';

export function isSupportedNodeVersion(version = process.version) {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
    if (!match) return false;

    const current = match.slice(1, 4).map(Number);
    for (let index = 0; index < minimumNodeVersion.length; index += 1) {
        if (current[index] > minimumNodeVersion[index]) return true;
        if (current[index] < minimumNodeVersion[index]) return false;
    }
    return true;
}

import net from 'node:net';

/**
 * Return true only for addresses that are safe to contact as public upstreams.
 * Mapped, translated, compatible and 6to4 IPv4 forms are normalized before
 * applying the IPv4 reserved-range checks.
 */
export function isPublicIpAddress(address: string): boolean {
    const normalized = address.trim().replace(/^\[|\]$/g, '');
    if (net.isIPv4(normalized)) return isPublicIpv4(normalized);
    if (!net.isIPv6(normalized)) return false;
    const hextets = parseIpv6Hextets(normalized);
    if (!hextets) return false;
    const allZero = hextets.every((value) => value === 0);
    if (allZero || (hextets.slice(0, 7).every((value) => value === 0) && hextets[7] === 1)) return false;

    const mappedIpv4 = readMappedIpv4FromHextets(hextets);
    if (mappedIpv4 !== undefined) return isPublicIpv4(mappedIpv4);
    const translatedIpv4 = readTranslatedIpv4FromHextets(hextets);
    if (translatedIpv4 !== undefined) return isPublicIpv4(translatedIpv4);
    const compatibleIpv4 = readCompatibleIpv4FromHextets(hextets);
    if (compatibleIpv4 !== undefined) return isPublicIpv4(compatibleIpv4);
    if ((hextets[0] & 0xfe00) === 0xfc00) return false;
    if ((hextets[0] & 0xffc0) === 0xfe80 || (hextets[0] & 0xffc0) === 0xfec0) return false;
    if ((hextets[0] & 0xff00) === 0xff00) return false;
    if (hextets[0] === 0x0064 && hextets[1] === 0xff9b) return false;
    if (hextets[0] === 0x2002) return isPublicIpv4(ipv4FromHextets(hextets[1], hextets[2]));
    return true;
}

/**
 * Some local transparent DNS/proxy setups map public hostnames into the
 * RFC 2544 benchmarking range before intercepting the connection. This range
 * is never treated as public; callers must opt in explicitly when they know
 * the network path is an intentional synthetic-DNS proxy.
 */
export function isSyntheticDnsIpAddress(address: string): boolean {
    const normalized = address.trim().replace(/^\[|\]$/g, '');
    if (!net.isIPv4(normalized)) return false;
    const octets = normalized.split('.').map(Number);
    return octets.length === 4 && octets[0] === 198 && (octets[1] === 18 || octets[1] === 19);
}

export function isLoopbackIpAddress(address: string): boolean {
    const normalized = address.replace(/^\[|\]$/g, '');
    if (net.isIPv4(normalized)) return isLoopbackIpv4(normalized);
    if (!net.isIPv6(normalized)) return false;
    const hextets = parseIpv6Hextets(normalized);
    if (!hextets) return false;
    if (hextets.slice(0, 7).every((value) => value === 0) && hextets[7] === 1) return true;
    const embeddedIpv4 =
        readMappedIpv4FromHextets(hextets) ??
        readTranslatedIpv4FromHextets(hextets) ??
        readCompatibleIpv4FromHextets(hextets);
    return embeddedIpv4 !== undefined && isLoopbackIpv4(embeddedIpv4);
}

function isPublicIpv4(address: string): boolean {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
        return false;
    }
    const [a, b, c] = octets;
    return !(
        a === 0 ||
        a === 10 ||
        (a === 100 && b >= 64 && b <= 127) ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && (b === 0 || b === 168)) ||
        (a === 192 && b === 88 && c === 99) ||
        (a === 198 && (b === 18 || b === 19 || b === 51)) ||
        (a === 203 && b === 0 && c === 113) ||
        a >= 224
    );
}

function isLoopbackIpv4(address: string): boolean {
    const octets = address.split('.').map(Number);
    return (
        octets.length === 4 &&
        octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
        octets[0] === 127
    );
}

function parseIpv6Hextets(address: string): number[] | undefined {
    let normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
    if (normalized.includes('%')) return undefined;
    if (normalized.includes('.')) {
        const separator = normalized.lastIndexOf(':');
        const ipv4 = normalized.slice(separator + 1);
        if (separator < 0 || !net.isIPv4(ipv4)) return undefined;
        const octets = ipv4.split('.').map(Number);
        normalized = `${normalized.slice(0, separator)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    }
    const compressionIndex = normalized.indexOf('::');
    if (compressionIndex >= 0 && normalized.indexOf('::', compressionIndex + 2) >= 0) return undefined;
    const leftText = compressionIndex >= 0 ? normalized.slice(0, compressionIndex) : normalized;
    const rightText = compressionIndex >= 0 ? normalized.slice(compressionIndex + 2) : '';
    const left = leftText ? leftText.split(':') : [];
    const right = rightText ? rightText.split(':') : [];
    const parsePart = (part: string): number | undefined => {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return undefined;
        return Number.parseInt(part, 16);
    };
    const leftValues = left.map(parsePart);
    const rightValues = right.map(parsePart);
    if (leftValues.some((value) => value === undefined) || rightValues.some((value) => value === undefined)) {
        return undefined;
    }
    const values = [...(leftValues as number[]), ...(rightValues as number[])];
    if (compressionIndex < 0) return values.length === 8 ? values : undefined;
    const missing = 8 - values.length;
    if (missing < 1) return undefined;
    return [...(leftValues as number[]), ...Array.from({ length: missing }, () => 0), ...(rightValues as number[])];
}

function readMappedIpv4FromHextets(hextets: number[]): string | undefined {
    if (hextets.slice(0, 5).some((value) => value !== 0) || hextets[5] !== 0xffff) return undefined;
    return ipv4FromHextets(hextets[6], hextets[7]);
}

function readTranslatedIpv4FromHextets(hextets: number[]): string | undefined {
    if (hextets.slice(0, 4).some((value) => value !== 0) || hextets[4] !== 0xffff || hextets[5] !== 0) {
        return undefined;
    }
    return ipv4FromHextets(hextets[6], hextets[7]);
}

function readCompatibleIpv4FromHextets(hextets: number[]): string | undefined {
    if (hextets.slice(0, 6).some((value) => value !== 0)) return undefined;
    return ipv4FromHextets(hextets[6], hextets[7]);
}

function ipv4FromHextets(high: number, low: number): string {
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

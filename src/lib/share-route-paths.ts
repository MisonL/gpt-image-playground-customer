type ShareApiPathInput = {
    pathname: string;
    token: string;
    suffix?: string;
};

export function buildShareApiPath({ pathname, token, suffix }: ShareApiPathInput): string {
    const tokenPath = encodeURIComponent(token);
    const suffixPath = suffix ? `/${suffix.replace(/^\/+/, '')}` : '';
    return `${resolveShareBasePath(pathname, tokenPath)}/api/shares/${tokenPath}${suffixPath}`;
}

function resolveShareBasePath(pathname: string, tokenPath: string): string {
    const normalizedPath = pathname || '/';
    const trimmedPath = normalizedPath.length > 1 ? normalizedPath.replace(/\/+$/, '') : normalizedPath;
    const sharePath = `/share/${tokenPath}`;
    if (trimmedPath.endsWith(sharePath)) {
        return trimmedPath.slice(0, -sharePath.length) || '';
    }
    const shareIndex = trimmedPath.lastIndexOf('/share/');
    if (shareIndex > -1) return trimmedPath.slice(0, shareIndex);
    return '';
}

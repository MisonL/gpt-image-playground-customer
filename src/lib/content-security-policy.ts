export function buildContentSecurityPolicy(nonce: string | undefined, development = false): string {
    const normalizedNonce = nonce?.trim();
    const scriptNonce = normalizedNonce ? " 'nonce-" + normalizedNonce + "' 'strict-dynamic'" : '';
    const developmentEval = development ? " 'unsafe-eval'" : '';
    return (
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; " +
        "script-src 'self'" +
        scriptNonce +
        developmentEval +
        '; ' +
        "style-src 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; " +
        "img-src 'self' data: blob: https: http://localhost:*; font-src 'self' data:; " +
        "connect-src 'self' https: http://localhost:* ws: wss:; frame-src 'self'"
    );
}

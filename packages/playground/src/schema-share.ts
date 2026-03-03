function bytesToBase64(bytes: Uint8Array): string {
    const nodeBuffer = (globalThis as { Buffer?: { from: (value: Uint8Array | string, encoding?: string) => { toString: (encoding: string) => string } } }).Buffer;
    if (typeof btoa === 'undefined' && nodeBuffer) {
        return nodeBuffer.from(bytes).toString('base64');
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
    const nodeBuffer = (globalThis as { Buffer?: { from: (value: string, encoding: string) => Uint8Array } }).Buffer;
    if (typeof atob === 'undefined' && nodeBuffer) {
        return new Uint8Array(nodeBuffer.from(base64, 'base64'));
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export function encodeSchemaForUrl(schema: string): string {
    const bytes = new TextEncoder().encode(schema);
    return bytesToBase64(bytes)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

export function decodeSchemaFromUrl(value: string): string | null {
    if (!value) return null;
    try {
        const normalized = value
            .replace(/-/g, '+')
            .replace(/_/g, '/')
            .padEnd(Math.ceil(value.length / 4) * 4, '=');
        const bytes = base64ToBytes(normalized);
        return new TextDecoder().decode(bytes);
    } catch {
        return null;
    }
}

import { vi } from 'vitest';

export function captureStdout() {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
    }) as never);

    return {
        chunks,
        spy,
        text: () => chunks.join('').trim(),
    };
}

export function mockProcessExitToThrow() {
    return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code ?? 0})`);
    }) as never);
}

export function captureConsole(method: 'log' | 'warn' | 'error' = 'log') {
    const lines: string[] = [];
    const spy = vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => String(arg)).join(' '));
    });

    return {
        lines,
        spy,
        text: () => lines.join('\n'),
    };
}

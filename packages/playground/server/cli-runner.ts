import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CliGenerateResult, CliRunnerRequest } from './types.js';

export interface CliRunnerConfig {
    repoRoot: string;
    cliPath: string;
    timeoutMs?: number;
}

interface CliRunnerDeps {
    accessImpl?: typeof access;
    mkdtempImpl?: typeof mkdtemp;
    writeFileImpl?: typeof writeFile;
    rmImpl?: typeof rm;
    spawnImpl?: (command: string, args: string[], options: SpawnOptions) => ChildProcessWithoutNullStreams;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export async function runCliGenerate(
    request: CliRunnerRequest,
    config: CliRunnerConfig,
    deps: CliRunnerDeps = {}
): Promise<CliGenerateResult> {
    const accessImpl = deps.accessImpl ?? access;
    const mkdtempImpl = deps.mkdtempImpl ?? mkdtemp;
    const writeFileImpl = deps.writeFileImpl ?? writeFile;
    const rmImpl = deps.rmImpl ?? rm;
    const spawnImpl = deps.spawnImpl ?? spawn;

    await accessImpl(config.cliPath);

    const tempDir = await mkdtempImpl(join(tmpdir(), 'backgen-playground-'));
    const schemaPath = join(tempDir, 'schema.prisma');
    const outputDir = join(tempDir, 'generated');

    try {
        await writeFileImpl(schemaPath, request.schema, 'utf8');

        const args = [
            config.cliPath,
            'generate',
            '--schema',
            schemaPath,
            '--output',
            outputDir,
            '--dry-run',
            '--force',
            '--json',
        ];

        if (request.only) {
            args.push('--only', request.only);
        }

        return await new Promise<CliGenerateResult>((resolveResult) => {
            const child = spawnImpl(process.execPath, args, {
                cwd: resolve(config.repoRoot),
                stdio: 'pipe',
            });

            const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                child.kill('SIGKILL');
            }, timeoutMs);

            const stdoutChunks: string[] = [];
            const stderrChunks: string[] = [];

            child.stdout?.on('data', (chunk: Buffer | string) => {
                stdoutChunks.push(chunk.toString());
            });

            child.stderr?.on('data', (chunk: Buffer | string) => {
                stderrChunks.push(chunk.toString());
            });

            child.on('error', (error) => {
                clearTimeout(timer);
                resolveResult({
                    success: false,
                    error: {
                        stage: 'unknown',
                        message: `Failed to run CLI: ${error.message}`,
                    },
                });
            });

            child.on('close', () => {
                clearTimeout(timer);
                const stdout = stdoutChunks.join('').trim();

                if (timedOut) {
                    resolveResult({
                        success: false,
                        error: {
                            stage: 'unknown',
                            message: `Generation timed out after ${timeoutMs}ms.`,
                        },
                    });
                    return;
                }

                if (!stdout) {
                    const stderr = stderrChunks.join('').trim();
                    resolveResult({
                        success: false,
                        error: {
                            stage: 'unknown',
                            message: stderr || 'CLI returned empty output.',
                        },
                    });
                    return;
                }

                try {
                    const parsed = JSON.parse(stdout) as CliGenerateResult;
                    resolveResult(parsed);
                } catch {
                    const stderr = stderrChunks.join('').trim();
                    resolveResult({
                        success: false,
                        error: {
                            stage: 'unknown',
                            message: stderr || 'CLI returned non-JSON output.',
                        },
                    });
                }
            });
        });
    } finally {
        await rmImpl(tempDir, { recursive: true, force: true });
    }
}

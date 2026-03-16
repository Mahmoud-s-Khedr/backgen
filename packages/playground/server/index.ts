import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createApp } from './app.js';

const playgroundRoot = process.cwd();
const repoRoot = resolve(playgroundRoot, '..', '..');
const cliPath = resolve(repoRoot, 'dist/generator/cli.js');
const clientDistDir = resolve(playgroundRoot, 'dist/client');
const port = Number(process.env.PORT || '4173');

if (!existsSync(cliPath)) {
    console.error('Missing CLI bundle at dist/generator/cli.js. Run `pnpm run build` in the repository root first.');
    process.exit(1);
}

async function start() {
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
        const app = createApp({
            cliRunnerConfig: {
                repoRoot,
                cliPath,
                timeoutMs: 20_000,
            },
            isProduction: true,
            clientDistDir,
        });
        app.listen(port, () => {
            console.log(`playground server listening on http://localhost:${port}`);
        });
        return;
    }

    const app = createApp({
        cliRunnerConfig: {
            repoRoot,
            cliPath,
            timeoutMs: 20_000,
        },
    });

    const vite = await createViteServer({
        root: playgroundRoot,
        configFile: resolve(playgroundRoot, 'vite.config.ts'),
        server: {
            middlewareMode: true,
        },
        appType: 'spa',
    });

    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
        try {
            const url = req.originalUrl;
            const templatePath = resolve(playgroundRoot, 'index.html');
            let template = readFileSync(templatePath, 'utf8');
            template = await vite.transformIndexHtml(url, template);
            res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
        } catch (error) {
            vite.ssrFixStacktrace(error as Error);
            next(error);
        }
    });

    app.listen(port, () => {
        console.log(`playground dev server listening on http://localhost:${port}`);
    });
}

start().catch((error) => {
    console.error(error);
    process.exit(1);
});

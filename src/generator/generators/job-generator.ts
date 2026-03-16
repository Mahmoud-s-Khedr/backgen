import type { GeneratedFile } from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';

/**
 * Generate background job scaffolding files.
 * Only called when --jobs flag is provided.
 */
export function generateJobFiles(jobsProvider: 'bullmq' | 'pg-boss'): GeneratedFile[] {
    const data = { jobsProvider };

    return [
        {
            path: 'src/jobs/queue.ts',
            content: renderTemplate('jobs/queue.ts.ejs', data),
        },
        {
            path: 'src/jobs/worker.ts',
            content: renderTemplate('jobs/worker.ts.ejs', data),
        },
        {
            path: 'src/jobs/example.job.ts',
            content: renderTemplate('jobs/example.job.ts.ejs', data),
        },
    ];
}

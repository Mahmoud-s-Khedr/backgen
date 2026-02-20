/**
 * Build script: reads all EJS templates and generates a TypeScript module
 * that exports them as a Map<string, string> for browser use.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative } from 'path';

const TEMPLATES_DIR = join(import.meta.dirname, '..', '..', 'src', 'templates');
const OUT_FILE = join(import.meta.dirname, 'src', 'generated', 'templates.ts');

function collectTemplates(dir, base = dir) {
    const entries = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            entries.push(...collectTemplates(fullPath, base));
        } else if (entry.name.endsWith('.ejs')) {
            const relPath = relative(base, fullPath);
            const content = readFileSync(fullPath, 'utf-8');
            entries.push({ path: relPath, content });
        }
    }
    return entries;
}

const templates = collectTemplates(TEMPLATES_DIR);

let output = '// AUTO-GENERATED — do not edit. Run: node build-templates.js\n';
output += 'export const TEMPLATES = new Map<string, string>([\n';
for (const t of templates) {
    output += `  [${JSON.stringify(t.path)}, ${JSON.stringify(t.content)}],\n`;
}
output += ']);\n';

mkdirSync(join(import.meta.dirname, 'src', 'generated'), { recursive: true });
writeFileSync(OUT_FILE, output, 'utf-8');
console.log(`Generated ${templates.length} templates → ${OUT_FILE}`);

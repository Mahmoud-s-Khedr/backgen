import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import JSZip from 'jszip';
import { generateFromSchema, type GenerationResult } from './generator.js';
import { INSTRUCTION_SECTIONS, SCHEMA_EXAMPLES, COMMON_MISTAKES } from './schema-instructions.js';
import { decodeSchemaFromUrl, encodeSchemaForUrl } from './schema-share.js';
import { buildMetadataFile, buildZipFileName } from './zip.js';
import {
    THEME_STORAGE_KEY,
    WORKSPACE_TABS,
    normalizeWorkspaceTab,
    resolveThemeMode,
    toggleThemeMode,
    type ThemeMode,
    type WorkspaceTab,
} from './ui-state.js';

const DEFAULT_SCHEMA = SCHEMA_EXAMPLES.find((example) => example.id === 'auth')!.schema;
const TAB_ORDER = ['start', 'models', 'directives', 'examples'] as const;
type TabId = typeof TAB_ORDER[number];
const COMPACT_BREAKPOINT_QUERY = '(max-width: 1199px)';

const EMPTY_RESULT: GenerationResult = {
    files: [],
    warnings: [],
    errors: [],
    modelCount: 0,
    enumCount: 0,
};

export function App() {
    const [schema, setSchema] = useState(DEFAULT_SCHEMA);
    const [result, setResult] = useState<GenerationResult>(EMPTY_RESULT);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<TabId>('start');
    const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>('editor');
    const [helpOpen, setHelpOpen] = useState(false);
    const [copyStatus, setCopyStatus] = useState('');
    const [isCompactLayout, setIsCompactLayout] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.matchMedia(COMPACT_BREAKPOINT_QUERY).matches;
    });
    const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
        if (typeof window === 'undefined') return 'dark';
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
        const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
        return resolveThemeMode(stored, prefersDark);
    });

    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const latestGenerationRef = useRef(0);

    const runGeneration = useCallback(async (schemaContent: string) => {
        const generationId = latestGenerationRef.current + 1;
        latestGenerationRef.current = generationId;

        const generated = await generateFromSchema(schemaContent);
        if (generationId !== latestGenerationRef.current) return;

        setResult(generated);
        setSelectedFile((current) => {
            if (current && generated.files.some((file) => file.path === current)) {
                return current;
            }
            return generated.files[0]?.path ?? null;
        });
    }, []);

    useEffect(() => {
        const media = window.matchMedia(COMPACT_BREAKPOINT_QUERY);
        const sync = () => setIsCompactLayout(media.matches);
        sync();
        media.addEventListener('change', sync);
        return () => media.removeEventListener('change', sync);
    }, []);

    useEffect(() => {
        document.documentElement.dataset.theme = themeMode;
        window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    }, [themeMode]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const encoded = params.get('schema');
        const decoded = encoded ? decodeSchemaFromUrl(encoded) : null;
        const initialSchema = decoded ?? DEFAULT_SCHEMA;
        setSchema(initialSchema);
        void runGeneration(initialSchema);
    }, [runGeneration]);

    const handleSchemaChange = useCallback((value: string | undefined) => {
        const nextSchema = value ?? '';
        setSchema(nextSchema);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            void runGeneration(nextSchema);
        }, 350);
    }, [runGeneration]);

    const applyExample = useCallback((exampleId: string) => {
        const example = SCHEMA_EXAMPLES.find((item) => item.id === exampleId);
        if (!example) return;
        setSchema(example.schema);
        setActiveTab('examples');
        setActiveWorkspaceTab('editor');
        void runGeneration(example.schema);
    }, [runGeneration]);

    const shareSchema = useCallback(async () => {
        const encoded = encodeSchemaForUrl(schema);
        const target = new URL(window.location.href);
        target.searchParams.set('schema', encoded);
        const value = target.toString();
        window.history.replaceState(null, '', target);
        try {
            await navigator.clipboard.writeText(value);
            setCopyStatus('Share link copied');
        } catch {
            setCopyStatus('Copy failed in this browser');
        }
        window.setTimeout(() => setCopyStatus(''), 1800);
    }, [schema]);

    const downloadZip = useCallback(async () => {
        if (result.files.length === 0) return;
        const now = new Date();
        const zip = new JSZip();
        for (const file of result.files) {
            zip.file(file.path, file.content);
        }
        const metadata = buildMetadataFile(result, now);
        zip.file(metadata.path, metadata.content);

        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = buildZipFileName(now);
        a.click();
        URL.revokeObjectURL(url);
    }, [result]);

    const fileTree = useMemo(() => {
        const grouped = new Map<string, string[]>();
        for (const file of result.files) {
            const parts = file.path.split('/');
            const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
            if (!grouped.has(dir)) grouped.set(dir, []);
            grouped.get(dir)!.push(file.path);
        }
        for (const paths of grouped.values()) {
            paths.sort((a, b) => a.localeCompare(b));
        }
        return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    }, [result.files]);

    const selectedContent = result.files.find((file) => file.path === selectedFile)?.content ?? '';
    const activeSection = INSTRUCTION_SECTIONS.find((section) => section.id === activeTab)!;
    const editorTheme = themeMode === 'dark' ? 'vs-dark' : 'vs';

    const setWorkspaceTab = useCallback((tab: WorkspaceTab) => {
        setActiveWorkspaceTab(normalizeWorkspaceTab(tab));
    }, []);

    const openHelp = useCallback(() => {
        if (isCompactLayout) {
            setWorkspaceTab('help');
            return;
        }
        setHelpOpen((current) => !current);
    }, [isCompactLayout, setWorkspaceTab]);

    const showPane = useCallback((pane: WorkspaceTab) => !isCompactLayout || activeWorkspaceTab === pane, [activeWorkspaceTab, isCompactLayout]);

    return (
        <div className="app-shell">
            <header className="topbar" role="banner">
                <div className="branding">
                    <p className="eyebrow">Backgen Playground</p>
                    <h1>Generate backend scaffolds directly from Prisma</h1>
                    <p className="subtitle">Draft schema, inspect generated files, and export a runnable backend ZIP.</p>
                </div>
                <div className="topbar-actions">
                    <span className="chip">{result.files.length} files</span>
                    <span className="chip">{result.modelCount} models</span>
                    <span className="chip">{result.enumCount} enums</span>
                    <button type="button" className="btn" onClick={shareSchema}>Share Schema</button>
                    <button type="button" className="btn" onClick={downloadZip} disabled={result.files.length === 0}>
                        Download ZIP
                    </button>
                    <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setThemeMode((current) => toggleThemeMode(current))}
                        aria-label="Toggle light and dark theme"
                    >
                        {themeMode === 'dark' ? 'Light Mode' : 'Dark Mode'}
                    </button>
                    <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={openHelp}
                        aria-pressed={!isCompactLayout && helpOpen}
                        aria-label="Toggle guide panel"
                    >
                        {isCompactLayout ? 'Guide' : helpOpen ? 'Hide Guide' : 'Show Guide'}
                    </button>
                </div>
            </header>

            <section className="quick-actions" aria-label="Schema quick actions">
                {SCHEMA_EXAMPLES.map((example) => (
                    <button
                        key={example.id}
                        type="button"
                        className="quick-action"
                        onClick={() => applyExample(example.id)}
                        aria-label={`Insert ${example.label} schema example`}
                    >
                        <span className="quick-action-title">{example.label}</span>
                        <span className="quick-action-desc">{example.description}</span>
                    </button>
                ))}
            </section>

            {copyStatus && (
                <div className="status-banner" role="status" aria-live="polite">{copyStatus}</div>
            )}

            {isCompactLayout && (
                <nav className="workspace-tabs" aria-label="Workspace sections">
                    {WORKSPACE_TABS.map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            className={`workspace-tab ${activeWorkspaceTab === tab ? 'active' : ''}`}
                            onClick={() => setWorkspaceTab(tab)}
                        >
                            {workspaceTabLabel(tab)}
                        </button>
                    ))}
                </nav>
            )}

            <div className="workspace-frame">
                <main className="workspace-grid" role="main">
                    <section className={`panel pane-editor ${showPane('editor') ? '' : 'is-hidden'}`} aria-label="Schema editor">
                        <div className="panel-head">
                            <span>schema.prisma</span>
                        </div>
                        <div className="editor-wrap">
                            <Editor
                                defaultLanguage="prisma"
                                value={schema}
                                onChange={handleSchemaChange}
                                theme={editorTheme}
                                options={{
                                    minimap: { enabled: false },
                                    fontSize: 13,
                                    lineNumbers: 'on',
                                    wordWrap: 'on',
                                    scrollBeyondLastLine: false,
                                }}
                            />
                        </div>

                        {result.errors.length > 0 && (
                            <div className="messages error" role="alert">
                                <h3>Generation errors</h3>
                                {result.errors.map((error, i) => <p key={`${error}-${i}`}>{error}</p>)}
                            </div>
                        )}

                        {result.warnings.length > 0 && (
                            <div className="messages warning" role="status" aria-live="polite">
                                <h3>Warnings</h3>
                                {result.warnings.map((warning, i) => <p key={`${warning}-${i}`}>{warning}</p>)}
                            </div>
                        )}
                    </section>

                    <section className={`panel pane-files ${showPane('files') ? '' : 'is-hidden'}`} aria-label="Generated file explorer">
                        <div className="panel-head">
                            <span>Generated Files</span>
                        </div>
                        <div className="files-scroll">
                            {fileTree.length === 0 && (
                                <p className="empty-state">No generated files yet.</p>
                            )}
                            {fileTree.map(([dir, paths]) => (
                                <div key={dir}>
                                    <div className="dir-row">{dir}/</div>
                                    {paths.map((path) => {
                                        const filename = path.split('/').pop();
                                        const isSelected = path === selectedFile;
                                        return (
                                            <button
                                                key={path}
                                                type="button"
                                                className={`file-row ${isSelected ? 'selected' : ''}`}
                                                onClick={() => {
                                                    setSelectedFile(path);
                                                    if (isCompactLayout) setWorkspaceTab('preview');
                                                }}
                                            >
                                                {filename}
                                            </button>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className={`panel pane-preview ${showPane('preview') ? '' : 'is-hidden'}`} aria-label="Generated file preview">
                        <div className="panel-head">
                            <span>{selectedFile ?? 'Select a generated file'}</span>
                        </div>
                        <div className="editor-wrap">
                            <Editor
                                key={selectedFile}
                                language={getLanguage(selectedFile ?? '')}
                                value={selectedContent}
                                theme={editorTheme}
                                options={{
                                    readOnly: true,
                                    minimap: { enabled: false },
                                    fontSize: 13,
                                    lineNumbers: 'on',
                                    scrollBeyondLastLine: false,
                                }}
                            />
                        </div>

                        {result.files.length > 0 && (
                            <div className="next-steps">
                                <h3>Next steps</h3>
                                <ol>
                                    <li><code>pnpm install</code></li>
                                    <li><code>cp .env.example .env</code></li>
                                    <li><code>pnpm exec prisma migrate dev --name init</code></li>
                                    <li><code>pnpm dev</code></li>
                                </ol>
                            </div>
                        )}
                    </section>

                    {isCompactLayout && (
                        <section className={`panel pane-help ${showPane('help') ? '' : 'is-hidden'}`} aria-label="Schema guide">
                            <HelpContent
                                activeTab={activeTab}
                                setActiveTab={setActiveTab}
                                activeSection={activeSection}
                                applyExample={applyExample}
                            />
                        </section>
                    )}
                </main>

                {!isCompactLayout && (
                    <aside className={`help-drawer ${helpOpen ? 'open' : ''}`} aria-label="Schema guide drawer">
                        <HelpContent
                            activeTab={activeTab}
                            setActiveTab={setActiveTab}
                            activeSection={activeSection}
                            applyExample={applyExample}
                        />
                    </aside>
                )}
            </div>
        </div>
    );
}

interface HelpContentProps {
    activeTab: TabId;
    setActiveTab: (tab: TabId) => void;
    activeSection: {
        intro: string;
        bullets: string[];
        code?: string;
    };
    applyExample: (id: string) => void;
}

function HelpContent({ activeTab, setActiveTab, activeSection, applyExample }: HelpContentProps) {
    return (
        <>
            <div className="panel-head">
                <span>How to Write Schema</span>
            </div>
            <div className="tab-row" role="tablist" aria-label="Schema help tabs">
                {TAB_ORDER.map((tab) => {
                    const section = INSTRUCTION_SECTIONS.find((item) => item.id === tab)!;
                    return (
                        <button
                            key={tab}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab}
                            className={`tab ${activeTab === tab ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {section.label}
                        </button>
                    );
                })}
            </div>
            <div className="help-content">
                <p>{activeSection.intro}</p>
                <ul>
                    {activeSection.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                    ))}
                </ul>

                {activeSection.code && (
                    <pre>
                        <code>{activeSection.code}</code>
                    </pre>
                )}

                {activeTab === 'examples' && (
                    <div className="example-actions">
                        {SCHEMA_EXAMPLES.map((example) => (
                            <button key={example.id} type="button" onClick={() => applyExample(example.id)}>
                                {example.label}
                            </button>
                        ))}
                    </div>
                )}

                <div className="checklist">
                    <h3>Fix common mistakes</h3>
                    <ul>
                        {COMMON_MISTAKES.map((mistake) => <li key={mistake}>{mistake}</li>)}
                    </ul>
                </div>
            </div>
        </>
    );
}

function workspaceTabLabel(tab: WorkspaceTab): string {
    switch (tab) {
        case 'editor':
            return 'Editor';
        case 'files':
            return 'Files';
        case 'preview':
            return 'Preview';
        case 'help':
            return 'Guide';
        default:
            return 'Editor';
    }
}

function getLanguage(path: string): string {
    if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
    if (path.endsWith('.json')) return 'json';
    if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml';
    if (path.endsWith('.md')) return 'markdown';
    if (path.endsWith('Dockerfile')) return 'dockerfile';
    if (path.endsWith('.prisma')) return 'prisma';
    return 'plaintext';
}

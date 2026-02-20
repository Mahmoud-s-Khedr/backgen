import { useState, useCallback, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { parsePrismaSchema, generateProject, type GeneratedFile } from './generator.js';
import JSZip from 'jszip';

const DEFAULT_SCHEMA = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  USER
  ADMIN
}

/// @bcm.protected
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  /// @bcm.writeOnly
  password  String
  role      Role     @default(USER)
  name      String?
  /// @bcm.readonly
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  posts     Post[]
}

/// @bcm.softDelete
model Post {
  id        String    @id @default(cuid())
  /// @bcm.searchable
  title     String
  content   String?
  authorId  String
  author    User      @relation(fields: [authorId], references: [id])
  deletedAt DateTime?
}
`;

export function App() {
    const [schema, setSchema] = useState(DEFAULT_SCHEMA);
    const [files, setFiles] = useState<GeneratedFile[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();

    const generate = useCallback((schemaContent: string) => {
        try {
            const parsed = parsePrismaSchema(schemaContent);
            const generated = generateProject(parsed, schemaContent);
            setFiles(generated);
            setError(null);
            if (!selectedFile || !generated.find(f => f.path === selectedFile)) {
                setSelectedFile(generated[0]?.path ?? null);
            }
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
            setFiles([]);
        }
    }, [selectedFile]);

    useEffect(() => {
        generate(schema);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSchemaChange = useCallback((value: string | undefined) => {
        const v = value ?? '';
        setSchema(v);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => generate(v), 300);
    }, [generate]);

    const handleDownload = useCallback(async () => {
        const zip = new JSZip();
        for (const file of files) {
            zip.file(file.path, file.content);
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'generated-api.zip';
        a.click();
        URL.revokeObjectURL(url);
    }, [files]);

    const selectedContent = files.find(f => f.path === selectedFile)?.content ?? '';

    // Group files by directory
    const fileTree = new Map<string, string[]>();
    for (const f of files) {
        const parts = f.path.split('/');
        const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
        if (!fileTree.has(dir)) fileTree.set(dir, []);
        fileTree.get(dir)!.push(f.path);
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1e1e1e', color: '#d4d4d4' }}>
            {/* Header */}
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: '#252526', borderBottom: '1px solid #3c3c3c' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <h1 style={{ fontSize: 16, fontWeight: 600, color: '#e0e0e0' }}>Backend Creator Playground</h1>
                    <span style={{ fontSize: 12, color: '#888', background: '#333', padding: '2px 8px', borderRadius: 4 }}>
                        {files.length} files
                    </span>
                </div>
                <button
                    onClick={handleDownload}
                    disabled={files.length === 0}
                    style={{
                        padding: '6px 16px', borderRadius: 4, border: 'none', cursor: 'pointer',
                        background: files.length > 0 ? '#0e639c' : '#555', color: '#fff', fontSize: 13,
                    }}
                >
                    Download ZIP
                </button>
            </header>

            {/* Main content */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* Left: Schema editor */}
                <div style={{ width: '35%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #3c3c3c' }}>
                    <div style={{ padding: '6px 12px', background: '#2d2d2d', fontSize: 12, color: '#aaa', borderBottom: '1px solid #3c3c3c' }}>
                        schema.prisma
                    </div>
                    <div style={{ flex: 1 }}>
                        <Editor
                            defaultLanguage="prisma"
                            value={schema}
                            onChange={handleSchemaChange}
                            theme="vs-dark"
                            options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: 'on', wordWrap: 'on', scrollBeyondLastLine: false }}
                        />
                    </div>
                    {error && (
                        <div style={{ padding: 8, background: '#5a1d1d', color: '#f48771', fontSize: 12, maxHeight: 80, overflow: 'auto' }}>
                            {error}
                        </div>
                    )}
                </div>

                {/* Center: File tree */}
                <div style={{ width: '20%', overflow: 'auto', borderRight: '1px solid #3c3c3c', background: '#252526' }}>
                    <div style={{ padding: '6px 12px', background: '2d2d2d', fontSize: 12, color: '#aaa', borderBottom: '1px solid #3c3c3c' }}>
                        Generated Files
                    </div>
                    {Array.from(fileTree.entries()).map(([dir, paths]) => (
                        <div key={dir} style={{ marginBottom: 4 }}>
                            <div style={{ padding: '4px 12px', fontSize: 11, color: '#888', fontWeight: 600 }}>{dir}/</div>
                            {paths.map(path => {
                                const filename = path.split('/').pop();
                                const isSelected = path === selectedFile;
                                return (
                                    <div
                                        key={path}
                                        onClick={() => setSelectedFile(path)}
                                        style={{
                                            padding: '3px 12px 3px 24px', fontSize: 12, cursor: 'pointer',
                                            background: isSelected ? '#094771' : 'transparent',
                                            color: isSelected ? '#fff' : '#ccc',
                                        }}
                                    >
                                        {filename}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>

                {/* Right: File preview */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '6px 12px', background: '#2d2d2d', fontSize: 12, color: '#aaa', borderBottom: '1px solid #3c3c3c' }}>
                        {selectedFile ?? 'Select a file'}
                    </div>
                    <div style={{ flex: 1 }}>
                        <Editor
                            key={selectedFile}
                            language={getLanguage(selectedFile ?? '')}
                            value={selectedContent}
                            theme="vs-dark"
                            options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, lineNumbers: 'on', scrollBeyondLastLine: false }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
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

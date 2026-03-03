export const THEME_STORAGE_KEY = 'backgen-playground-theme';

export const WORKSPACE_TABS = ['editor', 'files', 'preview', 'help'] as const;

export type ThemeMode = 'light' | 'dark';
export type WorkspaceTab = typeof WORKSPACE_TABS[number];

export function resolveThemeMode(storedValue: string | null, prefersDark: boolean): ThemeMode {
    if (storedValue === 'light' || storedValue === 'dark') return storedValue;
    return prefersDark ? 'dark' : 'light';
}

export function toggleThemeMode(mode: ThemeMode): ThemeMode {
    return mode === 'dark' ? 'light' : 'dark';
}

export function normalizeWorkspaceTab(value: string | null | undefined): WorkspaceTab {
    if (value && WORKSPACE_TABS.includes(value as WorkspaceTab)) {
        return value as WorkspaceTab;
    }
    return 'editor';
}

import { describe, expect, it } from 'vitest';
import {
    THEME_STORAGE_KEY,
    normalizeWorkspaceTab,
    resolveThemeMode,
    toggleThemeMode,
} from './ui-state.js';

describe('ui-state helpers', () => {
    it('uses stored theme when valid', () => {
        expect(resolveThemeMode('dark', false)).toBe('dark');
        expect(resolveThemeMode('light', true)).toBe('light');
    });

    it('falls back to system preference when no valid stored theme exists', () => {
        expect(resolveThemeMode(null, true)).toBe('dark');
        expect(resolveThemeMode('invalid', false)).toBe('light');
    });

    it('toggles theme modes deterministically', () => {
        expect(toggleThemeMode('dark')).toBe('light');
        expect(toggleThemeMode('light')).toBe('dark');
    });

    it('normalizes workspace tabs to a safe default', () => {
        expect(normalizeWorkspaceTab('help')).toBe('help');
        expect(normalizeWorkspaceTab('preview')).toBe('preview');
        expect(normalizeWorkspaceTab('unknown')).toBe('editor');
        expect(normalizeWorkspaceTab(undefined)).toBe('editor');
    });

    it('keeps theme storage key stable', () => {
        expect(THEME_STORAGE_KEY).toBe('backgen-playground-theme');
    });
});

import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';

describe('settings artStyle persistence', () => {
  const origWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (origWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = origWindow;
    }
  });

  function installMockStorage(initial: Record<string, string> = {}): Map<string, string> {
    const store = new Map<string, string>(Object.entries(initial));
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
      },
    };
    return store;
  }

  it('defaults artStyle to VECTOR_NEON', () => {
    expect(DEFAULT_SETTINGS.artStyle).toBe('VECTOR_NEON');
    installMockStorage();
    expect(loadSettings().artStyle).toBe('VECTOR_NEON');
  });

  it('loads and saves WATERCOLOR_INK artStyle cleanly', () => {
    const store = installMockStorage();
    saveSettings({ ...DEFAULT_SETTINGS, artStyle: 'WATERCOLOR_INK' });
    expect(store.size).toBe(1);
    expect(loadSettings().artStyle).toBe('WATERCOLOR_INK');
  });

  it('falls back to VECTOR_NEON for invalid artStyle values', () => {
    installMockStorage({
      'vector-arcana-settings-v1': JSON.stringify({ artStyle: 'INVALID_STYLE' }),
    });
    expect(loadSettings().artStyle).toBe('VECTOR_NEON');
  });
});

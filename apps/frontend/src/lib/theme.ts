import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'crm.theme';

export function getStoredTheme(): Theme {
  try {
    return (localStorage.getItem(KEY) as Theme) || 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme) {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  // keep the browser chrome / status bar colour in sync
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#ffffff' : '#0f1213');
}

/** Hook: returns the current theme + a toggle. Persists to localStorage. */
export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  return {
    theme,
    toggle: () => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')),
    setTheme: setThemeState,
  };
}

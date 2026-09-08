// Decision notes: the theme is a data attribute on <html> so tokens.css can override the
// system preference in either direction; "system" removes the attribute and the media query
// decides. Shared by the dev gallery now and the settings wiring in stage 5.
import { type Theme } from '@domain/types';

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}

/** Theme named by `?theme=` in the search string or after the hash, else system. */
export function readThemeParam(): Theme {
  const fromSearch = new URLSearchParams(location.search).get('theme');
  const hashQuery = location.hash.split('?')[1] ?? '';
  const fromHash = new URLSearchParams(hashQuery).get('theme');
  const value = fromSearch ?? fromHash;
  return value === 'light' || value === 'dark' ? value : 'system';
}

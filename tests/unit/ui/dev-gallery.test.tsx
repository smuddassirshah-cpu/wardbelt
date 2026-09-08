import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { DevGallery } from '../../../src/ui/DevGallery';
import { applyTheme } from '../../../src/ui/theme';

afterEach(() => {
  cleanup();
  applyTheme('system');
  history.replaceState(null, '', '/');
});

describe('DevGallery', () => {
  it('renders every section with a heading and an id', () => {
    const { container } = render(<DevGallery />);
    for (const id of [
      'belt',
      'rows',
      'sheet',
      'admit',
      'summary',
      'settings',
      'banner',
      'toast',
      'chips',
    ]) {
      const section = container.querySelector(`section[id="${id}"]`);
      expect(section, id).not.toBeNull();
      expect(section?.querySelector('h2')?.textContent, id).toBeTruthy();
    }
    expect(container.querySelectorAll('#belt .belt')).toHaveLength(6);
    expect(container.querySelectorAll('#rows .row')).toHaveLength(6);
    expect(container.querySelectorAll('#sheet [role="dialog"]')).toHaveLength(2);
    expect(container.querySelectorAll('#admit [role="dialog"]')).toHaveLength(3);
    expect(container.querySelectorAll('#admit .field__error').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('#summary [role="dialog"]')).toHaveLength(2);
    expect(container.querySelectorAll('#settings [role="dialog"]')).toHaveLength(5);
    expect(container.querySelectorAll('#banner [role="status"]')).toHaveLength(3);
    expect(container.querySelectorAll('#toast [role="status"]')).toHaveLength(2);
    expect(container.querySelectorAll('.belt__square--overdue').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.belt__square--skipped').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Not saving: storage unavailable', { selector: '.summary-line' }),
    ).toBeTruthy();
    expect(screen.getAllByText('n/a')).toHaveLength(2);
  });

  it('switches the theme on the document element', () => {
    render(<DevGallery />);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'System' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('preselects the theme from the query string or the hash query', () => {
    history.replaceState(null, '', '/?theme=dark#/dev');
    render(<DevGallery />);
    expect(document.documentElement.dataset.theme).toBe('dark');
    cleanup();
    history.replaceState(null, '', '/#/dev?theme=light');
    render(<DevGallery />);
    expect(document.documentElement.dataset.theme).toBe('light');
    cleanup();
    history.replaceState(null, '', '/#/dev?theme=purple');
    render(<DevGallery />);
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

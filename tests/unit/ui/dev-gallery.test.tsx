import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
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
    expect(container.querySelectorAll('#sheet [role="dialog"]')).toHaveLength(4);
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

  it('shows the owner phone, task note and discharged states of the patient sheet', () => {
    const { container } = render(<DevGallery />);
    const tel = container.querySelector<HTMLAnchorElement>('#sheet a[href^="tel:"]');
    expect(tel?.getAttribute('href')).toBe('tel:+440000000000');
    expect(container.querySelector('#sheet .task__note')?.textContent).toBe(
      'Left fore, check for slippage',
    );
    const dischargeButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('#sheet button'),
    ).filter((b) => /^Discharged \d\d:\d\d$/.test(b.textContent));
    expect(dischargeButtons).toHaveLength(1);
    expect(dischargeButtons[0]?.disabled).toBe(true);
    expect(
      Array.from(container.querySelectorAll('#sheet button')).filter(
        (b) => b.textContent === 'Discharge',
      ),
    ).toHaveLength(3);
  });

  it('switches the theme on the document element', () => {
    const { container } = render(<DevGallery />);
    const header = container.querySelector<HTMLElement>('.gallery__header');
    expect(header).not.toBeNull();
    const themeButton = (name: string) =>
      within(header ?? document.body).getByRole('button', { name });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    fireEvent.click(themeButton('Dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(themeButton('Dark').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(themeButton('Light'));
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(themeButton('System'));
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

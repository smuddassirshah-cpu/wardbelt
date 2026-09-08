import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NOTIFICATION_HINT,
  STORAGE_LINE,
  Settings,
  type SettingsProps,
} from '../../../src/ui/Settings';
import { FIXTURE_SETTINGS } from '../../fixtures/synthetic';

afterEach(cleanup);

function mount(extra: Partial<SettingsProps> = {}) {
  const h = {
    onChange: vi.fn(),
    onRequestNotifications: vi.fn(),
    onExport: vi.fn(),
    onImportText: vi.fn(),
    onPurge: vi.fn(),
    onDeleteAll: vi.fn(),
    onClose: vi.fn(),
  };
  const utils = render(
    <Settings
      settings={FIXTURE_SETTINGS}
      notificationState="granted"
      storageMode="idb"
      version="abc1234"
      {...h}
      {...extra}
    />,
  );
  return { ...utils, ...h };
}

describe('Settings', () => {
  it('renders toggles, theme, purge, storage and version lines', () => {
    mount();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Notifications/ }).checked).toBe(
      true,
    );
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: /Click on completion/ }).checked,
    ).toBe(false);
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: /Show owner phone field/ }).checked,
    ).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Light' }).checked).toBe(true);
    expect(screen.getByText(STORAGE_LINE.idb)).toBeTruthy();
    expect(screen.getByText('Version abc1234')).toBeTruthy();
    expect(screen.getByText('Never exported.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Purge discharged older than 30 days' }),
    ).toBeTruthy();
  });

  it('fires onChange partials for each toggle and the theme', () => {
    const { onChange, onRequestNotifications } = mount();
    fireEvent.click(screen.getByRole('checkbox', { name: /Click on completion/ }));
    expect(onChange).toHaveBeenLastCalledWith({ sound: true });
    fireEvent.click(screen.getByRole('checkbox', { name: /Show owner phone field/ }));
    expect(onChange).toHaveBeenLastCalledWith({ showOwnerPhone: false });
    fireEvent.click(screen.getByRole('checkbox', { name: /Notifications/ }));
    expect(onChange).toHaveBeenLastCalledWith({ notifications: false });
    expect(onRequestNotifications).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(onChange).toHaveBeenLastCalledWith({ theme: 'dark' });
  });

  it('asks for permission when switching notifications on in the default state', () => {
    const { onChange, onRequestNotifications } = mount({
      notificationState: 'default',
      settings: { ...FIXTURE_SETTINGS, notifications: false },
    });
    expect(screen.getByText(NOTIFICATION_HINT.default)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Notifications/ }));
    expect(onChange).toHaveBeenCalledWith({ notifications: true });
    expect(onRequestNotifications).toHaveBeenCalledTimes(1);
  });

  it.each(['denied', 'unsupported'] as const)(
    'disables the toggle and explains when %s',
    (state) => {
      mount({ notificationState: state });
      const box = screen.getByRole<HTMLInputElement>('checkbox', { name: /Notifications/ });
      expect(box.disabled).toBe(true);
      expect(box.checked).toBe(false);
      expect(screen.getByText(NOTIFICATION_HINT[state])).toBeTruthy();
    },
  );

  it('shows the memory-mode line', () => {
    mount({ storageMode: 'memory' });
    expect(screen.getByText(STORAGE_LINE.memory)).toBeTruthy();
  });

  it('validates purge days and fires purge', () => {
    const { onChange, onPurge } = mount();
    const days = screen.getByLabelText<HTMLInputElement>('Keep discharged patients for (days)');
    expect(days.value).toBe('30');
    fireEvent.change(days, { target: { value: '400' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(days.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Between 1 and 365 days')).toBeTruthy();
    fireEvent.change(days, { target: { value: '14' } });
    expect(onChange).toHaveBeenLastCalledWith({ purgeDays: 14 });
    expect(days.getAttribute('aria-invalid')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Purge discharged/ }));
    expect(onPurge).toHaveBeenCalledTimes(1);
  });

  it('exports, and imports the text of a chosen file', async () => {
    const { onExport, onImportText, container } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(onExport).toHaveBeenCalledTimes(1);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input?.getAttribute('accept')).toBe('application/json,.json');
    expect(input?.hidden).toBe(true);
    if (input === null) {
      return;
    }
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(click).toHaveBeenCalledTimes(1);
    const file = new File(['{"schemaVersion":1}'], 'wardbelt.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      fireEvent.change(input);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(onImportText).toHaveBeenCalledWith('{"schemaVersion":1}');
    });
  });

  it('reports an unreadable file without throwing', async () => {
    const { onImportText, container } = mount();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) {
      throw new Error('no file input');
    }
    const bad = new File(['x'], 'bad.json');
    Object.defineProperty(bad, 'text', { value: () => Promise.reject(new Error('boom')) });
    Object.defineProperty(input, 'files', { value: [bad], configurable: true });
    await act(async () => {
      fireEvent.change(input);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Could not read that file');
    });
    expect(onImportText).not.toHaveBeenCalled();
  });

  it('ignores a change with no file selected', () => {
    const { onImportText, container } = mount();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) {
      throw new Error('no file input');
    }
    fireEvent.change(input);
    expect(onImportText).not.toHaveBeenCalled();
  });

  it('falls back to FileReader when file.text is missing', async () => {
    const { onImportText, container } = mount();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) {
      throw new Error('no file input');
    }
    const legacy = new File(['legacy'], 'old.json');
    Object.defineProperty(legacy, 'text', { value: undefined });
    Object.defineProperty(input, 'files', { value: [legacy], configurable: true });
    await act(() => {
      fireEvent.change(input);
    });
    await waitFor(() => {
      expect(onImportText).toHaveBeenCalledWith('legacy');
    });
  });

  it('shows the last export time when known', () => {
    mount({ settings: { ...FIXTURE_SETTINGS, lastExportAt: '2026-03-10T10:30:00.000Z' } });
    expect(screen.getByText(/^Last export /)).toBeTruthy();
  });

  it('deletes everything only after the two-step confirm', () => {
    const { onDeleteAll } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));
    expect(onDeleteAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete everything' }));
    expect(onDeleteAll).toHaveBeenCalledTimes(1);
  });

  it('closes', () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

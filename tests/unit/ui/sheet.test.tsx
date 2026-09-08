import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from '../../../src/ui/Sheet';

afterEach(cleanup);

describe('Sheet', () => {
  it('is a labelled modal dialog with a Close button', () => {
    const onClose = vi.fn();
    render(
      <Sheet title="Example" onClose={onClose}>
        <p>Body</p>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Example' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape from inside and on the scrim', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sheet title="Example" onClose={onClose}>
        <button type="button">Inner</button>
      </Sheet>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Inner' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Inner' }), { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(1);
    const scrim = container.querySelector('.sheet-scrim');
    expect(scrim).not.toBeNull();
    if (scrim !== null) {
      fireEvent.click(scrim);
    }
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('moves focus into the sheet on open and back on close', () => {
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);
    const { unmount } = render(
      <Sheet title="Focus" onClose={vi.fn()}>
        <p>Body</p>
      </Sheet>,
    );
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    unmount();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('honours initialFocus', () => {
    const ref = { current: null as HTMLInputElement | null };
    render(
      <Sheet title="Focus" onClose={vi.fn()} initialFocus={ref}>
        <input ref={ref} aria-label="Name" />
      </Sheet>,
    );
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }));
  });

  it('renders inline without a scrim, aria-modal or focus capture', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const { container } = render(
      <Sheet title="Inline" onClose={vi.fn()} inline>
        <p>Body</p>
      </Sheet>,
    );
    expect(container.querySelector('.sheet-scrim')).toBeNull();
    expect(container.querySelector('.sheet--inline')).not.toBeNull();
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

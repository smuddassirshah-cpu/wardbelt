import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Banner } from '../../../src/ui/Banner';
import { Chip } from '../../../src/ui/Chip';
import { ConfirmButton } from '../../../src/ui/ConfirmButton';
import { TOAST_MAX_MS, Toast } from '../../../src/ui/Toast';

afterEach(cleanup);

describe('Banner', () => {
  it('is a status region with optional action and dismiss', () => {
    const onDismiss = vi.fn();
    const onClick = vi.fn();
    const { container } = render(
      <Banner
        message="Update ready"
        tone="warning"
        action={{ label: 'Reload', onClick }}
        onDismiss={onDismiss}
      />,
    );
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Update ready');
    expect(container.querySelector('.banner--warning')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders a persistent banner with no buttons', () => {
    const { container } = render(
      <Banner message="Not saving: storage unavailable" tone="danger" />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('.banner--danger')).not.toBeNull();
    cleanup();
    render(<Banner message="Plain" />);
    expect(screen.getByRole('status').className).toBe('banner');
  });
});

describe('Chip', () => {
  it('applies tone and mono classes', () => {
    const { container } = render(
      <>
        <Chip>Plain</Chip>
        <Chip tone="danger" mono>
          C1
        </Chip>
      </>,
    );
    const chips = container.querySelectorAll('.chip');
    expect(chips[0]?.className).toBe('chip');
    expect(chips[1]?.className).toBe('chip chip--danger mono');
  });
});

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires after durationMs and offers Undo', () => {
    const onExpire = vi.fn();
    const onUndo = vi.fn();
    render(
      <Toast message="Premed completed" durationMs={1500} onExpire={onExpire} onUndo={onUndo} />,
    );
    expect(screen.getByRole('status').textContent).toContain('Premed completed');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1499);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('holds its deadline when a ticking parent re-renders with a new onExpire', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(
      <Toast
        message="Tick"
        durationMs={4000}
        onExpire={() => {
          first();
        }}
        inline
      />,
    );
    for (let i = 0; i < 3; i += 1) {
      vi.advanceTimersByTime(1000);
      rerender(
        <Toast
          message="Tick"
          durationMs={4000}
          onExpire={() => {
            latest();
          }}
          inline
        />,
      );
    }
    expect(latest).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('never lives longer than 4 s and clears its timer on unmount', () => {
    const onExpire = vi.fn();
    const { unmount } = render(<Toast message="Long" durationMs={60_000} onExpire={onExpire} />);
    expect(screen.queryByRole('button')).toBeNull();
    vi.advanceTimersByTime(TOAST_MAX_MS);
    expect(onExpire).toHaveBeenCalledTimes(1);
    const second = vi.fn();
    const { unmount: unmount2 } = render(
      <Toast message="Gone" durationMs={1000} onExpire={second} inline />,
    );
    unmount2();
    vi.advanceTimersByTime(5000);
    expect(second).not.toHaveBeenCalled();
    unmount();
  });
});

describe('ConfirmButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms, confirms, and honours a custom window and disabled state', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmButton
        label="Delete"
        confirmLabel="Really delete"
        onConfirm={onConfirm}
        windowMs={500}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await act(() => {
      vi.advanceTimersByTime(499);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Really delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole('button', { name: 'Really delete' })).toBeNull();
    cleanup();
    render(
      <ConfirmButton label="Delete" confirmLabel="Really delete" onConfirm={onConfirm} disabled />,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Delete' }).disabled).toBe(true);
  });
});

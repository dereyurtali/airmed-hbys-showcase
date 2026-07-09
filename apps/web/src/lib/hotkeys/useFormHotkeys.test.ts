import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFormHotkeys } from './useFormHotkeys';

function press(key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  );
}

describe('useFormHotkeys', () => {
  it('Cmd+Enter onSubmit çağırır', () => {
    const onSubmit = vi.fn();
    renderHook(() => useFormHotkeys({ onSubmit }));
    press('Enter', { metaKey: true });
    expect(onSubmit).toHaveBeenCalled();
  });

  it('Ctrl+Enter onSubmit çağırır', () => {
    const onSubmit = vi.fn();
    renderHook(() => useFormHotkeys({ onSubmit }));
    press('Enter', { ctrlKey: true });
    expect(onSubmit).toHaveBeenCalled();
  });

  it('düz Enter submit etmez (modifier yok)', () => {
    const onSubmit = vi.fn();
    renderHook(() => useFormHotkeys({ onSubmit }));
    press('Enter');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Escape onCancel çağırır', () => {
    const onCancel = vi.fn();
    renderHook(() => useFormHotkeys({ onCancel }));
    press('Escape');
    expect(onCancel).toHaveBeenCalled();
  });

  it('enabled=false iken tetiklenmez', () => {
    const onSubmit = vi.fn();
    renderHook(() => useFormHotkeys({ onSubmit, enabled: false }));
    press('Enter', { metaKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

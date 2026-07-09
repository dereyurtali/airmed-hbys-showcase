import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useListHotkeys } from './useListHotkeys';

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  );
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useListHotkeys', () => {
  it('j / ↓ sonraki kayda iner', () => {
    const setActiveIndex = vi.fn();
    renderHook(() => useListHotkeys({ count: 3, activeIndex: 0, setActiveIndex }));
    press('j');
    expect(setActiveIndex).toHaveBeenCalledWith(1);
    press('ArrowDown');
    expect(setActiveIndex).toHaveBeenLastCalledWith(1);
  });

  it('k / ↑ önceki kayda çıkar, 0 altına inmez', () => {
    const setActiveIndex = vi.fn();
    renderHook(() => useListHotkeys({ count: 3, activeIndex: 0, setActiveIndex }));
    press('k');
    expect(setActiveIndex).toHaveBeenCalledWith(0);
  });

  it('Enter seçili kaydı açar', () => {
    const onSelect = vi.fn();
    renderHook(() =>
      useListHotkeys({ count: 3, activeIndex: 2, setActiveIndex: vi.fn(), onSelect }),
    );
    press('Enter');
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('Escape onEscape çağırır', () => {
    const onEscape = vi.fn();
    renderHook(() =>
      useListHotkeys({ count: 3, activeIndex: 0, setActiveIndex: vi.fn(), onEscape }),
    );
    press('Escape');
    expect(onEscape).toHaveBeenCalled();
  });

  it('arama input içinde yazarken j tetiklenmez', () => {
    const setActiveIndex = vi.fn();
    renderHook(() => useListHotkeys({ count: 3, activeIndex: 0, setActiveIndex }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('j', {}, input);
    expect(setActiveIndex).not.toHaveBeenCalled();
  });

  it("/ arama input'una odaklar", () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const searchRef = { current: input };
    renderHook(() =>
      useListHotkeys({ count: 0, activeIndex: -1, setActiveIndex: vi.fn(), searchRef }),
    );
    press('/');
    expect(document.activeElement).toBe(input);
  });
});

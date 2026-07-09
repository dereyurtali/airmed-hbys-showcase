import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ErrorBoundary } from './ErrorBoundary';

// S14 — ErrorBoundary unit test (DB yok). React subtree throw eder, fallback
// UI render eder, "Tekrar Dene" state reset eder.

function Boom({ shouldThrow }: { shouldThrow: boolean }): JSX.Element {
  if (shouldThrow) throw new Error('boom from child');
  return <div data-testid="ok-child">child OK</div>;
}

describe('ErrorBoundary', () => {
  // React'in test ortamında error log spamı yapmaması için
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("child throw etmezse children'ı render eder", () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('ok-child')).toBeInTheDocument();
  });

  it('child throw ederse fallback UI gösterir', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Bir şeyler ters gitti/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tekrar Dene/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ana Sayfa/i })).toBeInTheDocument();
  });

  it('"Tekrar Dene" tıklanınca error state sıfırlanır', () => {
    let shouldThrow = true;
    function Toggler(): JSX.Element {
      return <Boom shouldThrow={shouldThrow} />;
    }
    const { rerender } = render(
      <ErrorBoundary>
        <Toggler />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Bir şeyler ters gitti/i)).toBeInTheDocument();

    // Çocuk artık throw etmeyecek
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /Tekrar Dene/i }));
    rerender(
      <ErrorBoundary>
        <Toggler />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('ok-child')).toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { EyeSideField } from './EyeSideField';
import { EyeSideColumns } from './EyeSideColumns';

describe('EyeSideField', () => {
  it('value=null iken hiçbir seçenek seçili değildir (Ray 4 — default boş)', () => {
    render(<EyeSideField value={null} onChange={vi.fn()} />);
    expect((screen.getByTestId('eye-od') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('eye-os') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('eye-ou') as HTMLInputElement).checked).toBe(false);
  });

  it('seçili değeri checked gösterir', () => {
    render(<EyeSideField value="os" onChange={vi.fn()} />);
    expect((screen.getByTestId('eye-os') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('eye-od') as HTMLInputElement).checked).toBe(false);
  });

  it('tıklamada onChange doğru tarafı çağırır', () => {
    const onChange = vi.fn();
    render(<EyeSideField value={null} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('eye-od'));
    expect(onChange).toHaveBeenCalledWith('od');
  });

  it('testIdPrefix ile testid önekini değiştirir', () => {
    render(<EyeSideField value={null} onChange={vi.fn()} testIdPrefix="measurement-eye" />);
    expect(screen.getByTestId('measurement-eye-od')).toBeInTheDocument();
  });

  it('options ile yalnız OD/OS sunar (cerrahi tek-göz)', () => {
    render(<EyeSideField value={null} onChange={vi.fn()} options={['od', 'os']} />);
    expect(screen.getByTestId('eye-od')).toBeInTheDocument();
    expect(screen.getByTestId('eye-os')).toBeInTheDocument();
    expect(screen.queryByTestId('eye-ou')).not.toBeInTheDocument();
  });
});

describe('EyeSideColumns', () => {
  it('iki kolon (OD|OS) çizer ve her birine renderEye uygular', () => {
    render(<EyeSideColumns renderEye={(eye) => <span data-testid={`val-${eye}`}>{eye}</span>} />);
    expect(screen.getByTestId('eye-columns-od')).toBeInTheDocument();
    expect(screen.getByTestId('eye-columns-os')).toBeInTheDocument();
    expect(screen.getByTestId('val-od')).toBeInTheDocument();
    expect(screen.getByTestId('val-os')).toBeInTheDocument();
  });

  it('linked=true iken tek OU kolonu gösterir', () => {
    render(
      <EyeSideColumns linked renderEye={(eye) => <span data-testid={`val-${eye}`}>{eye}</span>} />,
    );
    expect(screen.getByTestId('eye-columns-ou')).toBeInTheDocument();
    expect(screen.queryByTestId('eye-columns-os')).not.toBeInTheDocument();
  });

  it('link checkbox onLinkedChange çağırır', () => {
    const onLinkedChange = vi.fn();
    render(
      <EyeSideColumns onLinkedChange={onLinkedChange} renderEye={(eye) => <span>{eye}</span>} />,
    );
    fireEvent.click(screen.getByTestId('eye-columns-link'));
    expect(onLinkedChange).toHaveBeenCalledWith(true);
  });
});

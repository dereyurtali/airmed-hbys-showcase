import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import { Stethoscope } from 'lucide-react';
import { OverviewStatCard } from './OverviewStatCard';

function renderCard(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('OverviewStatCard', () => {
  it('değer ve etiketi gösterir', () => {
    renderCard(<OverviewStatCard icon={Stethoscope} tint="sky" value={24} label="Bugün Muayene" />);
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('Bugün Muayene')).toBeInTheDocument();
  });

  it('to verilince tıklanabilir link (ön-filtreli route) olur', () => {
    renderCard(
      <OverviewStatCard icon={Stethoscope} tint="amber" value={3} label="Bekleyen" to="/billing" />,
    );
    const el = screen.getByTestId('overview-statcard');
    expect(el.tagName).toBe('A');
    expect(el).toHaveAttribute('href', '/billing');
  });

  it('to verilmezse düz kutu (link değil)', () => {
    renderCard(<OverviewStatCard icon={Stethoscope} tint="emerald" value="—" label="X" />);
    expect(screen.getByTestId('overview-statcard').tagName).toBe('DIV');
  });
});

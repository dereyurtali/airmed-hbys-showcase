import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { StickyClinicalAlertBanner } from './StickyClinicalAlertBanner';

const base = { firstName: 'Ayşe', lastName: 'Yılmaz', mrn: 'TD26700042' };

describe('StickyClinicalAlertBanner', () => {
  it('hasta kimliğini daima gösterir (Ray 1)', () => {
    render(<StickyClinicalAlertBanner patient={base} />);
    expect(screen.getByTestId('clinical-banner-name')).toHaveTextContent('Ayşe Yılmaz');
    expect(screen.getByTestId('clinical-banner-mrn')).toHaveTextContent('TD26700042');
  });

  it('alerji yokken kırmızı banner gösterilmez', () => {
    render(<StickyClinicalAlertBanner patient={base} />);
    expect(screen.queryByTestId('clinical-banner-allergy')).not.toBeInTheDocument();
  });

  it('alerji varsa sticky kırmızı banner gösterir (Ray 2)', () => {
    render(<StickyClinicalAlertBanner patient={{ ...base, allergies: ['Penisilin', 'Lateks'] }} />);
    const banner = screen.getByTestId('clinical-banner-allergy');
    expect(banner).toHaveTextContent('Penisilin');
    expect(banner).toHaveTextContent('Lateks');
  });

  it('antikoagülan varsa amber uyarı gösterir', () => {
    render(
      <StickyClinicalAlertBanner patient={{ ...base, anticoagulantMedications: ['Varfarin'] }} />,
    );
    expect(screen.getByTestId('clinical-banner-anticoagulant')).toHaveTextContent('Varfarin');
  });

  it('ek alert + CTA render eder ve tıklamada onClick çağırır', () => {
    const onClick = vi.fn();
    render(
      <StickyClinicalAlertBanner
        patient={base}
        alerts={[{ id: 'consent', text: 'Onam eksik', cta: { label: 'Onam Ekle', onClick } }]}
      />,
    );
    expect(screen.getByTestId('clinical-banner-alert-consent')).toHaveTextContent('Onam eksik');
    fireEvent.click(screen.getByText('Onam Ekle'));
    expect(onClick).toHaveBeenCalled();
  });
});

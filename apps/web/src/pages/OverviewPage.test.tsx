import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));

vi.mock('../providers/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('../providers/AuthProvider')>(
    '../providers/AuthProvider',
  );
  return { ...actual, useAuth: () => mockUseAuth() };
});

vi.mock('./AdminOverviewPage', () => ({
  AdminOverviewPage: () => <div data-testid="admin-overview-mock" />,
}));

vi.mock('./overview/DoctorOverview', () => ({
  DoctorOverview: () => <div data-testid="doctor-overview-mock" />,
}));

vi.mock('./overview/NurseOverview', () => ({
  NurseOverview: () => <div data-testid="nurse-overview-mock" />,
}));

vi.mock('./overview/MeasurementKioskOverview', () => ({
  MeasurementKioskOverview: () => <div data-testid="kiosk-overview-mock" />,
}));

vi.mock('./overview/ReceptionOverview', () => ({
  ReceptionOverview: () => <div data-testid="reception-overview-mock" />,
}));

vi.mock('./overview/SalesOverview', () => ({
  SalesOverview: () => <div data-testid="sales-overview-mock" />,
}));

vi.mock('./overview/FinansOverview', () => ({
  FinansOverview: () => <div data-testid="finans-overview-mock" />,
}));

vi.mock('./overview/StokOverview', () => ({
  StokOverview: () => <div data-testid="stok-overview-mock" />,
}));

vi.mock('./overview/EczaneOverview', () => ({
  EczaneOverview: () => <div data-testid="eczane-overview-mock" />,
}));

vi.mock('./overview/AssistantOverview', () => ({
  AssistantOverview: () => <div data-testid="assistant-overview-mock" />,
}));

import { OverviewPage } from './OverviewPage';

describe('OverviewPage dispatch', () => {
  beforeEach(() => mockUseAuth.mockReset());

  it('yönetici (solo) → AdminOverviewPage', () => {
    mockUseAuth.mockReturnValue({ user: { roles: ['yonetici'] } });
    render(<OverviewPage />);
    expect(screen.getByTestId('admin-overview-mock')).toBeInTheDocument();
  });

  it('doktor (solo) → DoctorOverview', () => {
    mockUseAuth.mockReturnValue({ user: { roles: ['doktor'] } });
    render(<OverviewPage />);
    expect(screen.getByTestId('doctor-overview-mock')).toBeInTheDocument();
  });

  it('resepsiyon → ReceptionOverview', () => {
    mockUseAuth.mockReturnValue({ user: { roles: ['resepsiyon'] } });
    render(<OverviewPage />);
    expect(screen.getByTestId('reception-overview-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-overview-mock')).not.toBeInTheDocument();
  });

  it('ameliyat satış → SalesOverview', () => {
    mockUseAuth.mockReturnValue({ user: { roles: ['ameliyat_satis'] } });
    render(<OverviewPage />);
    expect(screen.getByTestId('sales-overview-mock')).toBeInTheDocument();
  });

  it('finans → FinansOverview', () => {
    mockUseAuth.mockReturnValue({ user: { roles: ['finans'] } });
    render(<OverviewPage />);
    expect(screen.getByTestId('finans-overview-mock')).toBeInTheDocument();
  });

  it('stok & satınalma → StokOverview', () => {
    mockUseAuth.mockReturnValue({ user: { roles: ['stok_satinalma'] } });
    render(<OverviewPage />);
    expect(screen.getByTestId('stok-overview-mock')).toBeInTheDocument();
  });

  it('eczane → EczaneOverview', () => {
    mockUseAuth.mockReturnValue({ user: { roles: ['eczane'] } });
    render(<OverviewPage />);
    expect(screen.getByTestId('eczane-overview-mock')).toBeInTheDocument();
  });

  it('yönetici asistanı → AssistantOverview', () => {
    mockUseAuth.mockReturnValue({ user: { roles: ['yonetici_asistani'] } });
    render(<OverviewPage />);
    expect(screen.getByTestId('assistant-overview-mock')).toBeInTheDocument();
  });

  // #908 — çoklu-rol (mixed) artık placeholder değil; en öncelikli rolün hazır
  // Genel Bakış'ına çözülür (öncelik: yönetici → ... → eczane).
  it('çoklu rol (yönetici+doktor) → en öncelikli: AdminOverviewPage', () => {
    mockUseAuth.mockReturnValue({ user: { roles: ['yonetici', 'doktor'] } });
    render(<OverviewPage />);
    expect(screen.getByTestId('admin-overview-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('overview-placeholder')).not.toBeInTheDocument();
  });

  it('çoklu rol yöneticisiz (doktor+resepsiyon) → öncelik doktor → DoctorOverview', () => {
    mockUseAuth.mockReturnValue({ user: { roles: ['doktor', 'resepsiyon'] } });
    render(<OverviewPage />);
    expect(screen.getByTestId('doctor-overview-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('overview-placeholder')).not.toBeInTheDocument();
  });

  it('çoklu rol (finans+stok) → öncelik finans → FinansOverview', () => {
    mockUseAuth.mockReturnValue({ user: { roles: ['finans', 'stok_satinalma'] } });
    render(<OverviewPage />);
    expect(screen.getByTestId('finans-overview-mock')).toBeInTheDocument();
  });

  it('hemşire genel → NurseOverview', () => {
    mockUseAuth.mockReturnValue({ user: { roles: ['hemsire'], mode: 'genel' } });
    render(<OverviewPage />);
    expect(screen.getByTestId('nurse-overview-mock')).toBeInTheDocument();
  });

  it('hemşire asistan → NurseOverview', () => {
    mockUseAuth.mockReturnValue({ user: { roles: ['hemsire'], mode: 'asistan' } });
    render(<OverviewPage />);
    expect(screen.getByTestId('nurse-overview-mock')).toBeInTheDocument();
  });

  it('ölçüm modu → MeasurementKioskOverview', () => {
    mockUseAuth.mockReturnValue({ user: { roles: ['hemsire'], mode: 'olcum' } });
    render(<OverviewPage />);
    expect(screen.getByTestId('kiosk-overview-mock')).toBeInTheDocument();
  });
});

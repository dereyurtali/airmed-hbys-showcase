import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorklistPage } from './WorklistPage';

const myWorklistQuery = vi.fn();
const doctorListQuery = vi.fn();

vi.mock('../lib/trpc', () => ({
  trpc: {
    encounter: {
      myWorklist: { useQuery: () => myWorklistQuery() },
      myActiveExamCount: { useQuery: () => ({ data: { count: 0, cap: 3, isAtCap: false } }) },
      close: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      advance: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    doctor: {
      list: { useQuery: () => doctorListQuery() },
      myProfile: { useQuery: () => ({ data: { id: 'd1', name: 'Dr. Test', specialty: 'Göz' } }) },
    },
    patient: { findById: { useQuery: () => ({ data: undefined, isLoading: false }) } },
    examination: { listByPatient: { useQuery: () => ({ data: [] }) } },
    measurement: { listByPatient: { useQuery: () => ({ data: [] }) } },
    surgery: { listByPatient: { useQuery: () => ({ data: [] }) } },
    billing: { listServiceItems: { useQuery: () => ({ data: [] }) } },
    measurementOrder: { create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
    useUtils: () => ({
      encounter: { myWorklist: { invalidate: vi.fn() } },
    }),
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', roles: ['doktor'] } }),
}));
vi.mock('../providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'tr' }) }));

describe('WorklistPage', () => {
  beforeEach(() => {
    doctorListQuery.mockReturnValue({ data: { items: [] } });
  });

  it('Sırada sekmesinde bekleyen hastayı kart olarak gösterir', () => {
    myWorklistQuery.mockReturnValue({
      data: [
        {
          id: 'e1',
          stage: 'waiting_doctor',
          stageUpdatedAt: new Date().toISOString(),
          openedAt: new Date().toISOString(),
          patient: { id: 'p1', mrn: 'TD26700001', firstName: 'Ali', lastName: 'Veli' },
          appointment: {
            id: 'a1',
            startsAt: new Date().toISOString(),
            type: 'consultation',
            notes: 'Görme bulanıklığı',
          },
        },
      ],
      isLoading: false,
      isFetching: false,
      error: null,
    });
    render(<WorklistPage />);
    // Kart kuyrukta + otomatik seçili olduğu için detayda da görünür → en az 1.
    expect(screen.getAllByText('Ali Veli').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('queue-card')).toBeInTheDocument();
    // Randevu notu = sebep (kart alt satırı + detay rozeti)
    expect(screen.getAllByText('Görme bulanıklığı').length).toBeGreaterThanOrEqual(1);
  });

  it('R1 — "sadece aksiyon" default: hemşirede/satışta bekleyenleri gizler, aksiyonluları sıralar', () => {
    const iso = (min: number) => new Date(Date.now() - min * 60000).toISOString();
    const row = (id: string, stage: string, first: string, openedMinAgo: number) => ({
      id,
      stage,
      stageUpdatedAt: iso(openedMinAgo),
      openedAt: iso(openedMinAgo),
      patient: { id: id, mrn: `M${id}`, firstName: first, lastName: 'Test' },
      appointment: { id: `a${id}`, startsAt: iso(openedMinAgo), type: 'consultation', notes: null },
    });
    myWorklistQuery.mockReturnValue({
      // in_exam daha eski, waiting_doctor daha yeni → sıralama stage-önceliğine göre
      // (waiting_doctor < in_exam) olmalı, gelişe göre değil.
      data: [
        row('1', 'in_exam', 'Exam', 50),
        row('2', 'in_measurement', 'Olcum', 40),
        row('3', 'waiting_doctor', 'Bekleyen', 10),
        row('4', 'awaiting_surgery_sales', 'Satis', 30),
      ],
      isLoading: false,
      isFetching: false,
      error: null,
    });
    render(<WorklistPage />);
    // Default onlyActionable=true → yalnız waiting_doctor + in_exam görünür (2 kart).
    let cards = screen.getAllByTestId('queue-card');
    expect(cards).toHaveLength(2);
    // Sıralama: waiting_doctor (Bekleyen) ilk, in_exam (Exam) ikinci.
    expect(within(cards[0]).getByText('Bekleyen Test')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Exam Test')).toBeInTheDocument();
    // Gizlenenler kuyrukta yok.
    expect(screen.queryByText('Olcum Test')).not.toBeInTheDocument();
    expect(screen.queryByText('Satis Test')).not.toBeInTheDocument();

    // Toggle kapat → 4 kart (hepsi), sıralama yine stage-önceliğine göre.
    fireEvent.click(screen.getByRole('checkbox'));
    cards = screen.getAllByTestId('queue-card');
    expect(cards).toHaveLength(4);
    expect(within(cards[0]).getByText('Bekleyen Test')).toBeInTheDocument();
    expect(within(cards[3]).getByText('Satis Test')).toBeInTheDocument();
  });

  it('#1152 — acil en üstte (stage gruplamasını ezer) → VIP → randevu saatine göre', () => {
    const at = (h: number, m: number) =>
      `2026-07-06T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
    myWorklistQuery.mockReturnValue({
      data: [
        // in_measurement onlyActionable=true'da normalde gizli; acil olduğu için
        // hem görünür hem en üstte (Karar A: acil stage gruplamasını ezer).
        {
          id: 'u',
          stage: 'in_measurement',
          isUrgent: true,
          stageUpdatedAt: at(9, 0),
          openedAt: at(9, 0),
          patient: { id: 'u', mrn: 'Mu', firstName: 'Acil', lastName: 'T' },
          appointment: { id: 'au', startsAt: at(9, 0), type: 'consultation', notes: null },
        },
        {
          id: 'v',
          stage: 'waiting_doctor',
          stageUpdatedAt: at(11, 0),
          openedAt: at(11, 0),
          patient: { id: 'v', mrn: 'Mv', firstName: 'Vip', lastName: 'T', tags: ['vip'] },
          appointment: { id: 'av', startsAt: at(11, 0), type: 'consultation', notes: null },
        },
        // randevu 10:00 ama openedAt erken (08:00) — startsAt birincil olmalı (Karar B).
        {
          id: 'n2',
          stage: 'waiting_doctor',
          stageUpdatedAt: at(8, 0),
          openedAt: at(8, 0),
          patient: { id: 'n2', mrn: 'Mn2', firstName: 'Gec', lastName: 'T' },
          appointment: { id: 'an2', startsAt: at(10, 0), type: 'consultation', notes: null },
        },
        // randevu 09:00 (daha erken) → Gec'ten önce, openedAt daha geç olsa da.
        {
          id: 'n1',
          stage: 'waiting_doctor',
          stageUpdatedAt: at(8, 50),
          openedAt: at(8, 50),
          patient: { id: 'n1', mrn: 'Mn1', firstName: 'Erken', lastName: 'T' },
          appointment: { id: 'an1', startsAt: at(9, 0), type: 'consultation', notes: null },
        },
      ],
      isLoading: false,
      isFetching: false,
      error: null,
    });
    render(<WorklistPage />);
    const cards = screen.getAllByTestId('queue-card');
    expect(cards).toHaveLength(4);
    expect(within(cards[0]).getByText('Acil T')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Vip T')).toBeInTheDocument();
    expect(within(cards[2]).getByText('Erken T')).toBeInTheDocument();
    expect(within(cards[3]).getByText('Gec T')).toBeInTheDocument();
    // ACİL + VIP rozetleri kartta görünür (renk tek başına değil, metin de).
    expect(within(cards[0]).getByText('priority.urgent')).toBeInTheDocument();
    expect(within(cards[1]).getByText('priority.vip')).toBeInTheDocument();
  });

  it('boş kuyrukta empty + seçim ipucu gösterir', () => {
    myWorklistQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      error: null,
    });
    render(<WorklistPage />);
    expect(screen.getByText('queue.empty')).toBeInTheDocument();
    expect(screen.getByText('detail.selectPrompt')).toBeInTheDocument();
    expect(screen.queryByTestId('queue-card')).not.toBeInTheDocument();
  });
});

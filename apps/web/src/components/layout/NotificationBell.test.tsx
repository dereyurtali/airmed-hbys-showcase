import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NotificationBell } from './NotificationBell';

const mockUseNotifications = vi.fn();
vi.mock('../../hooks/useNotifications', () => ({
  useNotifications: () => mockUseNotifications(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

describe('NotificationBell', () => {
  afterEach(() => mockUseNotifications.mockReset());

  it('okunmamış varsa rozet sayıyı gösterir', () => {
    mockUseNotifications.mockReturnValue({
      notifications: [],
      unreadCount: 3,
      markRead: vi.fn(),
      markAllRead: vi.fn(),
    });
    render(<NotificationBell />);
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('3');
  });

  it('9+ sınırını uygular', () => {
    mockUseNotifications.mockReturnValue({
      notifications: [],
      unreadCount: 42,
      markRead: vi.fn(),
      markAllRead: vi.fn(),
    });
    render(<NotificationBell />);
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('9+');
  });

  it('okunmamış yoksa rozet render etmez', () => {
    mockUseNotifications.mockReturnValue({
      notifications: [],
      unreadCount: 0,
      markRead: vi.fn(),
      markAllRead: vi.fn(),
    });
    render(<NotificationBell />);
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
    expect(screen.getByTestId('notification-bell')).toBeInTheDocument();
  });
});

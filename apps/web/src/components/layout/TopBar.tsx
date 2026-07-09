import { lazy, Suspense, useState } from 'react';
import { Menu, ChevronDown, Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { useAuth } from '../../providers/AuthProvider';
import { NurseSessionWidget } from '../nurse/NurseSessionWidget';
import { OnboardingGuide } from '../onboarding/OnboardingGuide';
import { CommandPalette } from './CommandPalette';
import { LocaleSwitcher } from './LocaleSwitcher';
import { NotificationBell } from './NotificationBell';
import { usePermission } from '../../hooks/usePermission';

// #1056 — FeedbackCenter zinciri (AnnotationStudio → html2canvas ~200KB) her
// kullanıcının entry'sine giriyordu; drawer ilk açıldığında yüklenir.
const FeedbackCenter = lazy(() =>
  import('../feedback/FeedbackCenter').then((m) => ({ default: m.FeedbackCenter })),
);

interface TopBarProps {
  onMenuClick?: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const { t } = useTranslation('common');
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const canFeedback = usePermission('page:feedbackCenter');
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <header className="flex h-14 items-center gap-3 border-b bg-background px-4">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onMenuClick}
        aria-label={t('nav.openMenu')}
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* #403/#722 — Cmd/Ctrl+K command palette: rol-aware ekran-atlama + hasta arama */}
      <CommandPalette />

      <div className="flex-1" />

      {/* S15-PR11 — Hemşire "Acting on Behalf" session widget'ı; sadece hemşire görür */}
      <NurseSessionWidget />

      <NotificationBell />

      {/* #425 — Rol-bazlı ilk-gün onboarding kılavuzu */}
      <OnboardingGuide />

      <LocaleSwitcher />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2" data-testid="user-menu-trigger">
            <span className="hidden max-w-[200px] truncate sm:inline">
              {user?.email ?? t('user.label')}
            </span>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {canFeedback && (
            <DropdownMenuItem data-testid="feedback-trigger" onSelect={() => setFeedbackOpen(true)}>
              <Lightbulb className="mr-2 h-4 w-4" />
              {t('feedback:trigger', { defaultValue: 'Geliştirme İste' })}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => navigate('/profile')}>
            {t('user.profile')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate('/change-password')}>
            {t('user.changePassword')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="danger"
            data-testid="logout-btn"
            onSelect={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            {t('user.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {canFeedback && feedbackOpen && (
        <Suspense fallback={null}>
          <FeedbackCenter open onClose={() => setFeedbackOpen(false)} />
        </Suspense>
      )}
    </header>
  );
}

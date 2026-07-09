import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button';

// #403 — Authenticated 404. Tanımsız route artık sessizce landing'e atmıyor;
// AppShell içinde (sidebar/header korunur) net "sayfa bulunamadı" gösterir.
// "Ana sayfaya dön" rol-bazlı landing'e ('/' → HomeRedirect) götürür.
export function NotFoundPage() {
  const { t } = useTranslation('common');
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">404</p>
        <h1 className="text-2xl font-semibold">{t('errors.notFoundPage.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('errors.notFoundPage.description')}</p>
        <Button asChild variant="outline">
          <Link to="/">{t('errors.notFoundPage.back')}</Link>
        </Button>
      </div>
    </div>
  );
}

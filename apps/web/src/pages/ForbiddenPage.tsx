import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button';

export function ForbiddenPage() {
  const { t } = useTranslation('common');
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">403</p>
        <h1 className="text-2xl font-semibold">{t('errors.forbidden.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('errors.forbidden.description')}</p>
        {/* #400 — '/' → HomeRedirect (rol-bazlı landing). Sabit /dashboard, ölçüm
            hemşiresini (page:dashboard yok) 403 döngüsüne sokuyordu. */}
        <Button asChild variant="outline">
          <Link to="/">{t('errors.forbidden.back')}</Link>
        </Button>
      </div>
    </div>
  );
}

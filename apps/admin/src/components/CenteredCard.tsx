import type { ReactNode } from 'react';
import { BRAND_GRADIENT, BRAND_MESH, BRAND_LOGO_SRC } from '../lib/brand';

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Yetkisiz ekran kabuğu (login / verify-totp / setup-totp).
 * airmed-design Bölüm 24.2 "Quiet Split" — masaüstü 40% marka / 60% görev;
 * sol panel gradient + mesh + monokrom beyaz logo, sağ panel tek kart.
 */
export function CenteredCard({ title, subtitle, children, footer }: Props) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Marka paneli (40%) */}
      <div
        className="relative flex shrink-0 items-center overflow-hidden px-8 py-10 lg:w-2/5 lg:px-12"
        style={{ background: BRAND_GRADIENT }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-10"
          style={{ backgroundImage: BRAND_MESH }}
        />
        <div className="relative max-w-xs">
          <img src={BRAND_LOGO_SRC} alt="" className="block h-12 w-12 lg:h-14 lg:w-14" />
          <p className="mt-5 text-xl font-semibold leading-tight tracking-tight text-white">
            DNA Software Solutions
          </p>
          <p className="mt-1 text-base font-medium text-white/70">Platform Yönetimi</p>
        </div>
      </div>

      {/* Görev paneli (60%) */}
      <div className="flex flex-1 items-center justify-center bg-canvas px-6 py-10">
        <div className="w-full max-w-md">
          <header className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              DNA Software Solutions
            </p>
            <h1 className="mt-1 text-xl font-semibold text-foreground">{title}</h1>
            {subtitle && <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>}
          </header>
          {children}
          {footer && <footer className="mt-6 text-xs text-muted-foreground">{footer}</footer>}
        </div>
      </div>
    </div>
  );
}

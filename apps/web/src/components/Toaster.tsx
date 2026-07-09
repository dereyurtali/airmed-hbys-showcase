import { Toaster as SonnerToaster } from 'sonner';

// Sonner Toaster mount — AppShell'in alt seviyesinde. Login sayfasında
// toast göstermiyoruz; AppShell yalnızca authenticated kullanıcı için
// render olduğundan login akışı toast bildirimi almaz.
//
// Bölüm 24 — beyaz kart + içte duruma göre tint (richColors KAPALI, kendi
// status token'larımız). Üst-sağ, en çok 3 görünür, ~360px genişlik.
export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      visibleToasts={3}
      closeButton
      toastOptions={{
        style: { width: 360 },
        classNames: {
          toast: 'rounded-lg border border-border bg-background text-foreground shadow-float',
          title: 'text-[13px] font-semibold',
          description: 'text-[12px] text-muted-foreground',
          actionButton: 'text-[12px] font-semibold',
          closeButton: 'text-muted-foreground',
          success: 'border-success-border bg-success-bg text-success-foreground',
          info: 'border-info-border bg-info-bg text-info-foreground',
          warning: 'border-warning-border bg-warning-bg text-warning-foreground',
          error: 'border-critical-border bg-critical-bg text-critical-foreground',
        },
      }}
    />
  );
}

import * as React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

// Bölüm 24 — boş durum: illüstrasyon YOK; opsiyonel küçük ikon + başlık + açıklama + tek CTA.
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      {icon && <div className="mb-2 text-muted-foreground">{icon}</div>}
      <div className="text-[15px] font-semibold">{title}</div>
      {description && (
        <p className="mt-1 max-w-sm text-[13px] font-normal text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

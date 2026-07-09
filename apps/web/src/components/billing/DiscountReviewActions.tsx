import { Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// #907 — İndirim onay/red buton çifti. AdminOverviewPage ve ApprovalsPage'de
// birebir aynı markup'tı; tek yerde. Yalnız sunum + iki callback; yetki gate'i
// (canReviewDiscount vb.) çağıran sayfada kalır.

export interface DiscountReviewActionsProps {
  disabled?: boolean;
  onApprove: () => void;
  onReject: () => void;
}

export function DiscountReviewActions({
  disabled,
  onApprove,
  onReject,
}: DiscountReviewActionsProps) {
  const { t } = useTranslation(['common']);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={onReject}
        className="inline-flex items-center gap-1.5 rounded-md border border-critical-border px-3 py-1.5 text-sm font-medium text-critical-foreground transition-colors hover:bg-critical-bg disabled:opacity-50"
      >
        <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        {t('common:adminOverview.approvals.reject')}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onApprove}
        className="inline-flex items-center gap-1.5 rounded-md bg-success-foreground px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-success-foreground/90 disabled:opacity-50"
      >
        <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        {t('common:adminOverview.approvals.approve')}
      </button>
    </div>
  );
}

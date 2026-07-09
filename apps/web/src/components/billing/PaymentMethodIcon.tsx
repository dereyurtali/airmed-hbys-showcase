import { PAYMENT_METHOD_ICONS, type PaymentMethod } from '../../lib/billing.constants';
import { cn } from '../../lib/utils';

/** Ödeme yöntemi ikonu (lucide) — emoji yerine; anti-AI ikon kuralı. */
export function PaymentMethodIcon({
  method,
  className,
}: {
  method: PaymentMethod;
  className?: string;
}) {
  const Icon = PAYMENT_METHOD_ICONS[method];
  return <Icon className={cn('inline h-3.5 w-3.5 shrink-0', className)} aria-hidden />;
}

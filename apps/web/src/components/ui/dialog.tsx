import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    // Bölüm 24 — scrim: düz koyu örtü, blur YOK (klinik okunabilirlik).
    className={cn('fixed inset-0 z-40 bg-[rgba(15,23,42,0.45)]', className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

interface DialogContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  /**
   * "drawer" anchors the content to the left edge full-height (mobile menu).
   * "drawer-right" anchors to the right edge (detail sheets).
   * "centered" centers a modal panel (default — confirmations, forms).
   */
  variant?: 'drawer' | 'drawer-right' | 'centered';
}

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, variant = 'centered', ...props }, ref) => {
  const { t } = useTranslation('common');
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 bg-background shadow-float outline-none animate-motion-pop',
          variant === 'drawer' && 'inset-y-0 left-0 w-60 border-r',
          variant === 'drawer-right' &&
            'inset-y-0 right-0 w-full max-w-md border-l p-6 overflow-y-auto',
          variant === 'centered' &&
            'left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border p-6 max-h-[90vh] overflow-y-auto',
          className,
        )}
        {...props}
      >
        {children}
        {variant !== 'drawer' && (
          <DialogPrimitive.Close
            className="focus-ring absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100"
            aria-label={t('actions.close')}
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-[15px] font-semibold leading-snug', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-[13px] font-normal text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

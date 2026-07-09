import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Birleştir + Tailwind çakışmalarını çöz (apps/web `cn` ile aynı sözleşme). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

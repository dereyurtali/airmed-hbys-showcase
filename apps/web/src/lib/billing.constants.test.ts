import { describe, expect, it } from 'vitest';
import { pickDefaultServiceItem } from './billing.constants';

type Item = { id: string; category: string; isActive: boolean; sortOrder: number };

const items: Item[] = [
  { id: 'exam-2', category: 'examination', isActive: true, sortOrder: 20 },
  { id: 'exam-1', category: 'examination', isActive: true, sortOrder: 10 },
  { id: 'exam-inactive', category: 'examination', isActive: false, sortOrder: 1 },
  { id: 'proc-1', category: 'procedure', isActive: true, sortOrder: 5 },
];

describe('pickDefaultServiceItem (Karar 4)', () => {
  it('kategorideki en düşük sortOrder aktif kalemi seçer', () => {
    expect(pickDefaultServiceItem(items, 'examination')?.id).toBe('exam-1');
  });

  it('pasif kalemleri yok sayar (en düşük sortOrder pasif olsa bile)', () => {
    // exam-inactive sortOrder=1 ama isActive=false → exam-1 (10) kazanır
    expect(pickDefaultServiceItem(items, 'examination')?.id).not.toBe('exam-inactive');
  });

  it('başka kategori için o kategorinin kalemini döner', () => {
    expect(pickDefaultServiceItem(items, 'procedure')?.id).toBe('proc-1');
  });

  it('kategoride aktif kalem yoksa null', () => {
    expect(pickDefaultServiceItem(items, 'surgery')).toBeNull();
  });

  it('category null ise null (otomatik kalem yok)', () => {
    expect(pickDefaultServiceItem(items, null)).toBeNull();
  });

  it('boş liste → null', () => {
    expect(pickDefaultServiceItem([], 'examination')).toBeNull();
  });
});

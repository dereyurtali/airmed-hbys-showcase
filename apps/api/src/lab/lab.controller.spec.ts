import { Reflector } from '@nestjs/core';
import { LabController } from './lab.controller';
import { PERMISSION_KEY } from '../auth/decorators/require-permission.decorator';

// #922 — lab dosya serve endpoint'i, UUID bilen within-tenant her kullanıcının
// PII lab dosyasını indirmesini engellemek için lab geçmişi görme yetkisi ister.
describe('LabController permission metadata (#922)', () => {
  const reflector = new Reflector();

  it('serveFile → view:patient.lab_history yetkisi ister', () => {
    expect(reflector.get(PERMISSION_KEY, LabController.prototype.serveFile)).toBe(
      'view:patient.lab_history',
    );
  });
});

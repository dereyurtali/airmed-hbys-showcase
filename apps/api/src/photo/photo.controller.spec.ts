import { Reflector } from '@nestjs/core';
import { PhotoController } from './photo.controller';
import { PERMISSION_KEY } from '../auth/decorators/require-permission.decorator';

// #922 — foto serve endpoint'i, UUID bilen within-tenant her kullanıcının
// PII fotosunu indirmesini engellemek için galeri görme yetkisi ister.
describe('PhotoController permission metadata (#922)', () => {
  const reflector = new Reflector();

  it('serve → view:patient.photo_gallery yetkisi ister', () => {
    expect(reflector.get(PERMISSION_KEY, PhotoController.prototype.serve)).toBe(
      'view:patient.photo_gallery',
    );
  });

  it('upload → action:photo.upload yetkisi korunur (regresyon)', () => {
    expect(reflector.get(PERMISSION_KEY, PhotoController.prototype.upload)).toBe(
      'action:photo.upload',
    );
  });
});

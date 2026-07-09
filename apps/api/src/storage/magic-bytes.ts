// #1049 — Magic-byte doğrulama. Content-Type header'ı client beyanıdır;
// sahte uzantılı/MIME'lı dosyayı gövdesinden yakalarız. `file-type` paketi
// ESM-only (CJS Nest build'inde sorunlu) olduğundan ihtiyacımız olan dar
// allow-list için imzalar elle tutulur — yeni MIME eklerken buraya imza ekle.

type Signature = { offset: number; bytes: number[] };

const SIGNATURES: Record<string, Signature[]> = {
  'application/pdf': [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }], // %PDF
  'image/jpeg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  'image/jpg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  'image/png': [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  // RIFF....WEBP — 4-7 arası dosya boyutu, atlanır.
  'image/webp': [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
  // OLE2 compound document (legacy .doc)
  'application/msword': [{ offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }],
  // OOXML (.docx) = ZIP konteyneri
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  ],
};

/** Beyan edilen MIME'ın gövde imzasıyla eşleşip eşleşmediği. Bilinmeyen MIME → false. */
export function matchesMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const signatures = SIGNATURES[mimeType.toLowerCase()];
  if (!signatures) return false;
  return signatures.every((sig) =>
    sig.bytes.every((b, i) => buffer.length > sig.offset + i && buffer[sig.offset + i] === b),
  );
}

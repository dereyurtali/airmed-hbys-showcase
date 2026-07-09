// Verhoeff Dihedral algorithm — single-digit checksum that catches all
// single-digit and most adjacent-transposition errors. Used to embed a
// trailing check digit into the MRN so typos in 8-digit sequences fail loud.

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function digits(input: string): number[] {
  if (!/^\d+$/.test(input)) throw new Error('Verhoeff input must be digits only');
  return input.split('').map((c) => Number(c));
}

export function verhoeffChecksum(input: string): number {
  const arr = digits(input).reverse();
  let c = 0;
  arr.forEach((n, i) => {
    c = D[c][P[(i + 1) % 8][n]];
  });
  return INV[c];
}

export function verhoeffValidate(input: string): boolean {
  try {
    const arr = digits(input).reverse();
    let c = 0;
    arr.forEach((n, i) => {
      c = D[c][P[i % 8][n]];
    });
    return c === 0;
  } catch {
    return false;
  }
}

// S13 — Yeni MRN formatı: <prefix(2)><yy(2)><check(1)><seq(5)> = 10 char.
// Verhoeff `yy + seq` (7 hane) üzerinden hesaplanır → yıl typo'sunu da yakalar.
// Eski 9 haneli MRN'ler (`<seq8><check1>`) bu regex'e uymaz → null döner;
// `verhoeffValidate` ile ayrı doğrulanmaya devam eder (geriye uyumlu).
export interface ParsedMrn {
  prefix: string;
  year: number;
  check: number;
  seq: number;
  valid: boolean;
}

export function parseMrn(mrn: string): ParsedMrn | null {
  const m = /^([A-Z]{2})(\d{2})(\d)(\d{5})$/.exec(mrn);
  if (!m) return null;
  const [, prefix, yy, checkStr, seq] = m;
  const expected = verhoeffChecksum(yy + seq).toString();
  return {
    prefix,
    year: 2000 + Number(yy),
    check: Number(checkStr),
    seq: Number(seq),
    valid: expected === checkStr,
  };
}

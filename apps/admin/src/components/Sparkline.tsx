// #1086 — Inline SVG sparkline (ağır grafik bağımlılığı YOK — recharts admin
// bundle'ına girmesin, #1068). Operasyonel trend + opsiyonel eşik çizgisi.

interface Props {
  values: number[];
  width?: number;
  height?: number;
  /** Eşik çizgisi (ör. CPU %80) — değer aralığındaysa kesikli çizgi çizilir. */
  threshold?: number;
  /** y ekseni üst sınırı; verilmezse max(values). */
  max?: number;
  className?: string;
  ariaLabel?: string;
}

export function Sparkline({
  values,
  width = 240,
  height = 48,
  threshold,
  max,
  className,
  ariaLabel,
}: Props) {
  if (values.length === 0) {
    return <div className={className} style={{ width, height }} aria-hidden />;
  }
  const top = max ?? Math.max(...values, threshold ?? 0, 1);
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const y = (v: number) => pad + h - (Math.max(0, Math.min(top, v)) / top) * h;
  const points = values.map((v, i) => `${pad + i * step},${y(v)}`).join(' ');
  const thresholdY = threshold !== undefined && threshold <= top ? y(threshold) : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={ariaLabel}
    >
      {thresholdY !== null && (
        <line
          x1={pad}
          x2={width - pad}
          y1={thresholdY}
          y2={thresholdY}
          stroke="var(--warn-tx)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.5}
        />
      )}
      <polyline
        points={points}
        fill="none"
        stroke="var(--info-tx)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

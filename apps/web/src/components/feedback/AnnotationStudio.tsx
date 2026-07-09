import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Eraser, Loader2, Pencil, Square, X } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

// I2.6 (#824) — Anotasyon stüdyosu. KVKK-kritik: klinik ekran görüntüsü = hasta
// verisi → `data-pii` bölgeleri capture'da OTO-BLUR + manuel blur fırçası +
// gönderim öncesi ZORUNLU önizleme onayı. Redakte PNG `feedback/:id/attachments`e.
//
// Katmanlar: baseRef (screenshot + oto-PII-blur, değişmez) → committedRef (base +
// işlenmiş şekiller) → görünür canvas (committed + canlı şekil önizleme).

type Tool = 'pen' | 'rect' | 'arrow' | 'blur';

interface Point {
  x: number;
  y: number;
}

const STROKE = '#e11d48'; // rose-600
const BLUR_PX = 12;

export function AnnotationStudio({
  onConfirm,
  onCancel,
}: {
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('feedback');
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const committedRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('rect');
  const [capturing, setCapturing] = useState(true);
  const [captureError, setCaptureError] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const drawing = useRef(false);
  const start = useRef<Point>({ x: 0, y: 0 });
  const penPath = useRef<Point[]>([]);

  // 1) Ekran görüntüsü al (drawer + stüdyo hariç) → oto-PII-blur → base + committed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // #1056 — html2canvas (~200KB) yalnız ekran görüntüsü anında yüklenir.
        const { default: html2canvas } = await import('html2canvas');
        const shot = await html2canvas(document.body, {
          x: window.scrollX,
          y: window.scrollY,
          width: window.innerWidth,
          height: window.innerHeight,
          scale: 1,
          logging: false,
          ignoreElements: (el) =>
            el.hasAttribute('data-annotation-studio') ||
            Boolean(el.closest('[data-feedback-drawer]')),
        });
        if (cancelled) return;

        // Oto-PII-blur: data-pii bölgelerini base üstünde blur'la.
        const ctx = shot.getContext('2d');
        if (ctx) {
          const piiEls = Array.from(document.querySelectorAll<HTMLElement>('[data-pii]'));
          for (const el of piiEls) {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;
            blurRegion(ctx, shot, r.left, r.top, r.width, r.height);
          }
        }

        baseRef.current = shot;
        const committed = document.createElement('canvas');
        committed.width = shot.width;
        committed.height = shot.height;
        committed.getContext('2d')?.drawImage(shot, 0, 0);
        committedRef.current = committed;

        // NOT: viewRef burada HENÜZ null — `capturing=true` iken canvas DOM'da
        // değil (spinner gösteriliyor). View canvas'ı, aşağıdaki ikinci effect
        // `capturing=false` olup canvas mount edilince boyutlandırır + çizer.
        setCapturing(false);
      } catch (err) {
        // html2canvas bazı CSS'lerde patlayabilir; sessiz takılı spinner yerine
        // hatayı göster + kapanışa izin ver (yoksa "açılıyor ama işaretlenemiyor").
        if (cancelled) return;
        console.error('[AnnotationStudio] capture failed', err);
        setCaptureError(true);
        setCapturing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2) Capture bitip canvas mount edilince: view'u doğru boyuta getir + committed'i
  //    çiz. Bu effect olmadan view varsayılan 300×150 + boş kalır → ekran düzgün
  //    işaretlenemez (çizim yanlış ölçekte/görünmez). Capture effect'inde yapılamaz:
  //    orada `capturing=true` olduğundan canvas henüz render edilmemiştir.
  useEffect(() => {
    if (capturing || captureError) return;
    const view = viewRef.current;
    const committed = committedRef.current;
    if (!view || !committed) return;
    view.width = committed.width;
    view.height = committed.height;
    view.getContext('2d')?.drawImage(committed, 0, 0);
  }, [capturing, captureError]);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const view = viewRef.current!;
    const rect = view.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * view.width,
      y: ((e.clientY - rect.top) / rect.height) * view.height,
    };
  };

  const redrawView = useCallback((live?: (ctx: CanvasRenderingContext2D) => void) => {
    const view = viewRef.current;
    const committed = committedRef.current;
    if (!view || !committed) return;
    const ctx = view.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.drawImage(committed, 0, 0);
    if (live) live(ctx);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (capturing) return;
    drawing.current = true;
    const p = pointFromEvent(e);
    start.current = p;
    penPath.current = [p];
    viewRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const p = pointFromEvent(e);
    if (tool === 'pen') {
      penPath.current.push(p);
      redrawView((ctx) => drawPen(ctx, penPath.current));
    } else {
      redrawView((ctx) => drawShape(ctx, tool, start.current, p));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    const p = pointFromEvent(e);
    const committed = committedRef.current;
    const base = baseRef.current;
    const ctx = committed?.getContext('2d');
    if (!ctx || !base) return;
    if (tool === 'pen') {
      drawPen(ctx, penPath.current);
    } else if (tool === 'blur') {
      const x = Math.min(start.current.x, p.x);
      const y = Math.min(start.current.y, p.y);
      blurRegion(ctx, base, x, y, Math.abs(p.x - start.current.x), Math.abs(p.y - start.current.y));
    } else {
      drawShape(ctx, tool, start.current, p);
    }
    penPath.current = [];
    redrawView();
  };

  const submit = () => {
    const view = viewRef.current;
    if (!view || !confirmed) return;
    view.toBlob((blob) => {
      if (blob) onConfirm(blob);
    }, 'image/png');
  };

  const TOOLS: { key: Tool; icon: typeof Square; label: string }[] = [
    { key: 'rect', icon: Square, label: t('studio.rect', { defaultValue: 'Kutu' }) },
    { key: 'arrow', icon: ArrowUpRight, label: t('studio.arrow', { defaultValue: 'Ok' }) },
    { key: 'pen', icon: Pencil, label: t('studio.pen', { defaultValue: 'Kalem' }) },
    { key: 'blur', icon: Eraser, label: t('studio.blur', { defaultValue: 'Blurla' }) },
  ];

  return (
    <div
      data-annotation-studio
      className="fixed inset-0 z-[60] flex flex-col bg-black/80 p-3 backdrop-blur-sm"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {TOOLS.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTool(key)}
              aria-pressed={tool === key}
              className={cn(
                'focus-ring flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium',
                tool === key ? 'bg-primary text-primary-foreground' : 'bg-white/90 text-foreground',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label={t('studio.cancel', { defaultValue: 'Kapat' })}
          className="focus-ring rounded-lg bg-white/90 p-2"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg bg-white/5">
        {capturing ? (
          <div className="flex items-center gap-2 text-sm text-white">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t('studio.capturing', { defaultValue: 'Ekran görüntüsü alınıyor…' })}
          </div>
        ) : captureError ? (
          <div className="flex max-w-xs flex-col items-center gap-3 text-center text-sm text-white">
            <span>
              {t('studio.captureFailed', {
                defaultValue: 'Ekran görüntüsü alınamadı. Görsel olmadan da istek gönderebilirsin.',
              })}
            </span>
            <Button variant="outline" onClick={onCancel}>
              {t('studio.cancel', { defaultValue: 'Kapat' })}
            </Button>
          </div>
        ) : (
          <canvas
            ref={viewRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="max-h-full max-w-full cursor-crosshair touch-none rounded shadow-2xl"
          />
        )}
      </div>

      <div className="mt-2 space-y-2 rounded-lg bg-white/95 p-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-5 w-5"
          />
          <span>
            {t('studio.confirmRedaction', {
              defaultValue: 'Görselde hasta verisi görünmüyor, gönderilmesini onaylıyorum.',
            })}
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            {t('studio.cancel', { defaultValue: 'Kapat' })}
          </Button>
          <Button onClick={submit} disabled={!confirmed || capturing || captureError}>
            {t('studio.attach', { defaultValue: 'İşaretli görseli ekle' })}
          </Button>
        </div>
      </div>
    </div>
  );
}

function blurRegion(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.filter = `blur(${BLUR_PX}px)`;
  // Kenar sızmasını önlemek için kaynaktan biraz taşırarak çiz.
  ctx.drawImage(
    source,
    x - BLUR_PX,
    y - BLUR_PX,
    w + 2 * BLUR_PX,
    h + 2 * BLUR_PX,
    x - BLUR_PX,
    y - BLUR_PX,
    w + 2 * BLUR_PX,
    h + 2 * BLUR_PX,
  );
  ctx.restore();
}

function drawPen(ctx: CanvasRenderingContext2D, path: Point[]) {
  if (path.length < 2) return;
  ctx.save();
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (const p of path.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.restore();
}

function drawShape(ctx: CanvasRenderingContext2D, tool: Tool, a: Point, b: Point) {
  ctx.save();
  ctx.strokeStyle = STROKE;
  ctx.fillStyle = STROKE;
  ctx.lineWidth = 3;
  if (tool === 'rect') {
    ctx.strokeRect(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.abs(b.x - a.x),
      Math.abs(b.y - a.y),
    );
  } else if (tool === 'arrow') {
    drawArrow(ctx, a, b);
  } else if (tool === 'blur') {
    // Canlı önizleme: blur bölgesini çerçevele (gerçek blur mouseup'ta).
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.abs(b.x - a.x),
      Math.abs(b.y - a.y),
    );
  }
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, a: Point, b: Point) {
  const head = 14;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(
    b.x - head * Math.cos(angle - Math.PI / 6),
    b.y - head * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    b.x - head * Math.cos(angle + Math.PI / 6),
    b.y - head * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

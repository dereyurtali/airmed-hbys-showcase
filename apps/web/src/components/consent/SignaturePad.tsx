import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';

// Bağımsız bir signature pad — react-signature-canvas paketi yerine yazıldı,
// çünkü tek dosyada 60 satır kod yetiyor ve ek dependency taşımamaya değer.
// Touch + mouse + pointer event'leri destekler.

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  toDataURL: () => string;
}

interface Props {
  width?: number;
  height?: number;
  className?: string;
  strokeStyle?: string;
}

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  { width = 600, height = 200, className, strokeStyle = '#0f172a' },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const dirtyRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  useImperativeHandle(ref, () => ({
    clear: () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      dirtyRef.current = false;
    },
    isEmpty: () => !dirtyRef.current,
    toDataURL: () => canvasRef.current?.toDataURL('image/png') ?? '',
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = strokeStyle;
  }, [strokeStyle]);

  const getPos = (e: PointerEvent | React.PointerEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    drawingRef.current = true;
    lastPosRef.current = getPos(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !lastPosRef.current) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPosRef.current = pos;
    dirtyRef.current = true;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    drawingRef.current = false;
    lastPosRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={`touch-none rounded-md border border-input bg-background ${className ?? ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      data-testid="signature-pad"
    />
  );
});

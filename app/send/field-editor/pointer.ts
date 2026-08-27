// Shared pointer-position math for the field overlay. happy-dom reports
// zero-size bounding rects in tests, so every conversion here guards
// against dividing by a zero width/height.

export function clickToPercent(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
  return {
    x: ((clientX - rect.left) / rect.width) * 100,
    y: ((clientY - rect.top) / rect.height) * 100,
  };
}

export function deltaToPercent(deltaPx: number, sizePx: number): number {
  if (sizePx === 0) return 0;
  return (deltaPx / sizePx) * 100;
}

export const MIN_DRAG_PERCENT = 1;

// Live preview rect while dragging: no minimum-size gating, just the
// percent box spanned by the two points (zero in a zero-rect environment).
export function percentRectFromDrag(
  rect: { left: number; top: number; width: number; height: number },
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number; w: number; h: number } {
  const p1 = clickToPercent(rect, x1, y1);
  const p2 = clickToPercent(rect, x2, y2);
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    w: Math.abs(p2.x - p1.x),
    h: Math.abs(p2.y - p1.y),
  };
}

// Commit a completed drag: null means "discard" (no movement at all, or a
// real drag smaller than the minimum). In a zero-rect environment (happy-dom
// in tests) percent math can't be computed, so any real pointer movement
// there lands the patch at 0,0 with the minimum size.
export function commitDragRect(
  rect: { left: number; top: number; width: number; height: number },
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number; w: number; h: number } | null {
  if (x1 === x2 && y1 === y2) return null;
  if (rect.width === 0 || rect.height === 0) {
    return { x: 0, y: 0, w: MIN_DRAG_PERCENT, h: MIN_DRAG_PERCENT };
  }
  const r = percentRectFromDrag(rect, x1, y1, x2, y2);
  if (r.w < MIN_DRAG_PERCENT || r.h < MIN_DRAG_PERCENT) return null;
  return r;
}

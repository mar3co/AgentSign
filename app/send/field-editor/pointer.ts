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

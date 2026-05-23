/**
 * Push 2c.1 — auto-fit column width on resize-divider double-click
 * (Excel pattern). Measures the widest cell content in a column —
 * header label + all visible row values — and returns a clamped width.
 *
 * Uses canvas measureText for accuracy (works regardless of CSS
 * text-overflow:ellipsis truncation, which a getBoundingClientRect
 * measurement would mis-report against the truncated displayed width).
 *
 * The function is pure (canvas context injected) so it's testable in
 * jsdom without a real canvas — tests can pass a stub context whose
 * measureText returns a fixed-per-char width.
 */

export interface AutoFitMeasureContext {
  measureText(text: string): { width: number }
  font: string
}

export interface MeasureColumnAutoFitParams {
  /** A 2D-canvas-like context. `font` is set on it before measurement. */
  ctx: AutoFitMeasureContext
  /** CSS font string, e.g. "14px system-ui, sans-serif". */
  font: string
  /** Column header label. */
  headerLabel: string
  /** Rendered string values for each visible row. */
  cellValues: string[]
  /** Pixels added to the measured max-text width for cell padding + dividers. */
  padding?: number
  /** Hard floor — never go below this. */
  min?: number
  /** Hard ceiling — never go above this (prevents outlier-driven blow-up). */
  max?: number
}

// Push 2c.1.1 — bumped from 24 → 32 after a real-world phone column
// auto-fit wrapped to 2 lines. 32px matches actual cell padding (px-4
// L+R = 32) plus a sort/resize-handle allowance.
const DEFAULT_PADDING = 32
const DEFAULT_MIN = 60
const DEFAULT_MAX = 400

export function measureColumnAutoFit({
  ctx,
  font,
  headerLabel,
  cellValues,
  padding = DEFAULT_PADDING,
  min = DEFAULT_MIN,
  max = DEFAULT_MAX,
}: MeasureColumnAutoFitParams): number {
  ctx.font = font
  let widest = ctx.measureText(headerLabel).width
  for (const v of cellValues) {
    if (!v) continue
    const w = ctx.measureText(v).width
    if (w > widest) widest = w
  }
  const measured = Math.ceil(widest + padding)
  return Math.min(max, Math.max(min, measured))
}

/**
 * Memoized canvas context for the lifetime of one tab. The DOM-only
 * call site (contacts-table.tsx) guards against SSR via typeof window.
 */
let cachedCtx: CanvasRenderingContext2D | null = null
export function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null
  if (cachedCtx) return cachedCtx
  const canvas = document.createElement("canvas")
  cachedCtx = canvas.getContext("2d")
  return cachedCtx
}

/**
 * Read the effective CSS font on a DOM element so canvas measureText
 * uses the same font (otherwise widths drift). Returns a font string
 * suitable for `ctx.font`.
 */
export function fontFromElement(el: Element): string {
  const styles = window.getComputedStyle(el)
  // Order matters for CSS font shorthand: style weight size family
  const weight = styles.fontWeight || "400"
  const size = styles.fontSize || "14px"
  const family = styles.fontFamily || "system-ui, sans-serif"
  return `${weight} ${size} ${family}`
}

import html2canvas from 'html2canvas-pro'
import { jsPDF } from 'jspdf'

/**
 * Client-side "Download as PDF" helpers.
 *
 * Uses html2canvas-pro (a fork of html2canvas with oklch/lab color support —
 * required because Tailwind CSS 4 uses oklch color functions everywhere) to
 * screenshot rendered document "pages", then assembles them into a single
 * PDF file with jsPDF. Everything happens in the browser — no server calls.
 */

/** Safe maximum canvas dimension (browsers cap canvases at ~32767px). */
const MAX_BITMAP = 16000

export interface PdfExportOptions {
  /**
   * When true, elements taller than one page are sliced vertically into
   * multiple PDF pages (used for long tables / text content).
   * When false (default), each captured element becomes exactly one PDF
   * page of the element's own size (used for DOCX pages / PPTX slides,
   * which already have page-like proportions).
   */
  slice?: boolean
  /** height/width ratio of the slice pages (default: A4 ≈ √2). */
  sliceAspectRatio?: number
  /** Render scale cap (default 2 — crisp text, reasonable file size). */
  maxScale?: number
}

/** Derive a .pdf filename from the source file name. */
export function pdfFilename(sourceName: string): string {
  const base = sourceName.replace(/\.[^.]+$/, '').trim()
  return `${base || 'document'}.pdf`
}

/**
 * Elements marked with `data-dv-page` inside the root are treated as
 * individual pages. When none are found, the root itself is one page.
 */
function collectPages(root: HTMLElement): HTMLElement[] {
  const pages = Array.from(
    root.querySelectorAll<HTMLElement>('[data-dv-page]'),
  )
  return pages.length > 0 ? pages : [root]
}

/**
 * Create a jsPDF document configured for pixel units and an exact page size.
 * NOTE: jsPDF normalises the format array by orientation (portrait forces
 * height ≥ width, landscape forces width ≥ height), so the orientation is
 * derived from the actual aspect ratio to preserve [w, h] EXACTLY.
 */
export function createPdfDocument(w: number, h: number): jsPDF {
  return new jsPDF({
    unit: 'px',
    hotfixes: ['px_scaling'],
    format: [w, h],
    orientation: w > h ? 'landscape' : 'portrait',
    compress: true,
  })
}

/**
 * A jsPDF document always starts with exactly one (empty) page created from
 * the constructor's format. The FIRST image drawn goes onto that existing
 * page; every subsequent image needs a new page via addPage. The flag is
 * stored on the jsPDF instance so the state persists across multiple
 * appendElementAsPdfPage() calls (e.g. one call per document page).
 */
function markFirstPage(pdf: jsPDF): boolean {
  const marker = pdf as jsPDF & { __dvHasContent?: boolean }
  if (marker.__dvHasContent) return false // not the first → caller must addPage
  marker.__dvHasContent = true
  return true // first image → draw onto the existing page 1
}

/**
 * Screenshot one element and append it to the PDF as one or more pages.
 * Exported so viewers with custom export flows (e.g. PPTX, which renders
 * one slide at a time) can reuse the same page-building logic.
 */
export async function appendElementAsPdfPage(
  pdf: jsPDF,
  el: HTMLElement,
  opts: PdfExportOptions = {},
): Promise<number> {
  const rect = el.getBoundingClientRect()
  const w = Math.max(1, Math.ceil(rect.width))
  const h = Math.max(1, Math.ceil(rect.height))
  const maxScale = opts.maxScale ?? 2
  const scale = Math.max(
    0.1,
    Math.min(maxScale, MAX_BITMAP / w, MAX_BITMAP / h),
  )

  const canvas = await html2canvas(el, {
    scale,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
  })
  const bw = canvas.width
  const bh = canvas.height
  if (bw < 1 || bh < 1) return 0

  // Logical (CSS-pixel) page geometry. The bitmap is `scale`× larger purely
  // for crispness — images are always DRAWN at the logical size so the PDF
  // page format and the drawn image always match exactly.
  const ratio = opts.sliceAspectRatio ?? Math.SQRT2
  const sliceH = opts.slice ? Math.max(1, Math.floor(w * ratio)) : h

  let appended = 0
  for (let y = 0; y < h; y += sliceH) {
    const chunkH = Math.min(sliceH, h - y)
    let dataUrl: string
    if (chunkH < h) {
      // Slice the tall canvas bitmap into a page-height chunk. `y` is in
      // logical CSS px — map it to the bitmap's pixel space.
      const chunk = document.createElement('canvas')
      chunk.width = Math.max(1, bw)
      chunk.height = Math.max(1, Math.round((chunkH / h) * bh))
      const ctx = chunk.getContext('2d')
      if (!ctx) continue
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, chunk.width, chunk.height)
      const srcY = Math.round((y / h) * bh)
      ctx.drawImage(canvas, 0, srcY, bw, chunk.height, 0, 0, bw, chunk.height)
      dataUrl = chunk.toDataURL('image/png')
    } else {
      dataUrl = canvas.toDataURL('image/png')
    }
    if (!markFirstPage(pdf)) {
      pdf.addPage(
        [w, chunkH],
        w > chunkH ? 'landscape' : 'portrait',
      )
    }
    pdf.addImage(dataUrl, 'PNG', 0, 0, w, chunkH)
    appended += 1
  }
  return appended
}

/**
 * Export a rendered DOM subtree to a PDF file and trigger a browser download.
 *
 * @param root element whose `[data-dv-page]` descendants (or itself) are
 *             captured page-by-page
 */
export async function exportElementToPdf(
  root: HTMLElement,
  sourceName: string,
  opts: PdfExportOptions = {},
): Promise<void> {
  const pages = collectPages(root)
  const visible = pages.filter((p) => {
    const rect = p.getBoundingClientRect()
    return rect.width >= 1 && rect.height >= 1
  })
  if (visible.length === 0) {
    throw new Error('Нет содержимого для экспорта')
  }

  const first = visible[0]
  const rect = first.getBoundingClientRect()
  const w = Math.max(1, Math.ceil(rect.width))
  const h = Math.max(1, Math.ceil(rect.height))
  // The first page's format must match what appendElementAsPdfPage will draw
  // for the FIRST chunk: the full element height, or — in slice mode — the
  // first slice height.
  const ratio = opts.sliceAspectRatio ?? Math.SQRT2
  const firstPageH = opts.slice
    ? Math.max(1, Math.min(h, Math.floor(w * ratio)))
    : h
  const pdf = createPdfDocument(w, firstPageH)

  let total = 0
  for (const pageEl of visible) {
    total += await appendElementAsPdfPage(pdf, pageEl, opts)
  }
  if (total === 0) {
    throw new Error('Не удалось отрендерить страницы документа')
  }
  pdf.save(pdfFilename(sourceName))
}

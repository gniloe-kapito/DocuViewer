import type { FileCategory, LoadedFile } from './types'

export function getExtension(name: string): string {
  const lastDot = name.lastIndexOf('.')
  if (lastDot === -1 || lastDot === 0) return ''
  return name.slice(lastDot + 1).toLowerCase()
}

const EXT_TO_CATEGORY: Record<string, FileCategory> = {
  pdf: 'pdf',
  docx: 'docx',
  doc: 'docx', // legacy binary .doc — not supported by docx-preview, shows a helpful error
  xlsx: 'xlsx',
  xls: 'xlsx',
  csv: 'xlsx',
  pptx: 'pptx',
  ppt: 'pptx',
  txt: 'text',
  log: 'text',
  text: 'text',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  json: 'json',
  geojson: 'json',
  jsonl: 'json',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  ico: 'image',
  avif: 'image',
  rtf: 'rtf',
}

const MIME_TO_CATEGORY: Record<string, FileCategory> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xlsx',
  'text/csv': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'pptx',
  'text/plain': 'text',
  'text/markdown': 'markdown',
  'application/json': 'json',
  'text/json': 'json',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'image',
  'image/bmp': 'image',
  'image/x-icon': 'image',
  'image/avif': 'image',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
}

export function detectCategory(
  name: string,
  mimeType?: string,
): FileCategory {
  const ext = getExtension(name)
  if (ext && EXT_TO_CATEGORY[ext]) return EXT_TO_CATEGORY[ext]
  if (mimeType) {
    const base = mimeType.split(';')[0].trim().toLowerCase()
    if (MIME_TO_CATEGORY[base]) return MIME_TO_CATEGORY[base]
  }
  return 'unknown'
}

/**
 * Format a byte count into a human-readable string with the correct unit.
 *
 * Robust against any input type (NaN / Infinity / negative / non-number) so a
 * bad value never produces a misleading label like "647 МБ" for a 20 КБ file.
 * The unit list is long enough to rollover cleanly up to petabytes, and the
 * divisor loop guarantees the chosen unit always matches the magnitude.
 */
export function formatBytes(bytes: unknown): string {
  const raw = typeof bytes === 'number' ? bytes : Number(bytes)
  if (!Number.isFinite(raw) || raw < 0) return '0 Б'
  const n = Math.floor(raw)
  if (n < 1024) return `${n} Б`
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ']
  let value = n
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const decimals = value < 10 ? 1 : value < 100 ? 1 : 0
  return `${value.toFixed(decimals)} ${units[i]}`
}

export function formatDate(ts: number): string {
  if (!ts || Number.isNaN(ts)) return '—'
  try {
    return new Date(ts).toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return new Date(ts).toString()
  }
}

let idCounter = 0
export function makeId(): string {
  idCounter += 1
  return `file-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`
}

export async function fileToLoadedFile(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<LoadedFile> {
  const name = file.name
  const category = detectCategory(name, file.type || undefined)
  const arrayBuffer = await file.arrayBuffer()

  // Report read progress (arrayBuffer read is atomic, so just report 1)
  onProgress?.(1)

  const blob = new Blob([arrayBuffer], { type: file.type || 'application/octet-stream' })
  const url = URL.createObjectURL(blob)

  // For text-based categories, decode text content now
  let textContent: string | undefined
  if (
    category === 'text' ||
    category === 'markdown' ||
    category === 'json' ||
    category === 'rtf'
  ) {
    try {
      textContent = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer)
    } catch {
      textContent = undefined
    }
  }

  return {
    id: makeId(),
    name,
    // Snapshot the size as a finite number immediately. `file.size` is a stable
    // readonly property of the File, but we coerce defensively so a weird /
    // undefined value can never leak into the UI as a misleading huge number.
    size: Number.isFinite(file.size) ? file.size : 0,
    type: file.type || '',
    lastModified: file.lastModified || Date.now(),
    extension: getExtension(name),
    category,
    arrayBuffer,
    url,
    textContent,
    createdAt: Date.now(),
  }
}

export async function urlToLoadedFile(
  url: string,
  onProgress?: (ratio: number) => void,
): Promise<LoadedFile> {
  const res = await fetch(url, { mode: 'cors' })
  if (!res.ok) {
    throw new Error(`Не удалось загрузить файл (HTTP ${res.status})`)
  }
  const blob = await res.blob()
  const nameFromUrl = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'file')
  const file = new File([blob], nameFromUrl, {
    type: blob.type,
    lastModified: Date.now(),
  })
  return fileToLoadedFile(file, onProgress)
}

export function revokeLoadedFile(file: LoadedFile) {
  try {
    URL.revokeObjectURL(file.url)
  } catch {
    // ignore
  }
}

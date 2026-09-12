import * as React from 'react'

/**
 * Category of a loaded file. Drives which viewer component renders it.
 */
export type FileCategory =
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'text'
  | 'markdown'
  | 'json'
  | 'image'
  | 'rtf'
  | 'unknown'

/**
 * A fully loaded file ready to be displayed by a viewer.
 * `arrayBuffer` is the raw bytes; `url` is an object URL for streaming/img use;
 * `textContent` is pre-decoded UTF-8 text for text-like categories.
 */
export interface LoadedFile {
  id: string
  name: string
  size: number
  type: string
  lastModified: number
  extension: string
  category: FileCategory
  arrayBuffer: ArrayBuffer
  url: string
  textContent?: string
  createdAt: number
}

export interface ViewerProps {
  file: LoadedFile
}

export type ViewerComponent = React.ComponentType<ViewerProps>

export interface ViewerMeta {
  category: FileCategory
  label: string
  extensions: string[]
  mimeTypes: string[]
  available: boolean
}

export const CATEGORY_LABELS: Record<FileCategory, string> = {
  pdf: 'PDF документ',
  docx: 'Word документ (DOCX)',
  xlsx: 'Таблица (XLSX/XLS/CSV)',
  pptx: 'Презентация (PPTX)',
  text: 'Текстовый файл',
  markdown: 'Markdown',
  json: 'JSON',
  image: 'Изображение',
  rtf: 'RTF документ',
  unknown: 'Неизвестный формат',
}

/** Per-format accent colours for every format badge (tabs strip, history
 *  panel, metadata panel) — the same palette as the landing FORMAT_CHIPS
 *  (src/app/page.tsx), so a format keeps one recognisable colour everywhere:
 *  PDF rose / DOC sky / XLS emerald / PPT orange / MD violet / JSON amber /
 *  TXT zinc / IMG teal / RTF fuchsia. Each pair is tuned for light and dark
 *  themes (600–700 on light, 300 on dark over a 10% tint). */
export const CATEGORY_COLORS: Record<FileCategory, string> = {
  pdf: 'bg-rose-500/10 text-rose-600 dark:text-rose-300 border-rose-500/25',
  docx: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25',
  xlsx: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
  pptx: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/25',
  markdown: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25',
  json: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25',
  text: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 border-zinc-500/25',
  image: 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/25',
  rtf: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/25',
  unknown: 'bg-muted text-muted-foreground border-border',
}

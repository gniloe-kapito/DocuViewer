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

/** One shared Word-blue brand accent for every format badge (tabs strip,
 *  history panel, metadata panel) — the semantic `primary` tokens make it
 *  theme-adaptive: #2B579A on light, #41A5EE on dark. Format identity is
 *  carried by the mono label (PDF / DOC / XLS…), not by the colour. */
export const CATEGORY_COLORS: Record<FileCategory, string> = {
  pdf: 'bg-primary/10 text-primary border-primary/30',
  docx: 'bg-primary/10 text-primary border-primary/30',
  xlsx: 'bg-primary/10 text-primary border-primary/30',
  pptx: 'bg-primary/10 text-primary border-primary/30',
  text: 'bg-primary/10 text-primary border-primary/30',
  markdown: 'bg-primary/10 text-primary border-primary/30',
  json: 'bg-primary/10 text-primary border-primary/30',
  image: 'bg-primary/10 text-primary border-primary/30',
  rtf: 'bg-primary/10 text-primary border-primary/30',
  unknown: 'bg-muted text-muted-foreground border-border',
}

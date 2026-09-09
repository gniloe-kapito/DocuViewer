import dynamic from 'next/dynamic'
import type { FileCategory, ViewerComponent, ViewerMeta } from './types'

// All viewers are loaded client-side only (no SSR) since they touch
// browser-only APIs (Canvas, Web Workers, File API, DOM).
const loadingFallback = () => null

export const VIEWER_REGISTRY: Record<FileCategory, ViewerComponent | null> = {
  pdf: dynamic(() => import('@/components/viewers/pdf-viewer').then(m => m.PdfViewer), {
    ssr: false,
    loading: loadingFallback,
  }),
  docx: dynamic(() => import('@/components/viewers/docx-viewer').then(m => m.DocxViewer), {
    ssr: false,
    loading: loadingFallback,
  }),
  xlsx: dynamic(() => import('@/components/viewers/xlsx-viewer').then(m => m.XlsxViewer), {
    ssr: false,
    loading: loadingFallback,
  }),
  pptx: dynamic(() => import('@/components/viewers/pptx-viewer').then(m => m.PptxViewer), {
    ssr: false,
    loading: loadingFallback,
  }),
  text: dynamic(() => import('@/components/viewers/text-viewer').then(m => m.TextViewer), {
    ssr: false,
    loading: loadingFallback,
  }),
  markdown: dynamic(() => import('@/components/viewers/markdown-viewer').then(m => m.MarkdownViewer), {
    ssr: false,
    loading: loadingFallback,
  }),
  json: dynamic(() => import('@/components/viewers/json-viewer').then(m => m.JsonViewer), {
    ssr: false,
    loading: loadingFallback,
  }),
  image: dynamic(() => import('@/components/viewers/image-viewer').then(m => m.ImageViewer), {
    ssr: false,
    loading: loadingFallback,
  }),
  rtf: dynamic(() => import('@/components/viewers/rtf-viewer').then(m => m.RtfViewer), {
    ssr: false,
    loading: loadingFallback,
  }),
  unknown: null,
}

export const VIEWER_META: ViewerMeta[] = [
  {
    category: 'pdf',
    label: 'PDF',
    extensions: ['pdf'],
    mimeTypes: ['application/pdf'],
    available: true,
  },
  {
    category: 'docx',
    label: 'DOCX',
    extensions: ['docx'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    available: true,
  },
  {
    category: 'xlsx',
    label: 'XLSX / XLS / CSV',
    extensions: ['xlsx', 'xls', 'csv'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ],
    available: true,
  },
  {
    category: 'pptx',
    label: 'PPTX',
    extensions: ['pptx', 'ppt'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
    ],
    available: true,
  },
  {
    category: 'text',
    label: 'TXT',
    extensions: ['txt', 'log', 'text'],
    mimeTypes: ['text/plain'],
    available: true,
  },
  {
    category: 'markdown',
    label: 'Markdown',
    extensions: ['md', 'markdown', 'mdx'],
    mimeTypes: ['text/markdown'],
    available: true,
  },
  {
    category: 'json',
    label: 'JSON',
    extensions: ['json', 'geojson', 'jsonl'],
    mimeTypes: ['application/json', 'text/json'],
    available: true,
  },
  {
    category: 'image',
    label: 'Изображения',
    extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'],
    mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
    available: true,
  },
  {
    category: 'rtf',
    label: 'RTF',
    extensions: ['rtf'],
    mimeTypes: ['application/rtf', 'text/rtf'],
    available: true,
  },
]

export function getSupportedExtensions(): string[] {
  return VIEWER_META.flatMap(m => m.extensions)
}

export function isSupported(category: FileCategory): boolean {
  return category !== 'unknown' && VIEWER_REGISTRY[category] != null
}

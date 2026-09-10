'use client'

import { create } from 'zustand'

/**
 * Global UI state for the document viewer, shared by ALL viewer components
 * (PDF, DOCX, XLSX, PPTX, text-like, images) and by the app page itself.
 *
 * Previously the "right metadata panel" visibility lived as a local state in
 * the page component and parts of viewers, so toggling behaved differently
 * per format (e.g. did nothing for PDF). Moving it here guarantees exactly
 * the same behaviour for every format:
 *
 * - `metaPanelOpen`  — visibility of the RIGHT metadata panel (the block with
 *   "Имя / Размер / Расширение / Тип (MIME) / Изменён"). Toggled by the
 *   "Скрыть панель файла" button in the unified viewer toolbar. When it is
 *   closed the viewer area stretches to the full available width.
 *
 * - `thumbsOpen` — visibility of the LEFT thumbnails sidebar. Toggled by the
 *   small edge button next to the sidebar (independent from the metadata
 *   panel). Defaults to open on desktop, closed on narrow screens.
 *
 * - `nightMode` — «Night mode» for visually-rendered formats (PDF pages,
 *   images): inverts the page/picture colours (filter: invert + hue-rotate)
 *   so white documents become dark — comfortable reading in a dark room.
 *   OFF by default; the print/export clones always strip it, so printed and
 *   exported documents keep their natural colours.
 *
 * All three flags are persisted to localStorage (see `setupViewerUiPrefs`),
 * so the layout survives page reloads. Loading happens AFTER hydration (in a
 * mount effect), so the server HTML and the first client render always agree —
 * no hydration mismatch.
 */
interface ViewerUiState {
  metaPanelOpen: boolean
  thumbsOpen: boolean
  nightMode: boolean
  toggleMetaPanel: () => void
  setMetaPanelOpen: (open: boolean) => void
  toggleThumbs: () => void
  setThumbsOpen: (open: boolean) => void
  toggleNightMode: () => void
  setNightMode: (on: boolean) => void
}

const PREFS_KEY = 'docuviewer-ui-prefs'
/** Window flag making the persistence setup idempotent across HMR reloads. */
const SETUP_FLAG = '__dvUiPrefsSetup'

function initialThumbsOpen(): boolean {
  if (typeof window === 'undefined') return true
  return window.innerWidth >= 768
}

export const useViewerUiStore = create<ViewerUiState>((set) => ({
  metaPanelOpen: true,
  thumbsOpen: initialThumbsOpen(),
  nightMode: false,
  toggleMetaPanel: () =>
    set((s) => ({ metaPanelOpen: !s.metaPanelOpen })),
  setMetaPanelOpen: (open) => set({ metaPanelOpen: open }),
  toggleThumbs: () => set((s) => ({ thumbsOpen: !s.thumbsOpen })),
  setThumbsOpen: (open) => set({ thumbsOpen: open }),
  toggleNightMode: () => set((s) => ({ nightMode: !s.nightMode })),
  setNightMode: (on) => set({ nightMode: on }),
}))

interface StoredPrefs {
  metaPanelOpen?: unknown
  thumbsOpen?: unknown
  nightMode?: unknown
}

/**
 * One-time initialisation: loads persisted preferences and subscribes to
 * store changes to keep localStorage in sync. Call from a mount effect on
 * the app page (client only, after hydration).
 */
export function setupViewerUiPrefs(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & { [SETUP_FLAG]?: boolean }
  if (w[SETUP_FLAG]) return
  w[SETUP_FLAG] = true

  // ---- load ----
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (raw) {
      const data = JSON.parse(raw) as StoredPrefs
      const s = useViewerUiStore.getState()
      if (typeof data.metaPanelOpen === 'boolean') {
        s.setMetaPanelOpen(data.metaPanelOpen)
      }
      if (typeof data.thumbsOpen === 'boolean') {
        s.setThumbsOpen(data.thumbsOpen)
      }
      if (typeof data.nightMode === 'boolean') {
        s.setNightMode(data.nightMode)
      }
    }
  } catch {
    // Corrupted or unavailable storage — silently fall back to defaults.
  }

  // ---- persist ----
  useViewerUiStore.subscribe((s) => {
    try {
      window.localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          metaPanelOpen: s.metaPanelOpen,
          thumbsOpen: s.thumbsOpen,
          nightMode: s.nightMode,
        }),
      )
    } catch {
      // Storage full / disabled — preferences just won't persist.
    }
  })
}

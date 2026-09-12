'use client'

import { create } from 'zustand'
import { makeId } from '@/lib/file-utils'

/**
 * Publication record for a document shared via the «Поделиться» flow.
 * Stored ONLY in this browser's localStorage: the kappa.lol id, the delete
 * key (needed to revoke access later — possible only from this device),
 * the FULL share link (with the decryption key in the fragment) and the
 * publication date.
 */
export interface ShareRecord {
  /** File id on kappa.lol (`?shared=` part of the link). */
  kappaId: string
  /** Delete key for https://kappa.lol/api/delete?key=… */
  deleteKey: string
  /** Full share link — INCLUDING the secret key in the hash fragment. */
  link: string
  /** When the document was published (epoch ms). */
  sharedAt: number
}

export interface HistoryEntry {
  id: string
  name: string
  size: number
  category: string
  extension: string
  type: string
  openedAt: number
  /** Present when this document was published via «Поделиться». */
  share?: ShareRecord
}

/** Defensive share-record validation (localStorage may hold old shapes). */
function sanitizeShare(raw: unknown): ShareRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const s = raw as Record<string, unknown>
  if (
    typeof s.kappaId === 'string' &&
    s.kappaId.length > 0 &&
    typeof s.deleteKey === 'string' &&
    s.deleteKey.length > 0 &&
    typeof s.link === 'string' &&
    s.link.length > 0
  ) {
    return {
      kappaId: s.kappaId,
      deleteKey: s.deleteKey,
      link: s.link,
      sharedAt: typeof s.sharedAt === 'number' ? s.sharedAt : Date.now(),
    }
  }
  return undefined
}

const STORAGE_KEY = 'docuviewer.history.v1'
const MAX_ENTRIES = 30

function loadHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (e): e is HistoryEntry =>
          e &&
          typeof e === 'object' &&
          typeof e.id === 'string' &&
          typeof e.name === 'string' &&
          typeof e.size === 'number' &&
          typeof e.category === 'string',
      )
      .map((e) => ({
        ...e,
        share: sanitizeShare((e as { share?: unknown }).share),
      }))
  } catch {
    return []
  }
}

function saveHistory(entries: HistoryEntry[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // storage full or unavailable — ignore silently
  }
}

interface HistoryState {
  entries: HistoryEntry[]
  loaded: boolean
  load: () => void
  add: (entry: Omit<HistoryEntry, 'openedAt'>) => void
  remove: (id: string) => void
  clear: () => void
  /** Attaches a publication record to the entry of a just-shared file
   *  (matched by name+size, mirroring the de-dupe rule). If no entry
   *  exists yet (history was cleared meanwhile), a fresh one is created so
   *  the promise «link saved in your local history» always holds. */
  markShared: (
    file: {
      name: string
      size: number
      category: string
      extension: string
      type: string
    },
    share: Omit<ShareRecord, 'sharedAt'>,
  ) => void
  /** Clears the publication status (after «Отозвать доступ»). The local
   *  file record itself is kept — only the share state is dropped. */
  unmarkShared: (id: string) => void
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],
  loaded: false,
  load: () => {
    if (get().loaded) return
    set({ entries: loadHistory(), loaded: true })
  },
  add: (entry) => {
    const full: HistoryEntry = { ...entry, openedAt: Date.now() }
    set((state) => {
      // de-dupe by name+size. The publication record (share link, delete
      // key) belongs to the FILE, not to one opening session: re-opening
      // the same document (locally or via its own share link) must never
      // silently drop the ability to copy the link / revoke access.
      const existing = state.entries.find(
        (e) => e.name === full.name && e.size === full.size,
      )
      if (existing?.share) full.share = existing.share
      const filtered = state.entries.filter(
        (e) => !(e.name === full.name && e.size === full.size),
      )
      const next = [full, ...filtered].slice(0, MAX_ENTRIES)
      saveHistory(next)
      return { entries: next }
    })
  },
  remove: (id) => {
    set((state) => {
      const next = state.entries.filter((e) => e.id !== id)
      saveHistory(next)
      return { entries: next }
    })
  },
  clear: () => {
    saveHistory([])
    set({ entries: [] })
  },
  markShared: (file, share) => {
    const record: ShareRecord = { ...share, sharedAt: Date.now() }
    set((state) => {
      const idx = state.entries.findIndex(
        (e) => e.name === file.name && e.size === file.size,
      )
      let next: HistoryEntry[]
      if (idx === -1) {
        next = [
          {
            id: makeId(),
            name: file.name,
            size: file.size,
            category: file.category,
            extension: file.extension,
            type: file.type,
            openedAt: Date.now(),
            share: record,
          },
          ...state.entries,
        ].slice(0, MAX_ENTRIES)
      } else {
        next = state.entries.map((e, i) =>
          i === idx ? { ...e, share: record } : e,
        )
      }
      saveHistory(next)
      return { entries: next }
    })
  },
  unmarkShared: (id) => {
    set((state) => {
      const next = state.entries.map((e) =>
        e.id === id ? { ...e, share: undefined } : e,
      )
      saveHistory(next)
      return { entries: next }
    })
  },
}))

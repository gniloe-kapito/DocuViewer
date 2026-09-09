'use client'

import { create } from 'zustand'

export interface HistoryEntry {
  id: string
  name: string
  size: number
  category: string
  extension: string
  type: string
  openedAt: number
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
    return parsed.filter(
      (e): e is HistoryEntry =>
        e &&
        typeof e.id === 'string' &&
        typeof e.name === 'string' &&
        typeof e.size === 'number' &&
        typeof e.category === 'string',
    )
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
      // de-dupe by name+size
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
}))

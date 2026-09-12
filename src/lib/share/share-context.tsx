'use client'

import * as React from 'react'
import type { LoadedFile } from '@/lib/viewers/types'

/**
 * Context that enables the "Поделиться" button inside the universal viewer
 * toolbar (ViewerShell). The page provides the handler (it owns the
 * ShareDialog and the open-file state); each shell passes ITS OWN file, so
 * in compare mode the left and right panes share exactly the document they
 * display. When no provider is mounted the button is not rendered at all.
 */
const ShareFileContext = React.createContext<((file: LoadedFile) => void) | null>(
  null,
)

export function ShareFileProvider({
  onShare,
  children,
}: {
  onShare: (file: LoadedFile) => void
  children: React.ReactNode
}) {
  const value = React.useMemo(() => onShare, [onShare])
  return (
    <ShareFileContext.Provider value={value}>
      {children}
    </ShareFileContext.Provider>
  )
}

export function useShareFile(): ((file: LoadedFile) => void) | null {
  return React.useContext(ShareFileContext)
}

/**
 * Share-link format:
 *
 *   {origin}{basePath}/?shared={kappaId}#k={key-base64url}&iv={iv-base64url}
 *
 * The SECRET part (AES key + IV) lives strictly in the hash fragment —
 * browsers never transmit the fragment to any server on any request, so
 * kappa.lol (and any middlebox) only ever sees the `?shared={id}` part.
 *
 * The base path is derived from the CURRENT page location, so links built
 * in dev (http://localhost:3000/…) and on GitHub Pages
 * (https://user.github.io/Repo/…) are both correct without configuration.
 */

export interface SharedLinkParts {
  id: string
  key: string
  iv: string
}

/** Builds the full share URL (with the key in the fragment). */
export function buildShareLink(
  kappaId: string,
  keyB64: string,
  ivB64: string,
): string {
  const base = `${window.location.origin}${window.location.pathname.replace(/\/+$/, '')}`
  return `${base}/?shared=${encodeURIComponent(kappaId)}#k=${keyB64}&iv=${ivB64}`
}

/**
 * Reads `?shared=` and `#k=&iv=` from the current location.
 * Returns null when the URL carries no share parts at all; otherwise a
 * partial object — the caller validates completeness (a truncated link
 * must show the friendly error screen, not a technical crash).
 */
export function parseSharedLink(): Partial<SharedLinkParts> | null {
  if (typeof window === 'undefined') return null
  const query = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const id = query.get('shared')
  const key = hash.get('k')
  const iv = hash.get('iv')
  if (!id && !key && !iv) return null
  return {
    id: id ?? undefined,
    key: key ?? undefined,
    iv: iv ?? undefined,
  }
}

/** Strips `?shared=…#k=…&iv=…` from the address bar without reloading. */
export function clearSharedUrl(): void {
  try {
    window.history.replaceState(null, '', window.location.pathname)
  } catch {
    // history API unavailable — the params simply stay (harmless)
  }
}

/**
 * Minimal client for the public file host kappa.lol — the ONLY network
 * party in the "Share document" flow, and it never sees anything but an
 * opaque AES-GCM-encrypted blob (`share.bin`, application/octet-stream).
 *
 * Verified API shape (2026-09, live):
 *   POST https://kappa.lol/api/upload            multipart/form-data, field "file"
 *        → 200 { id, ext, type, checksum, key, link, delete }
 *          (`key` = delete key; `delete` = full URL  https://kappa.lol/delete?KEY)
 *   GET  https://kappa.lol/{id}                   → raw bytes (CORS: *)
 *        → 404 after deletion / expiry
 *   GET  https://kappa.lol/api/delete?key={key}   → { success: true|false }
 * All endpoints answer with `access-control-allow-origin: *`.
 *
 * Errors surfaced to the UI are ALWAYS human-readable Russian strings —
 * raw network/console errors never leak into user-facing copy.
 */

const KAPPA_ORIGIN = 'https://kappa.lol'
const KAPPA_UPLOAD_URL = `${KAPPA_ORIGIN}/api/upload`

/** Public size limit advertised by kappa.lol (100 MiB). */
export const KAPPA_MAX_FILE_SIZE = 100 * 1024 * 1024

/** Upload failure with a ready-to-show, human-readable message. */
export class ShareUploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShareUploadError'
  }
}

export interface KappaUploadResult {
  /** Short file id on kappa.lol (goes into `?shared=`). */
  id: string
  /** Direct link to the encrypted blob (https://kappa.lol/{id}). */
  link: string
  /** Delete KEY — required by /api/delete?key=… (NOT the full URL). */
  deleteKey: string
  /** MD5 checksum reported by the service (informational). */
  checksum: string
}

/** The `delete` field of the upload response is a full URL — extract the key. */
function extractDeleteKey(rawKey: unknown, deleteUrl: unknown): string {
  if (typeof rawKey === 'string' && rawKey.length > 0) return rawKey
  if (typeof deleteUrl === 'string') {
    const q = deleteUrl.indexOf('?')
    const key = q >= 0 ? deleteUrl.slice(q + 1) : ''
    if (key.length > 0) return key
  }
  return ''
}

/**
 * Uploads the encrypted blob. The filename is a generic `share.bin` and the
 * content type is application/octet-stream — the real name/type/size are
 * encrypted INSIDE the blob and stay invisible to the service.
 */
export async function uploadEncryptedShare(blob: Blob): Promise<KappaUploadResult> {
  const form = new FormData()
  form.append(
    'file',
    new File([blob], 'share.bin', { type: 'application/octet-stream' }),
  )

  let res: Response
  try {
    res = await fetch(KAPPA_UPLOAD_URL, { method: 'POST', body: form })
  } catch {
    throw new ShareUploadError(
      'Не удалось связаться с сервисом kappa.lol — проверьте подключение к интернету и попробуйте снова.',
    )
  }

  if (!res.ok) {
    if (res.status === 413) {
      throw new ShareUploadError(
        'Зашифрованный файл получился слишком большим для kappa.lol (лимит 100 МиБ). Попробуйте поделиться документом меньшего размера.',
      )
    }
    if (res.status === 429) {
      throw new ShareUploadError(
        'kappa.lol временно ограничил количество загрузок. Подождите пару минут и попробуйте снова.',
      )
    }
    throw new ShareUploadError(
      `Сервис kappa.lol ответил ошибкой (HTTP ${res.status}). Попробуйте поделиться позже.`,
    )
  }

  let json: Record<string, unknown>
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    throw new ShareUploadError(
      'kappa.lol вернул нечитаемый ответ. Попробуйте ещё раз.',
    )
  }

  const id = typeof json.id === 'string' ? json.id : ''
  const link =
    typeof json.link === 'string' && json.link.length > 0
      ? json.link
      : id
        ? `${KAPPA_ORIGIN}/${id}`
        : ''
  const deleteKey = extractDeleteKey(json.key, json.delete)
  if (!id || !link || !deleteKey) {
    throw new ShareUploadError(
      'kappa.lol вернул неполный ответ — попробуйте ещё раз.',
    )
  }
  return {
    id,
    link,
    deleteKey,
    checksum: typeof json.checksum === 'string' ? json.checksum : '',
  }
}

/**
 * Downloads the encrypted blob by its kappa.lol id. Throw messages are
 * internal markers only — the receiving UI shows one friendly screen.
 */
export async function downloadEncryptedShare(id: string): Promise<ArrayBuffer> {
  const url = `${KAPPA_ORIGIN}/${encodeURIComponent(id)}`
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new Error('network-error')
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  return res.arrayBuffer()
}

/**
 * Revokes a published file (GET /api/delete?key=…). Returns false on any
 * failure — the caller decides what to tell the user.
 */
export async function revokeKappaShare(deleteKey: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${KAPPA_ORIGIN}/api/delete?key=${encodeURIComponent(deleteKey)}`,
    )
    if (!res.ok) return false
    const json = (await res.json().catch(() => null)) as
      | { success?: unknown }
      | null
    // Older/edge deployments answer 200 with {success:false} on bad keys.
    return json == null ? true : json.success !== false
  } catch {
    return false
  }
}

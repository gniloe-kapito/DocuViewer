/**
 * Client-side encryption for the "Share document" feature.
 *
 * Everything happens in the browser via the built-in Web Crypto API
 * (SubtleCrypto) — no third-party crypto libraries are involved.
 *
 * Packet format (assembled BEFORE encryption so the whole thing — metadata
 * and content — is one opaque binary blob for the file host):
 *
 *   [ 4 bytes: metadata length, big-endian ][ metadata JSON, UTF-8 ][ raw file bytes ]
 *
 * The metadata JSON carries { name, mimeType, size } — the real file name
 * and type are therefore never visible to kappa.lol, only the encrypted
 * bytes are.
 *
 * Algorithm: AES-GCM with a 256-bit key generated fresh for EVERY share
 * (never stored, never reused) and a random 12-byte IV. The key and IV are
 * encoded as base64url (URL-safe, no padding) and live EXCLUSIVELY in the
 * URL hash fragment (`#k=…&iv=…`) — a fragment the browser never sends to
 * any server by protocol design.
 */

/** Marker error: decryption/packet parsing failed (bad key, corrupted data). */
export class ShareCryptoError extends Error {
  constructor() {
    super('decryption-failed')
    this.name = 'ShareCryptoError'
  }
}

export interface EncryptedShare {
  /** Encrypted binary packet — ready to upload as an opaque blob. */
  blob: Blob
  /** AES-256-GCM raw key, base64url. NEVER uploaded; travels in `#k=`. */
  key: string
  /** 12-byte random IV, base64url. Travels in `#iv=` next to the key. */
  iv: string
}

interface PacketMetadata {
  name: string
  mimeType: string
  size: number
}

const encoder = new TextEncoder()

/* ------------------------------------------------------------------ */
/*  base64url helpers (URL-safe alphabet, no padding)                   */
/* ------------------------------------------------------------------ */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded =
    normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    throw new ShareCryptoError()
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/* ------------------------------------------------------------------ */
/*  Encrypt (sender side)                                              */
/* ------------------------------------------------------------------ */

/**
 * Builds and encrypts the share packet for a loaded file.
 *
 * @param file the loaded document (needs name, type, size and the raw
 *             `arrayBuffer` — `LoadedFile` satisfies this shape).
 */
export async function encryptForShare(file: {
  name: string
  type: string
  size: number
  arrayBuffer: ArrayBuffer
}): Promise<EncryptedShare> {
  const meta: PacketMetadata = {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
  }
  const metaBytes = encoder.encode(JSON.stringify(meta))
  const content = new Uint8Array(file.arrayBuffer)

  // [4-byte BE length][metadata][content]
  const packet = new Uint8Array(4 + metaBytes.length + content.length)
  new DataView(packet.buffer).setUint32(0, metaBytes.length, false)
  packet.set(metaBytes, 4)
  packet.set(content, 4 + metaBytes.length)

  // Fresh random key + IV for THIS share only.
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable — the raw key becomes part of the share link
    ['encrypt', 'decrypt'],
  )
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    packet,
  )
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key))

  return {
    blob: new Blob([encrypted], { type: 'application/octet-stream' }),
    key: toBase64Url(rawKey),
    iv: toBase64Url(iv),
  }
}

/* ------------------------------------------------------------------ */
/*  Decrypt (receiver side)                                            */
/* ------------------------------------------------------------------ */

/**
 * Decrypts a downloaded share blob and rebuilds the original `File`
 * (name, MIME type and bytes come out of the encrypted metadata packet).
 *
 * Throws {@link ShareCryptoError} for ANY failure — wrong key, truncated
 * data, corrupted packet — the receiving UI shows one friendly message.
 */
export async function decryptSharedPacket(
  data: ArrayBuffer,
  keyB64: string,
  ivB64: string,
): Promise<File> {
  let decrypted: ArrayBuffer
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      fromBase64Url(keyB64),
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    )
    const iv = fromBase64Url(ivB64)
    if (iv.length !== 12) throw new Error('bad iv length')
    decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  } catch {
    throw new ShareCryptoError()
  }

  const packet = new Uint8Array(decrypted)
  if (packet.length < 4) throw new ShareCryptoError()
  const metaLength = new DataView(
    packet.buffer,
    packet.byteOffset,
    packet.byteLength,
  ).getUint32(0, false)
  if (metaLength <= 0 || metaLength > packet.length - 4) {
    throw new ShareCryptoError()
  }

  let meta: Partial<PacketMetadata>
  try {
    meta = JSON.parse(
      new TextDecoder().decode(packet.subarray(4, 4 + metaLength)),
    )
  } catch {
    throw new ShareCryptoError()
  }
  if (
    typeof meta.name !== 'string' ||
    meta.name.length === 0 ||
    typeof meta.mimeType !== 'string'
  ) {
    throw new ShareCryptoError()
  }

  const name = meta.name.slice(0, 300)
  const content = packet.slice(4 + metaLength)
  return new File([content], name, {
    type: meta.mimeType || 'application/octet-stream',
  })
}

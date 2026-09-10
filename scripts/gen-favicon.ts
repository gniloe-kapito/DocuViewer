/**
 * Generates the DocuViewer favicon set into public/:
 *   favicon.ico (16+32+48 packed), favicon-16x16.png, favicon-32x32.png,
 *   favicon-48x48.png, favicon-192x192.png, favicon-512x512.png,
 *   apple-touch-icon.png (180, full-bleed — iOS rounds it itself).
 *
 * The mark mirrors the header logo tile: a rounded square with the product
 * Word-blue gradient (#2B579A → #41A5EE) and a white document glyph whose
 * "text lines" are light-blue/white tints. Theme-independent (favicons
 * don't switch).
 *
 * Run:  cd <project root> && bun scripts/gen-favicon.ts
 * Requires dev-only deps: sharp (PNG rendering) + python3/Pillow (ICO pack).
 */
import sharp from 'sharp'
import { execSync } from 'node:child_process'

const OUT = 'public'

/** Shared glyph painter: one SVG for every size (vector → crisp renders). */
function markSvg(opts: { fullBleed: boolean }): string {
  const bg = opts.fullBleed
    ? `<rect x="0" y="0" width="512" height="512" fill="url(#g)"/>`
    : `<rect x="24" y="24" width="464" height="464" rx="108" fill="url(#g)"/>
       <rect x="24" y="24" width="464" height="464" rx="108" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="8"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2B579A"/>
      <stop offset="1" stop-color="#41A5EE"/>
    </linearGradient>
  </defs>
  ${bg}
  <path d="M180 126 H308 L356 174 V362 A24 24 0 0 1 332 386 H180 A24 24 0 0 1 156 362 V150 A24 24 0 0 1 180 126 Z" fill="#ffffff"/>
  <path d="M308 126 V150 A24 24 0 0 0 332 174 H356 Z" fill="#dbe4ee"/>
  <rect x="192" y="224" width="128" height="22" rx="11" fill="#41A5EE"/>
  <rect x="192" y="266" width="94" height="22" rx="11" fill="#7CB9F1"/>
  <rect x="192" y="308" width="112" height="22" rx="11" fill="#ffffff" fill-opacity="0.6"/>
</svg>`
}

/** Render the SVG at 4× the target size (capped at 2048), then Lanczos
 *  downscale — noticeably crisper small icons than a direct 1× render. */
async function renderPng(svg: string, size: number, file: string) {
  const hi = Math.min(size * 4, 2048)
  const hiBuf = await sharp(Buffer.from(svg), {
    density: Math.round((72 * hi) / 512),
  })
    .png()
    .toBuffer()
  await sharp(hiBuf).resize(size, size, { kernel: 'lanczos3' }).png().toFile(file)
  console.log(`  ✓ ${file} (${size}×${size})`)
}

async function main() {
  const tile = markSvg({ fullBleed: false })
  const apple = markSvg({ fullBleed: true })

  console.log('Rendering PNGs…')
  for (const size of [16, 32, 48, 192, 512]) {
    await renderPng(tile, size, `${OUT}/favicon-${size}x${size}.png`)
  }
  await renderPng(apple, 180, `${OUT}/apple-touch-icon.png`)

  console.log('Packing favicon.ico (16+32+48)…')
  execSync(
    `python3 - <<'PY'
from PIL import Image
src = Image.open('${OUT}/favicon-48x48.png').convert('RGBA')
src.save('${OUT}/favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
ico = Image.open('${OUT}/favicon.ico')
print('  ✓ favicon.ico sizes:', sorted(ico.info.get('sizes', [])))
PY`,
    { stdio: 'inherit' },
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

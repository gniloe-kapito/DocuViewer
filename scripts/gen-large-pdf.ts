/**
 * Generates the LARGE QA PDF fixture for DocuViewer into /tmp/testfiles.
 * Run: cd /home/z/my-project && bun scripts/gen-large-pdf.ts
 *
 * 300 pages (virtualization QA): every page carries the text
 * «Large QA page N», every 10th page additionally the searchable keyword
 * NEIGULA-LARGE, and the document has an outline with 8 top-level entries
 * (two of them with one child each). Built with the same raw-PDF approach
 * as buildPdf() in scripts/gen-test-files.ts (no new dependencies).
 */
import fs from 'node:fs'

const DIR = '/tmp/testfiles'
const PAGES = 300
const PAGE_W = 612
const PAGE_H = 792

function buildLargePdf(
  pagesText: string[],
  outline: Array<{
    title: string
    page: number
    children?: Array<{ title: string; page: number }>
  }>,
  pageW = PAGE_W,
  pageH = PAGE_H,
): Buffer {
  const objects: string[] = []
  const pageIds: number[] = []
  let nextId = 4
  const contents: { id: number; body: string }[] = []
  const pages: { id: number; contentId: number }[] = []
  for (const text of pagesText) {
    const contentId = nextId++
    const pageId = nextId++
    const lines = text.split('\n')
    let stream = 'BT\n'
    let y = pageH - 60
    for (const line of lines) {
      stream += `/F1 16 Tf 1 0 0 1 60 ${y} Tm (${line.replace(/([()\\])/g, '\\$1')}) Tj\n`
      y -= 28
    }
    stream += 'ET\n'
    contents.push({ id: contentId, body: stream })
    pages.push({ id: pageId, contentId })
    pageIds.push(pageId)
  }
  // ---- Outline (bookmarks): flat top-level entries + optional children ----
  const outlineId = nextId++
  const itemIds: number[] = []
  const flat: Array<{
    id: number
    title: string
    page: number
    childIds: number[]
  }> = []
  for (const top of outline) {
    const id = nextId++
    const childIds: number[] = []
    if (top.children) {
      for (const _c of top.children) childIds.push(nextId++)
    }
    itemIds.push(id)
    flat.push({ id, title: top.title, page: top.page, childIds })
  }
  objects[1] = `<< /Type /Catalog /Pages 2 0 R /Outlines ${outlineId} 0 R >>`
  objects[2] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`
  for (const c of contents)
    objects[c.id] = `<< /Length ${c.body.length} >>\nstream\n${c.body}endstream`
  for (const p of pages)
    objects[p.id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${p.contentId} 0 R >>`
  // Outlines root
  objects[outlineId] =
    `<< /Type /Outlines /First ${itemIds[0]} 0 R /Last ${itemIds[itemIds.length - 1]} 0 R /Count ${flat.length} >>`
  flat.forEach((top, i) => {
    const prev = i > 0 ? ` /Prev ${itemIds[i - 1]} 0 R` : ''
    const next = i < flat.length - 1 ? ` /Next ${itemIds[i + 1]} 0 R` : ''
    const first = top.childIds.length ? ` /First ${top.childIds[0]} 0 R` : ''
    const last = top.childIds.length
      ? ` /Last ${top.childIds[top.childIds.length - 1]} 0 R`
      : ''
    objects[top.id] =
      `<< /Title (${top.title}) /Parent ${outlineId} 0 R${prev}${next}${first}${last}` +
      ` /Dest [ ${pageIds[top.page - 1]} 0 R /XYZ 0 ${pageH} null ] /Count ${top.childIds.length} >>`
    top.childIds.forEach((cid, j) => {
      const prevC = j > 0 ? ` /Prev ${top.childIds[j - 1]} 0 R` : ''
      const nextC =
        j < top.childIds.length - 1 ? ` /Next ${top.childIds[j + 1]} 0 R` : ''
      const childPage = Math.min(top.page + 1 + j, pageIds.length)
      const destPage = pageIds[childPage - 1]
      objects[cid] =
        `<< /Title (${outline[i].children?.[j]?.title ?? 'Child'}) /Parent ${top.id} 0 R${prevC}${nextC}` +
        ` /Dest [ ${destPage} 0 R /XYZ 0 ${pageH} null ] >>`
    })
  })

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let i = 1; i < objects.length; i++) {
    if (!objects[i]) continue
    offsets[i] = out.length
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefPos = out.length
  const maxId = objects.length - 1
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= maxId; i++) {
    if (offsets[i] === undefined) xref += `0000000000 65535 f \n`
    else xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  out += `${xref}trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/* Page texts: «Large QA page N» + the searchable keyword every 10th page. */
const pagesText: string[] = []
for (let i = 1; i <= PAGES; i++) {
  let text = `Large QA page ${i}`
  if (i % 10 === 0) text += `\nKeyword: NEIGULA-LARGE ${i}`
  pagesText.push(text)
}

/* Outline: 8 top-level entries spread over the document (two with children). */
const outline: Array<{
  title: string
  page: number
  children?: Array<{ title: string; page: number }>
}> = [
  {
    title: 'Chapter 1. Introduction',
    page: 1,
    children: [{ title: 'First keyword page', page: 10 }],
  },
  { title: 'Chapter 2. Bulk', page: 40 },
  { title: 'Chapter 3. Middle', page: 80 },
  {
    title: 'Chapter 4. Halfway',
    page: 150,
    children: [{ title: 'Page 150 area', page: 150 }],
  },
  { title: 'Chapter 5. Further', page: 200 },
  { title: 'Chapter 6. Nearly there', page: 240 },
  { title: 'Chapter 7. Tail', page: 280 },
  { title: 'Chapter 8. Final', page: 300 },
]

fs.mkdirSync(DIR, { recursive: true })
const buf = buildLargePdf(pagesText, outline)
fs.writeFileSync(`${DIR}/large.pdf`, buf)
console.log(
  `Generated: ${DIR}/large.pdf (${buf.length} bytes, ${PAGES} pages, 8+2 outline entries)`,
)

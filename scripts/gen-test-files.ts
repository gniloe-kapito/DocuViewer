/**
 * Generates QA test files for DocuViewer into /tmp/testfiles.
 * Run: cd /home/z/my-project && bun scripts/gen-test-files.ts
 */
import fs from 'node:fs'
import zlib from 'node:zlib'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'

const DIR = '/tmp/testfiles'
fs.mkdirSync(DIR, { recursive: true })

/* ---------------- PNG ---------------- */
function crc32(buf: Buffer): number {
  let c: number
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

function makePng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const rowLen = w * 3 + 1
  const raw = Buffer.alloc(rowLen * h)
  for (let y = 0; y < h; y++) {
    raw[y * rowLen] = 0
    for (let x = 0; x < w; x++) {
      const o = y * rowLen + 1 + x * 3
      raw[o] = Math.min(255, rgb[0] + Math.floor((y / h) * 60))
      raw[o + 1] = Math.min(255, rgb[1] + Math.floor((x / w) * 60))
      raw[o + 2] = rgb[2]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
fs.writeFileSync(`${DIR}/test.png`, makePng(320, 200, [16, 120, 87]))

/* ---------------- TXT (long, for search/paging) ---------------- */
const txtLines: string[] = []
txtLines.push('DocuViewer QA текстовый файл')
txtLines.push('')
txtLines.push('Строка с ключевым словом НЕИГУЛА для поиска: НЕИГУЛА-01')
for (let i = 1; i <= 120; i++) {
  txtLines.push(`Строка номер ${i}: быстрый бурый лис перепрыгивает ленивую собаку.`)
  if (i % 40 === 0) txtLines.push(`Маркер НЕИГУЛА-${String(i / 40).padStart(2, '0')} в тексте`)
}
txtLines.push('')
txtLines.push('THE QUICK BROWN FOX jumps over the lazy dog.')
fs.writeFileSync(`${DIR}/test.txt`, txtLines.join('\n'), 'utf8')

/* ---------------- JSON ---------------- */
fs.writeFileSync(
  `${DIR}/test.json`,
  JSON.stringify(
    {
      name: 'DocuViewer QA',
      version: 3,
      tags: ['pdf', 'docx', 'xlsx'],
      active: true,
      nested: { pages: 2, formats: ['pdf', 'docx', 'xlsx', 'pptx'] },
      numbers: [1, 2, 3, 4.5, 100.25],
    },
    null,
    2,
  ),
  'utf8',
)

/* ---------------- MD ---------------- */
fs.writeFileSync(
  `${DIR}/test.md`,
  [
    '# DocuViewer QA Markdown',
    '',
    'Тестовый **markdown** документ со *курсивом* и `кодом`.',
    '',
    '## Секция 2',
    '',
    '- пункт один',
    '- пункт два',
    '',
    '```js',
    'const x = 42',
    '```',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
  ].join('\n'),
  'utf8',
)

/* ---------------- RTF ---------------- */
fs.writeFileSync(
  `${DIR}/test.rtf`,
  '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\fs32 DocuViewer QA RTF\\par\\fs24 Вторая строка с русским текстом\\par}',
  'latin1',
)

/* ---------------- PDF (5 pages + outline, raw) ---------------- */
function buildPdf(pagesText: string[], pageW = 612, pageH = 792): Buffer {
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
  // ---- Outline (bookmarks): top-level + nested, destinations on pages ----
  const outlineId = nextId++
  const outlines: Array<{ title: string; page: number; children?: Array<{ title: string; page: number }> }> = [
    { title: 'Section One', page: 1, children: [{ title: 'Sample text', page: 2 }] },
    { title: 'Keyword section', page: 3 },
    { title: 'Dots', page: 4, children: [{ title: 'Last dot page', page: 5 }] },
  ]
  const itemIds: number[] = []
  const flat: Array<{ id: number; title: string; page: number; childIds: number[] }> = []
  for (const top of outlines) {
    const id = nextId++
    const childIds: number[] = []
    if (top.children) {
      for (const c of top.children) childIds.push(nextId++)
    }
    itemIds.push(id)
    flat.push({ id, title: top.title, page: top.page, childIds })
  }
  objects[1] = `<< /Type /Catalog /Pages 2 0 R /Outlines ${outlineId} 0 R >>`
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`
  for (const c of contents) objects[c.id] = `<< /Length ${c.body.length} >>\nstream\n${c.body}endstream`
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
    const last = top.childIds.length ? ` /Last ${top.childIds[top.childIds.length - 1]} 0 R` : ''
    objects[top.id] =
      `<< /Title (${top.title}) /Parent ${outlineId} 0 R${prev}${next}${first}${last}` +
      ` /Dest [ ${pageIds[top.page - 1]} 0 R /XYZ 0 ${pageH} null ] /Count ${top.childIds.length} >>`
    top.childIds.forEach((cid, j) => {
      const prevC = j > 0 ? ` /Prev ${top.childIds[j - 1]} 0 R` : ''
      const nextC = j < top.childIds.length - 1 ? ` /Next ${top.childIds[j + 1]} 0 R` : ''
      const childPage = top.page + 1 + j // children point at later pages (approximation)
      const destPage = pageIds[Math.min(childPage, pageIds.length) - 1]
      objects[cid] =
        `<< /Title (${outlines[i].children?.[j]?.title ?? 'Child'}) /Parent ${top.id} 0 R${prevC}${nextC}` +
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
fs.writeFileSync(
  `${DIR}/test.pdf`,
  buildPdf([
    'DocuViewer QA Test - Page One',
    'This page contains sample text.',
    'Keyword: NEIGULA-PDF-1',
    '...',
    '...',
  ]),
)

/* ---------------- DOCX (2 pages) ---------------- */
function xmlEsc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
const docxZip = new JSZip()
docxZip.file(
  '[Content_Types].xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
)
docxZip.file(
  '_rels/.rels',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
)
docxZip.file(
  'word/_rels/document.xml.rels',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`,
)
const p = (text: string, opts: { bold?: boolean; size?: number } = {}) => {
  const rpr = `${opts.bold ? '<w:b/>' : ''}${opts.size ? `<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>` : ''}`
  return `<w:p><w:pPr><w:spacing w:after="200"/></w:pPr><w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r></w:p>`
}
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
docxZip.file(
  'word/document.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${p('DocuViewer QA Document', { bold: true, size: 36 })}
${p('Keyword NEIGULA-DOCX for search tests.')}
${p('Paragraph with enough text to make the page look realistic. The quick brown fox jumps over the lazy dog.')}
${p('Another paragraph on page one.')}
${pageBreak}
${p('Page Two Heading', { bold: true, size: 36 })}
${p('Second page content. The quick brown fox jumps again.')}
${p('Final paragraph.')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body>
</w:document>`,
)
const docxBuf = await docxZip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
})
fs.writeFileSync(`${DIR}/test.docx`, docxBuf)

/* ---------------- XLSX (2 sheets) ---------------- */
const wb = XLSX.utils.book_new()
const ws1 = XLSX.utils.aoa_to_sheet([
  ['Отчёт QA'],
  ['Имя', 'Значение', 'Комментарий'],
  ['alpha', 10, 'первая'],
  ['beta', 20.5, 'вторая'],
  ['gamma', 300, 'третья'],
  ['delta', 42, 'NEIGULA-XLSX'],
])
ws1['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 18 }]
XLSX.utils.book_append_sheet(wb, ws1, 'Sheet1')
const ws2 = XLSX.utils.aoa_to_sheet([
  ['Второй лист'],
  ['x', 'y'],
  [1, 2],
  [3, 4],
])
XLSX.utils.book_append_sheet(wb, ws2, 'Sheet2')
const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
fs.writeFileSync(`${DIR}/test.xlsx`, xlsxBuf)

/* ---------------- PPTX (2 slides) ---------------- */
const pptxZip = new JSZip()
const CT = (exts: string, overrides: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${exts}
${overrides}
</Types>`
pptxZip.file(
  '[Content_Types].xml',
  CT(
    '<Default Extension="png" ContentType="image/png"/>',
    [
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
      '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>',
      '<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>',
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    ].join('\n'),
  ),
)
pptxZip.file(
  '_rels/.rels',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
)
pptxZip.file(
  'ppt/presentation.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/>
<p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`,
)
pptxZip.file(
  'ppt/_rels/presentation.xml.rels',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`,
)
const slide = (title: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld>
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr/>
<p:sp>
<p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="4400" b="1"/><a:t>${xmlEsc(title)}</a:t></a:r></a:p></p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="3651250"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2400"/><a:t>${xmlEsc(body)}</a:t></a:r></a:p></p:txBody>
</p:sp>
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>
</p:sld>`
pptxZip.file('ppt/slides/slide1.xml', slide('DocuViewer QA Slide 1', 'First slide body text NEIGULA-PPTX'))
pptxZip.file('ppt/slides/slide2.xml', slide('Slide 2 Title', 'Second slide body text with more words'))
pptxZip.file(
  'ppt/slides/_rels/slide1.xml.rels',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`,
)
pptxZip.file(
  'ppt/slides/_rels/slide2.xml.rels',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`,
)
pptxZip.file(
  'ppt/slideLayouts/slideLayout1.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`,
)
pptxZip.file(
  'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`,
)
pptxZip.file(
  'ppt/slideMasters/slideMaster1.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`,
)
pptxZip.file(
  'ppt/slideMasters/_rels/slideMaster1.xml.rels',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`,
)
pptxZip.file(
  'ppt/theme/theme1.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="QA">
<a:themeElements>
<a:clrScheme name="QA"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="444444"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="107C41"/></a:accent1><a:accent2><a:srgbClr val="C55A11"/></a:accent2><a:accent3><a:srgbClr val="2E75B6"/></a:accent3><a:accent4><a:srgbClr val="DD8A1E"/></a:accent4><a:accent5><a:srgbClr val="70484F"/></a:accent5><a:accent6><a:srgbClr val="96741D"/></a:accent6><a:hlink><a:srgbClr val="2E75B6"/></a:hlink><a:folHlink><a:srgbClr val="96741D"/></a:folHlink></a:clrScheme>
<a:fontScheme name="QA"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="QA">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>`,
)
const pptxBuf = await pptxZip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
})
fs.writeFileSync(`${DIR}/test.pptx`, pptxBuf)

console.log(
  'Generated:',
  fs
    .readdirSync(DIR)
    .map((f) => `${f} (${fs.statSync(`${DIR}/${f}`).size} bytes)`)
    .join(', '),
)

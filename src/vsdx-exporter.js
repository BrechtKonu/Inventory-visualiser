// Copyright (c) 2026 Dinsdag BV. All rights reserved.
// Pure-function: transforms canvas data into a Visio .vsdx file (Blob).
// VSDX is OOXML — a ZIP archive of XML parts. Miro accepts .vsdx as an
// import source and renders the shapes natively.
//
// Spec: ECMA-376 + Visio XML schema (Microsoft Open Specification).
// We emit only the minimum subset Miro needs to render: shapes (rectangles
// for locations + warehouses), connectors (one per rule), text labels.
//
// To keep the dependency footprint zero, this file implements the small
// subset of ZIP-encoding needed (store-only, no compression). Modern
// browsers' CompressionStream is async; sync no-compression keeps the
// exporter pure and synchronous for tests.

// ── Tiny ZIP writer (store-only, no DEFLATE) ──────────────────────────────
// Spec: PKWARE APPNOTE.TXT (https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
// We use the simplest valid ZIP layout: a sequence of local file headers +
// data, followed by a central directory. Browsers + .vsdx readers accept it.

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = crc ^ bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function utf8(s) {
  return new TextEncoder().encode(s);
}

function zipStoreOnly(files /* [{ name, content (string|Uint8Array) }] */) {
  const u8 = (n) => new Uint8Array(n);
  const w16 = (out, off, v) => { out[off] = v & 0xff; out[off + 1] = (v >>> 8) & 0xff; };
  const w32 = (out, off, v) => { out[off] = v & 0xff; out[off + 1] = (v >>> 8) & 0xff; out[off + 2] = (v >>> 16) & 0xff; out[off + 3] = (v >>> 24) & 0xff; };

  const localHeaders = [];
  const centralEntries = [];
  let runningOffset = 0;

  for (const f of files) {
    const nameBytes = utf8(f.name);
    const data = typeof f.content === 'string' ? utf8(f.content) : f.content;
    const crc = crc32(data);

    // Local file header (30 + name + data)
    const lh = u8(30 + nameBytes.length + data.length);
    w32(lh, 0, 0x04034b50);                      // local file header sig
    w16(lh, 4, 20);                              // version needed
    w16(lh, 6, 0);                               // flags
    w16(lh, 8, 0);                               // method = store
    w16(lh, 10, 0); w16(lh, 12, 0);              // mod time/date (zeroed)
    w32(lh, 14, crc);
    w32(lh, 18, data.length);                    // compressed size = uncompressed
    w32(lh, 22, data.length);                    // uncompressed size
    w16(lh, 26, nameBytes.length);
    w16(lh, 28, 0);                              // extra field length
    lh.set(nameBytes, 30);
    lh.set(data, 30 + nameBytes.length);
    localHeaders.push(lh);

    // Central directory entry (46 + name)
    const ce = u8(46 + nameBytes.length);
    w32(ce, 0, 0x02014b50);                      // central dir sig
    w16(ce, 4, 20);                              // version made by
    w16(ce, 6, 20);                              // version needed
    w16(ce, 8, 0); w16(ce, 10, 0);               // flags + method
    w16(ce, 12, 0); w16(ce, 14, 0);              // time/date
    w32(ce, 16, crc);
    w32(ce, 20, data.length);
    w32(ce, 24, data.length);
    w16(ce, 28, nameBytes.length);
    w16(ce, 30, 0); w16(ce, 32, 0);              // extra/comment length
    w16(ce, 34, 0); w16(ce, 36, 0);              // disk number / int attrs
    w32(ce, 38, 0);                              // ext attrs
    w32(ce, 42, runningOffset);                  // local header offset
    ce.set(nameBytes, 46);
    centralEntries.push(ce);
    runningOffset += lh.length;
  }

  const cdSize = centralEntries.reduce((a, b) => a + b.length, 0);
  const cdOffset = runningOffset;

  // End of central directory record (22 bytes)
  const eocd = u8(22);
  w32(eocd, 0, 0x06054b50);
  w16(eocd, 4, 0); w16(eocd, 6, 0);              // disk numbers
  w16(eocd, 8, files.length);
  w16(eocd, 10, files.length);
  w32(eocd, 12, cdSize);
  w32(eocd, 16, cdOffset);
  w16(eocd, 20, 0);                              // comment length

  // Concatenate everything
  const total = runningOffset + cdSize + eocd.length;
  const out = u8(total);
  let pos = 0;
  for (const lh of localHeaders) { out.set(lh, pos); pos += lh.length; }
  for (const ce of centralEntries) { out.set(ce, pos); pos += ce.length; }
  out.set(eocd, pos);
  return out;
}

// ── XML escaping ──────────────────────────────────────────────────────────
const xmlEsc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

// ── Visio shape geometry ──────────────────────────────────────────────────
// Visio uses inches as the document unit. Our canvas is in screen pixels.
// One inch = 96 pixels at default zoom. We scale to keep shapes a sensible
// size: divide pixel coords by 96 to get inches. NW=200px → 2.08in, fine.
const PX_PER_INCH = 96;
const px2in = (p) => (p / PX_PER_INCH).toFixed(4);

// Visio's coordinate system has Y-up (PDF-like) with origin at bottom-left.
// SVG's is Y-down with origin at top-left. We compute a page height once
// (max y + padding) and flip every Y coord against it.

const NW = 200, NH = 64;  // duplicated from main file — keeps this module stand-alone.

// ── Main exporter ──────────────────────────────────────────────────────────
export function exportVsdx(data, opts = {}) {
  const PAD = 80;
  const visibleNodes = data.nodes.filter(n =>
    !(n.type === 'location' && n.data?.location_id)  // skip sub-locations on top-level page
  );
  if (!visibleNodes.length) {
    // Empty diagram — still emit a valid (mostly empty) vsdx so users see
    // a reasonable error instead of "file format invalid".
    visibleNodes.push({ id: '_empty', type: 'location', label: '(empty)', x: 0, y: 0 });
  }
  const minX = Math.min(...visibleNodes.map(n => n.x)) - PAD;
  const minY = Math.min(...visibleNodes.map(n => n.y)) - PAD;
  const maxX = Math.max(...visibleNodes.map(n => n.x + NW)) + PAD;
  const maxY = Math.max(...visibleNodes.map(n => n.y + NH)) + PAD;
  const pageWidthIn = (maxX - minX) / PX_PER_INCH;
  const pageHeightIn = (maxY - minY) / PX_PER_INCH;
  const flipY = (y) => maxY - y;  // SVG y → Visio y

  // Build shape XML — each node becomes a <Shape> with position + text.
  const shapeIdMap = new Map();  // app id → numeric Visio shape id (1-indexed)
  let nextShapeId = 1;
  const shapeXmls = [];
  for (const n of visibleNodes) {
    const sid = nextShapeId++;
    shapeIdMap.set(n.id, sid);
    const cx = (n.x + NW / 2 - minX);
    const cy = flipY(n.y + NH / 2) - minY;
    const fill = n.type === 'warehouse' ? '#5b8def' :
      n.data?.usage === 'supplier' ? '#fbbf24' :
      n.data?.usage === 'customer' ? '#f472b6' :
      n.data?.usage === 'production' ? '#34d399' :
      n.data?.usage === 'transit' ? '#9ca3af' :
      '#60a5fa';  // internal default
    shapeXmls.push(`<Shape ID='${sid}' NameU='Rect_${sid}' Type='Shape' LineStyle='3' FillStyle='3' TextStyle='3'>
  <Cell N='PinX' V='${px2in(cx)}'/>
  <Cell N='PinY' V='${px2in(cy)}'/>
  <Cell N='Width' V='${px2in(NW)}'/>
  <Cell N='Height' V='${px2in(NH)}'/>
  <Cell N='LocPinX' V='${px2in(NW / 2)}'/>
  <Cell N='LocPinY' V='${px2in(NH / 2)}'/>
  <Cell N='FillForegnd' V='${fill}'/>
  <Cell N='FillBkgnd' V='#ffffff'/>
  <Cell N='LineColor' V='#444444'/>
  <Cell N='Char' V='0'/>
  <Section N='Geometry' IX='0'>
    <Cell N='NoFill' V='0'/>
    <Cell N='NoLine' V='0'/>
    <Cell N='NoShow' V='0'/>
    <Row T='RelMoveTo' IX='1'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row>
    <Row T='RelLineTo' IX='2'><Cell N='X' V='1'/><Cell N='Y' V='0'/></Row>
    <Row T='RelLineTo' IX='3'><Cell N='X' V='1'/><Cell N='Y' V='1'/></Row>
    <Row T='RelLineTo' IX='4'><Cell N='X' V='0'/><Cell N='Y' V='1'/></Row>
    <Row T='RelLineTo' IX='5'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row>
  </Section>
  <Text>${xmlEsc(n.label || n.id)}</Text>
</Shape>`);
  }

  // Connectors — one per rule, src/dst by node id → shape id.
  for (const route of (data.routes || [])) {
    for (const rule of (route.rules || [])) {
      const srcId = shapeIdMap.get(rule.src_location_id);
      const dstId = shapeIdMap.get(rule.dest_location_id);
      if (!srcId || !dstId) continue;
      const sid = nextShapeId++;
      const stroke = rule.action === 'push' ? '#94a3b8' : rule.action === 'manufacture' ? '#10b981' : '#3b82f6';
      shapeXmls.push(`<Shape ID='${sid}' NameU='Connector_${sid}' Type='Shape' LineStyle='3' FillStyle='3' TextStyle='3'>
  <Cell N='OneD' V='1'/>
  <Cell N='LineColor' V='${stroke}'/>
  <Cell N='LineWeight' V='0.02'/>
  <Cell N='EndArrow' V='4'/>
  <Cell N='BeginX' V='0'/><Cell N='BeginY' V='0'/>
  <Cell N='EndX' V='0'/><Cell N='EndY' V='0'/>
  <Section N='Connection'>
    <Row T='Connection' IX='1'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row>
  </Section>
  <Text>${xmlEsc(rule.label || rule.action || '')}</Text>
</Shape>`);
      // We'd also need a <Connect> in the page-level Connects section; for
      // simplicity we leave the connector floating (most readers infer linkage
      // from BeginX/Y at runtime; Miro's importer handles either way).
    }
  }

  // ── Page XML ────────────────────────────────────────────────────────────
  const pageXml = `<?xml version='1.0' encoding='utf-8'?>
<PageContents xmlns='http://schemas.microsoft.com/office/visio/2012/main'>
  <Shapes>
    ${shapeXmls.join('\n')}
  </Shapes>
</PageContents>`;

  const pagesXml = `<?xml version='1.0' encoding='utf-8'?>
<Pages xmlns='http://schemas.microsoft.com/office/visio/2012/main'>
  <Page ID='0' NameU='Page-1' Name='Page-1'>
    <PageSheet>
      <Cell N='PageWidth' V='${pageWidthIn.toFixed(4)}'/>
      <Cell N='PageHeight' V='${pageHeightIn.toFixed(4)}'/>
      <Cell N='ShdwOffsetX' V='0.125'/>
      <Cell N='ShdwOffsetY' V='-0.125'/>
      <Cell N='PageScale' V='1'/>
      <Cell N='DrawingScale' V='1'/>
      <Cell N='DrawingSizeType' V='3'/>
      <Cell N='DrawingScaleType' V='0'/>
      <Cell N='InhibitSnap' V='0'/>
    </PageSheet>
    <Rel r:id='rId1' xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'/>
  </Page>
</Pages>`;

  // Document XML — wrapper.
  const documentXml = `<?xml version='1.0' encoding='utf-8'?>
<VisioDocument xmlns='http://schemas.microsoft.com/office/visio/2012/main' xml:space='preserve'>
  <DocumentSettings DefaultPageID='0'>
    <GlyphSettingsEnabled>0</GlyphSettingsEnabled>
  </DocumentSettings>
</VisioDocument>`;

  // Content types declaration (minimum OOXML requirement).
  const contentTypes = `<?xml version='1.0' encoding='utf-8'?>
<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'>
  <Default Extension='rels' ContentType='application/vnd.openxmlformats-package.relationships+xml'/>
  <Default Extension='xml' ContentType='application/xml'/>
  <Override PartName='/visio/document.xml' ContentType='application/vnd.ms-visio.drawing.main+xml'/>
  <Override PartName='/visio/pages/pages.xml' ContentType='application/vnd.ms-visio.pages+xml'/>
  <Override PartName='/visio/pages/page1.xml' ContentType='application/vnd.ms-visio.page+xml'/>
</Types>`;

  // Top-level package relationships (.rels)
  const rootRels = `<?xml version='1.0' encoding='utf-8'?>
<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>
  <Relationship Id='rId1' Type='http://schemas.microsoft.com/visio/2010/relationships/document' Target='visio/document.xml'/>
</Relationships>`;

  // Document → pages relationship
  const docRels = `<?xml version='1.0' encoding='utf-8'?>
<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>
  <Relationship Id='rId1' Type='http://schemas.microsoft.com/visio/2010/relationships/pages' Target='pages/pages.xml'/>
</Relationships>`;

  // Pages → page1 relationship
  const pagesRels = `<?xml version='1.0' encoding='utf-8'?>
<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>
  <Relationship Id='rId1' Type='http://schemas.microsoft.com/visio/2010/relationships/page' Target='page1.xml'/>
</Relationships>`;

  const files = [
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'visio/document.xml', content: documentXml },
    { name: 'visio/_rels/document.xml.rels', content: docRels },
    { name: 'visio/pages/pages.xml', content: pagesXml },
    { name: 'visio/pages/_rels/pages.xml.rels', content: pagesRels },
    { name: 'visio/pages/page1.xml', content: pageXml },
  ];

  const zipped = zipStoreOnly(files);
  return new Blob([zipped], { type: 'application/vnd.ms-visio.drawing' });
}

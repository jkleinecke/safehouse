/**
 * A book-shaped PDF, built from nothing, for the reader spec (FR11.3).
 *
 * The table's real library is 17 copyrighted PDFs that must never enter git
 * (G6/§14), and the E2E harness deliberately unsets `SAFEHOUSE_BOOKS_DIR` so a
 * run never touches 300 MB of them. But `reader.spec.ts` has to prove three
 * things that only a real file can prove: that pdf.js opens the book, that it
 * renders the *right* page, and that it pulls that page over byte ranges
 * instead of downloading the volume.
 *
 * So the fixture manufactures one. Every byte here is ours:
 *
 *  - **It is big.** Each page carries a large unreferenced filler object, so
 *    the file is megabytes while the bytes a single page actually needs are
 *    kilobytes. That gap is the whole point — a range-honouring reader pulls a
 *    tiny fraction, and a reader that quietly downloads the file cannot hide it.
 *  - **Every page is a different colour**, derived from its 1-based index in
 *    the file. The spec samples the rendered canvas and compares the pixel to
 *    the colour of the page it *asked* for, which is the only assertion that
 *    distinguishes "a page rendered" from "page 431 rendered". A page number
 *    printed in the toolbar cannot do that; a canvas that drew the wrong sheet
 *    looks identical.
 *  - **It is a plain classic-xref PDF** — no compression, no object streams, no
 *    linearization. pdf.js reads the tail for `startxref`, the xref table, the
 *    catalog and page tree, then the one page it was asked for.
 *
 * Pure: no I/O, no dependencies. The caller writes it wherever it likes.
 */

/** US Letter, in PDF points. */
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The colour of the k-th page **of the file** (1-based, so it is PDF-page
 * numbering, not printed numbering — the offset arithmetic is what the spec is
 * checking and the fixture must not quietly share its answer).
 *
 * The multipliers are coprime-ish with 256 so neighbouring pages are far apart
 * in all three channels: rendering page 430 instead of 431 has to be a loud
 * failure, not a near-miss inside a tolerance.
 */
export function pageColor(pdfPage: number): Rgb {
  const k = Math.max(1, Math.round(pdfPage));
  return { r: (k * 53) % 256, g: (k * 97) % 256, b: (k * 151) % 256 };
}

function channel(v: number): string {
  return (v / 255).toFixed(6);
}

export interface TestPdfOptions {
  /** Pages in the file. The reader spec needs ≥ printed page + offset. */
  pages: number;
  /**
   * Roughly how big the finished file should be. Everything above what the
   * pages actually need is one unreferenced ballast object at the end.
   */
  targetBytes?: number;
  /**
   * Extra lines of text on given PDF pages (1-based), one `BT … Tj ET` block
   * per line so pdf.js hands them back as separate lines — the way a gear
   * table comes out of a real book, which is what the catalogue reads.
   */
  text?: Record<number, readonly string[]>;
}

/** A line as a PDF literal: dashes plain, the yen sign in Latin-1, parentheses escaped. */
function pdfString(line: string): string {
  return line
    .replace(/[—–]/g, '-')
    .replace(/[^\x20-\xff]/g, '')
    .replace(/([\\()])/g, '\\$1')
    // Last, so the escape's own backslash is not escaped in turn.
    .replace(/¥/g, '\\245');
}

/**
 * Build the whole file.
 *
 * ## Layout, and why it is this way
 *
 *   1              catalog
 *   2              page tree (a flat /Kids of every page)
 *   3              the one font
 *   3+k            page k's dict           ← all N of them, contiguous
 *   3+N+k          page k's content stream ← all N of them, contiguous
 *   4+2N           ballast (referenced by nothing)
 *   xref, trailer
 *
 * The clustering is load-bearing and was measured, not guessed. The first
 * version of this fixture put each page's ballast immediately after that page,
 * and pdf.js pulled **100 % of the file** to open it: resolving the page tree
 * walks every kid's dict, and with the dicts scattered across 5 MB "every kid"
 * means every byte. Grouped, the whole page tree is a couple of 64 KB windows
 * and one page costs about 6 % of the file — which is the behaviour FR11.3 is
 * actually claiming, and the reason the spec can assert a fraction at all.
 */
export function buildTestPdf(opts: TestPdfOptions): Buffer {
  const pages = Math.max(1, Math.round(opts.pages));
  const target = Math.max(0, Math.round(opts.targetBytes ?? 6_000_000));

  const chunks: Buffer[] = [];
  let length = 0;
  /** Byte offset of object n, indexed by object number. */
  const offsets: number[] = [];

  const push = (text: string | Buffer): void => {
    const buf = typeof text === 'string' ? Buffer.from(text, 'latin1') : text;
    chunks.push(buf);
    length += buf.byteLength;
  };
  const object = (num: number, body: string): void => {
    offsets[num] = length;
    push(`${num} 0 obj\n${body}\nendobj\n`);
  };
  const streamObject = (num: number, payload: Buffer): void => {
    offsets[num] = length;
    push(`${num} 0 obj\n<< /Length ${payload.byteLength} >>\nstream\n`);
    push(payload);
    push('endstream\nendobj\n');
  };

  // A binary comment on line 2 is the conventional "this file is not text"
  // marker; pdf.js does not need it, but every real book has one.
  push('%PDF-1.7\n');
  push(Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const pageObj = (k: number) => 3 + k;
  const contentObj = (k: number) => 3 + pages + k;
  const ballastObj = 4 + 2 * pages;

  const kids = Array.from({ length: pages }, (_, i) => `${pageObj(i + 1)} 0 R`).join(' ');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages} /Kids [ ${kids} ] >>`);
  object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  for (let k = 1; k <= pages; k += 1) {
    object(
      pageObj(k),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj(k)} 0 R >>`,
    );
  }

  for (let k = 1; k <= pages; k += 1) {
    const { r, g, b } = pageColor(k);
    // A flat fill over the whole media box, then a legible page number so a
    // failure screenshot says which sheet was drawn without decoding pixels.
    streamObject(
      contentObj(k),
      Buffer.from(
        `${channel(r)} ${channel(g)} ${channel(b)} rg\n` +
          `0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT} re f\n` +
          '0 0 0 rg\nBT /F1 44 Tf 54 96 Td (Safehouse E2E book) Tj ET\n' +
          `BT /F1 96 Tf 54 ${PAGE_HEIGHT - 220} Td (pdf page ${k}) Tj ET\n` +
          (opts.text?.[k] ?? [])
            .map((line, i) => `BT /F1 11 Tf 54 ${PAGE_HEIGHT - 300 - i * 16} Td (${pdfString(line)}) Tj ET\n`)
            .join(''),
        'latin1',
      ),
    );
  }

  // Ballast: the bytes that make this a book rather than a leaflet. Nothing
  // references it, so a reader that honours ranges never asks for any of it —
  // and a reader that downloads the file pays for all of it.
  const overhead = 120 + 20 * (2 * pages + 5); // trailer + xref, approximately
  streamObject(ballastObj, Buffer.alloc(Math.max(0, target - length - overhead), 0x20));

  const size = ballastObj + 1; // objects 1..4+2N, plus the free entry 0
  const startxref = length;
  push('xref\n');
  push(`0 ${size}\n`);
  push('0000000000 65535 f \n');
  for (let n = 1; n < size; n += 1) {
    const at = offsets[n];
    // Every slot is written; an object we somehow skipped becomes a free entry
    // rather than a lie about where it lives.
    push(at === undefined ? '0000000000 65535 f \n' : `${String(at).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);

  return Buffer.concat(chunks, length);
}

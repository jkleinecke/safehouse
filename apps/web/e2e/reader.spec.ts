/**
 * FR11.3 — one tap opens the printed page, **on a phone**, without downloading
 * the book.
 *
 * This is the clause BUILD_REPORT §6 item 5 called "a desktop-only promise".
 * The server half was always right: `/read/:code?p=` resolved the offset and
 * `/files/books/:code` streamed byte ranges behind auth. The viewer was the
 * browser's own PDF plugin in an `<iframe>` with a `#page=` fragment — and
 * mobile browsers ignore that fragment, so a player tapping `SR5 p.426` at the
 * table got page 1 of a 44 MB book and a progress bar.
 *
 * Four things have to be true at once, and only a browser can hold all four:
 *
 *  1. **the in-app viewer, not the native one** — `data-reader-mode` is the
 *     reader's own statement of which one it started, and pdf.js falling back
 *     to the native viewer is a *silent* degradation by design (`mode.ts`), so
 *     a spec that only looked for "a book on screen" would pass on the bug;
 *  2. **the right page** — asserted against pixels, not against the toolbar.
 *     Every page of the fixture book is a different colour (`fixtures/pdf.ts`),
 *     so rendering page 430 instead of 431 is a failure rather than a
 *     near-miss. A page number printed under a canvas showing the wrong sheet
 *     looks exactly like a page number printed under the right one;
 *  3. **ranges, not the file** — every request for the book carries `Range:`
 *     and every answer is a 206, and the bytes that crossed the wire are a
 *     small fraction of the bytes on disk. A single 200 fails it;
 *  4. **the controls a thumb reaches** — the printed-page jump box and pinch,
 *     driven as real touch events through CDP, because a phone is the device
 *     Principle 7 writes this view for.
 *
 * The book is manufactured (never CGL content, G6) but registered through the
 * real `seed:books` path, so its code and `+5` offset are the seeder's guess
 * for the core rulebook rather than numbers the fixture asserted into being.
 */
import type { CDPSession, Page, Response } from '@playwright/test';
import { expect, joinWithCode, test } from './fixtures/test';
import { pageColor, type Rgb } from './fixtures/pdf';
import { REF_PROSE, type World } from './fixtures/world';

/** The device the FR is written for (Principle 7): a phone, with fingers. */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const SURFACE = '[data-testid="pdf-surface"]';
const CANVAS = `${SURFACE} canvas`;

// ---------------------------------------------------------------------------

interface BookHit {
  status: number;
  range: string | null;
  bytes: number;
}

/**
 * Watch every answer the book endpoint gives this page.
 *
 * `content-length` rather than the body: the point is how many bytes the
 * server was asked to send, and reading 5 MB of PDF into the test process to
 * count it would be its own kind of download.
 */
function watchBook(page: Page, code: string): BookHit[] {
  const hits: BookHit[] = [];
  const path = `/files/books/${code}`;
  page.on('response', (res: Response) => {
    if (!res.url().includes(path)) return;
    const length = Number(res.headers()['content-length'] ?? '0');
    hits.push({
      status: res.status(),
      range: res.request().headers()['range'] ?? null,
      bytes: Number.isFinite(length) ? length : 0,
    });
  });
  return hits;
}

/** Open the codex page that carries the chip, then tap the chip (FR11.4). */
async function openChip(page: Page, world: World): Promise<void> {
  await joinWithCode(page, world.codes.player);
  await page.goto(`/c/${world.campaignId}/codex/${world.book.refPageId}`);
  // The chip in the PROSE, not the one the sidebar renders from the page's
  // structured refs — FR11.4 is specifically about `SR5 p.426` written inside a
  // sentence becoming tappable.
  const chip = page
    .getByRole('paragraph')
    .filter({ hasText: REF_PROSE })
    .getByRole('button', { name: `${world.book.code} p.${world.book.printedPage}` });
  await expect(chip, 'the codex prose did not autolink the ref into a chip (FR11.4)').toBeVisible();
  await chip.click();
}

/** The centre pixel of the rendered page, or null before anything is drawn. */
async function centrePixel(page: Page): Promise<Rgb | null> {
  return page.evaluate((selector) => {
    const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
    if (!canvas || canvas.width < 8 || canvas.height < 8) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const d = ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data;
    return { r: d[0] as number, g: d[1] as number, b: d[2] as number };
  }, CANVAS);
}

/** How far the drawn pixel is from the colour page `pdfPage` should be. */
async function pageMiss(page: Page, pdfPage: number): Promise<number> {
  const got = await centrePixel(page);
  if (!got) return 1_000;
  const want = pageColor(pdfPage);
  return Math.max(Math.abs(got.r - want.r), Math.abs(got.g - want.g), Math.abs(got.b - want.b));
}

/**
 * Wait until the canvas is showing the page we asked for.
 *
 * A tolerance of ±3 per channel absorbs the round trip through PDF's 0–1
 * colour space and the canvas's own 8-bit quantisation. It is nowhere near the
 * distance between two neighbouring pages of the fixture, which is the only
 * confusion that would matter — `pageColor` is built so consecutive pages are
 * far apart in every channel.
 */
async function expectPageRendered(page: Page, pdfPage: number): Promise<void> {
  const want = pageColor(pdfPage);
  await expect
    .poll(() => pageMiss(page, pdfPage), {
      timeout: 30_000,
      message:
        `the canvas is not showing pdf page ${pdfPage} ` +
        `(it should be rgb ${want.r},${want.g},${want.b})`,
    })
    .toBeLessThanOrEqual(3);
}

/** The percentage the zoom chip is showing. */
async function zoomPercent(page: Page): Promise<number> {
  const text = await page.getByRole('button', { name: 'Fit page width' }).innerText();
  return Number.parseInt(text.replace('%', ''), 10);
}

async function pinchOut(page: Page, cdp: CDPSession): Promise<void> {
  const box = await page.locator(SURFACE).boundingBox();
  if (!box) throw new Error('the pdf surface has no box to pinch on');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const spread = async (half: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: cx - half, y: cy },
        { x: cx + half, y: cy },
      ],
    });

  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: cx - 40, y: cy },
      { x: cx + 40, y: cy },
    ],
  });
  // Two moves, not one: the handler reads the distance travelled since
  // `touchstart`, and a gesture that jumps in a single frame is not the shape a
  // finger makes.
  await spread(90);
  await spread(160);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

// ---------------------------------------------------------------------------

test.describe('M11 · the reader on a phone', () => {
  test('a ref chip opens the printed page in the in-app viewer, streamed over byte ranges', async ({
    page,
    world,
  }) => {
    const hits = watchBook(page, world.book.code);
    await openChip(page, world);

    // The overlay is the book over the table's context, not a navigation away
    // from it — the codex page is still mounted behind it.
    const reader = page.getByRole('dialog', {
      name: `${world.book.code} p.${world.book.printedPage}`,
    });
    await expect(reader).toBeVisible();
    await expect(page.getByText(world.book.refPageTitle).first()).toBeAttached();

    // Self-hosted pdf.js, not the browser's plugin. `mode.ts` degrades to the
    // native viewer silently and on purpose, so this is the assertion that
    // tells the two apart.
    await expect(
      page.locator('[data-reader-mode="pdfjs"]'),
      'the reader fell back to the browser viewer — pdf.js could not start',
    ).toHaveCount(1);
    await expect(page.locator(SURFACE)).toBeVisible();

    // The page itself, by its pixels (see the header).
    await expectPageRendered(page, world.book.pdfPage);

    // …and the arithmetic that got there, written under the page (Principle 3).
    await expect(
      reader.getByText(
        `printed ${world.book.printedPage} · pdf ${world.book.pdfPage} of ${world.book.pageCount} · offset +${world.book.pageOffset}`,
      ),
      'the reader does not agree with the registry about where printed p.426 lives',
    ).toBeVisible();
    expect(world.book.pdfPage, 'the seeded offset is not the measured +5').toBe(
      world.book.printedPage + 5,
    );

    // --- and now the bill --------------------------------------------------
    expect(hits.length, 'nothing was fetched from the book endpoint at all').toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.range, `a request for the book carried no Range header (${hit.status})`).toMatch(
        /^bytes=\d+-\d+$/,
      );
      expect(
        hit.status,
        'the book endpoint answered without a byte range — the phone got the whole file',
      ).toBe(206);
    }
    // Measured at ~2.8% (three windows: the header, the xref tail, and the
    // page). A quarter is the line because the number that matters is the
    // difference between "some of the book" and "the book"; anything near the
    // whole file means the range transport stopped working, whatever the exact
    // window count of the day.
    const fetched = hits.reduce((n, h) => n + h.bytes, 0);
    expect(
      fetched,
      `pulled ${fetched} of ${world.book.bytes} bytes to show one page`,
    ).toBeLessThan(world.book.bytes / 4);
  });

  test('the printed-page jump box moves the reader, and the page under it changes', async ({
    page,
    world,
  }) => {
    await openChip(page, world);
    await expectPageRendered(page, world.book.pdfPage);

    // Two pages on from where the chip landed: far enough that a stale canvas
    // is obvious, near enough to stay inside the book.
    const printed = world.book.printedPage + 2;
    const pdf = world.book.pdfPage + 2;

    const reader = page.getByRole('dialog', {
      name: `${world.book.code} p.${world.book.printedPage}`,
    });
    const box = reader.getByRole('textbox', { name: 'Jump to printed page' });
    await box.fill(String(printed));
    await reader.getByRole('button', { name: 'go', exact: true }).click();

    await expectPageRendered(page, pdf);
    await expect(
      page.getByText(`printed ${printed} · pdf ${pdf} of ${world.book.pageCount} · offset +${world.book.pageOffset}`),
    ).toBeVisible();

    // The stepper speaks the same numbering: one tap back is the page the chip
    // opened on, and the box follows it rather than keeping the typed value.
    await page.getByRole('button', { name: 'Previous page' }).click();
    await expectPageRendered(page, pdf - 1);
    await expect(box).toHaveValue(String(printed - 1));
  });

  test('pinch and the zoom controls both change the rendered scale', async ({ page, world }) => {
    await openChip(page, world);
    await expectPageRendered(page, world.book.pdfPage);

    const canvasWidth = () => page.locator(CANVAS).evaluate((c) => (c as HTMLCanvasElement).width);
    const fitWidth = await canvasWidth();
    expect(await zoomPercent(page), 'the reader did not open at fit-width').toBe(100);

    // --- two fingers -------------------------------------------------------
    const cdp = await page.context().newCDPSession(page);
    await pinchOut(page, cdp);

    await expect
      .poll(() => zoomPercent(page), {
        timeout: 15_000,
        message: 'a two-finger spread did not commit a new zoom level',
      })
      .toBeGreaterThan(150);
    // Committed, not merely transformed: the bitmap is re-rendered at the new
    // scale, which is the difference between crisp type and a scaled-up blur.
    await expect
      .poll(canvasWidth, { timeout: 15_000 })
      .toBeGreaterThan(fitWidth);
    // Still the same page — a zoom is not a navigation.
    await expectPageRendered(page, world.book.pdfPage);

    // --- and the buttons, for the thumb that is holding the phone ----------
    await page.getByRole('button', { name: 'Fit page width' }).click();
    await expect.poll(() => zoomPercent(page), { timeout: 15_000 }).toBe(100);

    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(() => zoomPercent(page), { timeout: 15_000 }).toBe(125);
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect.poll(() => zoomPercent(page), { timeout: 15_000 }).toBe(100);
  });
});

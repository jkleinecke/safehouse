/**
 * The shelf's honesty rules (M11 / FR11.1).
 *
 * The measured facts these pin: a fresh `pnpm seed:books` registers seventeen
 * books and leaves sixteen of them at offset +0 — and measurement puts fifteen
 * of those sixteen somewhere else (`RG` is genuinely +0; every other book is
 * +1 or +2). So "+0 with no provenance" must never render as a calibrated
 * number — not even for `RG`, because nothing on the shelf can tell a lucky
 * default from a measurement — and a detection must never be able to write
 * itself.
 */
import { describe, expect, it } from 'vitest';
import {
  SEED_COMMAND,
  SEED_EXPLANATION,
  SEED_LIST_COMMAND,
  calibrationStatus,
  clampOffset,
  clampPrinted,
  confidenceBand,
  describeProposal,
  detectQueue,
  detectionNote,
  formatConfidence,
  formatOffset,
  normalizeDetection,
  previewPage,
  shelfSummary,
  stepOffset,
} from './calibration.js';

describe('calibration status', () => {
  it('reports a seeded +0 as not calibrated, never as an offset', () => {
    const status = calibrationStatus({ pageOffset: 0, hasFile: true });
    expect(status.state).toBe('uncalibrated');
    expect(status.label).toBe('not calibrated');
    expect(status.label).not.toMatch(/[+−-]?0/);
    expect(status.detail).toMatch(/wrong page/i);
    expect(status.actionable).toBe(true);
  });

  it('reports a measured offset as calibrated (core book +5)', () => {
    const status = calibrationStatus({ pageOffset: 5, hasFile: true });
    expect(status.state).toBe('calibrated');
    expect(status.label).toBe('offset +5');
  });

  it('accepts an explicit +0 when the server says a human set it', () => {
    expect(calibrationStatus({ pageOffset: 0, offsetSource: 'manual' }).state).toBe('calibrated');
    expect(calibrationStatus({ pageOffset: 0, offsetSource: 'detected' }).state).toBe('calibrated');
    // A seed-written source is still the default, not a measurement.
    expect(calibrationStatus({ pageOffset: 0, offsetSource: 'seed' }).state).toBe('uncalibrated');
  });

  it('flags a registry row with no PDF as unactionable', () => {
    const status = calibrationStatus({ pageOffset: 0, hasFile: false });
    expect(status.state).toBe('no-file');
    expect(status.actionable).toBe(false);
    expect(status.detail).toContain(SEED_COMMAND);
  });

  it('signs every offset it prints, including zero', () => {
    expect(formatOffset(5)).toBe('+5');
    expect(formatOffset(-2)).toBe('−2');
    expect(formatOffset(0)).toBe('+0');
  });
});

describe('the nudge loop', () => {
  it('resolves printed → pdf and says so in one line', () => {
    const preview = previewPage(426, 5);
    expect(preview.pdf).toBe(431);
    expect(preview.line).toBe('printed p.426 → PDF page 431 (+5)');
  });

  it('moves the resolved pdf page by one per step', () => {
    const before = previewPage(104, 0);
    const stepped = stepOffset(before.offset, 1);
    const after = previewPage(104, stepped);
    expect(before.pdf).toBe(104);
    expect(after.pdf).toBe(105);
    expect(previewPage(104, stepOffset(stepped, -2)).pdf).toBe(103);
  });

  it('clamps nonsense rather than saving it', () => {
    expect(clampOffset(Number.NaN)).toBe(0);
    expect(clampOffset(99_999)).toBe(500);
    expect(clampOffset(-9_999)).toBe(-50);
    expect(clampPrinted(0)).toBe(1);
    expect(clampPrinted(-4)).toBe(1);
    expect(clampPrinted(Number.NaN)).toBe(1);
  });
});

describe('detection proposals', () => {
  it('reads the expected shape', () => {
    const p = normalizeDetection({
      offset: 5,
      confidence: 0.93,
      evidence: 'matched 8 of 9 sampled printed page numbers',
      samples: [{ printed: 100, pdf: 105 }],
    });
    expect(p).not.toBeNull();
    expect(p!.offset).toBe(5);
    expect(p!.confidence).toBeCloseTo(0.93);
    expect(p!.samples).toEqual([{ printed: 100, pdf: 105 }]);
  });

  it('tolerates the other plausible field names and a 0-100 confidence', () => {
    const p = normalizeDetection({
      proposal: {
        proposedOffset: '12',
        score: 71,
        matches: [{ printedPage: 40, pdfPage: 52, text: 'p. 40' }],
      },
    });
    expect(p!.offset).toBe(12);
    expect(p!.confidence).toBeCloseTo(0.71);
    expect(p!.samples[0]).toEqual({ printed: 40, pdf: 52, note: 'p. 40' });
  });

  it('returns null when the payload carries no offset, so nothing is applied', () => {
    expect(normalizeDetection(null)).toBeNull();
    expect(normalizeDetection({})).toBeNull();
    expect(normalizeDetection({ confidence: 0.9 })).toBeNull();
    expect(normalizeDetection('ok')).toBeNull();
  });

  it('always produces an evidence sentence', () => {
    expect(normalizeDetection({ offset: 3 })!.evidence).toMatch(/without saying how/);
    expect(
      normalizeDetection({ offset: 3, samples: [{ printed: 1, pdf: 4 }] })!.evidence,
    ).toMatch(/1 printed page number matched/);
  });

  it('bands and words the confidence', () => {
    expect(confidenceBand(0.93)).toBe('high');
    expect(confidenceBand(0.7)).toBe('medium');
    expect(confidenceBand(0.2)).toBe('low');
    expect(confidenceBand(null)).toBe('unstated');
    expect(formatConfidence(0.93)).toBe('93% confident');
    expect(formatConfidence(null)).toBe('confidence unstated');
  });

  it('describes the change the GM would be approving', () => {
    const p = normalizeDetection({ offset: 5 })!;
    expect(describeProposal(0, p)).toBe('Would change +0 → +5.');
    expect(describeProposal(5, p)).toContain('Agrees with the saved offset');
  });
});

describe('detect all', () => {
  const shelf = [
    { id: 'sr5', pageOffset: 5 },
    { id: 'rg', pageOffset: 0 },
    { id: 'sg', pageOffset: 0 },
    { id: 'ghost', pageOffset: 0, hasFile: false },
  ];

  it('queues only the uncalibrated books with a file', () => {
    expect(detectQueue(shelf)).toEqual(['rg', 'sg']);
  });

  it('can be asked to re-do the calibrated ones too, never the fileless one', () => {
    expect(detectQueue(shelf, { includeCalibrated: true })).toEqual(['sr5', 'rg', 'sg']);
  });

  it('counts the shelf the way the header prints it', () => {
    expect(shelfSummary(shelf)).toEqual({
      total: 4,
      calibrated: 1,
      uncalibrated: 2,
      missingFile: 1,
    });
  });
});

describe('the seed instructions', () => {
  it('use the forms that actually run under pnpm', () => {
    expect(SEED_COMMAND).toBe('pnpm seed:books --calibrate');
    expect(SEED_LIST_COMMAND).toBe('pnpm seed:books --list');
    // `-- --list` is the form that fails with "unknown flag: --", because pnpm
    // forwards the separator verbatim. No command here may carry it.
    for (const cmd of [SEED_COMMAND, SEED_LIST_COMMAND]) {
      expect(cmd).not.toContain('-- --');
      expect(cmd.split(/\s+/)).not.toContain('--');
    }
  });

  it('leads with the measurement, because the fast form leaves 15 books wrong', () => {
    // Measured on the full production set: a plain seed files 16 books at +0
    // and only RG is actually +0. Telling a GM to run that first is telling
    // them to hand-calibrate fifteen books afterwards.
    expect(SEED_COMMAND).toContain('--calibrate');
  });

  it('states the measured cost of a full seed', () => {
    expect(SEED_EXPLANATION).toContain('17 books');
    // The calibrated figure: a plain seed indexes 3,546, four of which are
    // front-matter pages a calibrated run correctly refuses to file.
    expect(SEED_EXPLANATION).toContain('3,542 pages');
    // A range, not a single figure: three measured runs spanned 33–85 s, and
    // the spread is disk cache rather than anything the seeder controls.
    expect(SEED_EXPLANATION).toContain('30–90 seconds');
    // §14: the owner's own copies, never uploaded.
    expect(SEED_EXPLANATION).toMatch(/nothing is uploaded/i);
  });
});

describe('the server keeps the last word on a failed detection', () => {
  it('carries the message through verbatim', () => {
    expect(
      detectionNote({
        status: 'undetected',
        message: 'keeping +0: no printed page numbers found (48 of 48 sampled pages are image-only)',
      }),
    ).toBe('keeping +0: no printed page numbers found (48 of 48 sampled pages are image-only)');
  });

  it('does not flatten a split vote into "probably image-only"', () => {
    // These two are different problems: one needs a human, the other needs a
    // wider sample. A card that printed the same sentence for both would send
    // the GM after the wrong fix.
    const split = detectionNote({
      status: 'low-confidence',
      message: 'keeping +0: split vote — 21 pages say +1, 19 say +2',
    });
    expect(split).toMatch(/split vote/);
    expect(split).not.toMatch(/image-only/);
  });

  it('falls back to the reason, then to null, rather than inventing one', () => {
    expect(detectionNote({ reason: 'no-page-numbers' })).toBe('no-page-numbers');
    expect(detectionNote({ status: 'low-confidence' })).toBe('low-confidence');
    expect(detectionNote({})).toBeNull();
    expect(detectionNote(null)).toBeNull();
    expect(detectionNote('nope')).toBeNull();
  });

  it('reads the real declined payload the route sends', () => {
    // Shape copied from `toOffsetDto` in apps/server/src/plugins/books.ts.
    const payload = {
      book: { id: 'b1', code: 'SEA', title: 'Seattle Sprawl' },
      source: 'pdf',
      applied: false,
      currentOffset: 0,
      proposedOffset: null,
      wouldChange: false,
      status: 'low-confidence',
      message: 'keeping +0: only 4/40 sampled pages agree on +1 — too sparse to trust',
      confidence: 0.1,
      evidence: [],
      reason: 'low-agreement',
      apply: null,
    };
    // No offset to apply…
    expect(normalizeDetection(payload)).toBeNull();
    // …but the GM still learns why.
    expect(detectionNote(payload)).toMatch(/too sparse to trust/);
  });
});

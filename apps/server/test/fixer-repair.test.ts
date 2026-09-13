/**
 * The two layers between a nearly-right model answer and a 502
 * (fixer/repair.ts): bend what can be bent, then ask once for the fix.
 */
import { describe, expect, it, vi } from 'vitest';
import { ArchitectOutlineSchema } from '../src/fixer/architect.js';
import { FloorPlanSchema } from '../src/fixer/floor-plan.js';
import { ROOM_KINDS } from '../src/fixer/geometry.js';
import { coerceFloorPlan, coerceOutline, issueLines, repairJson } from '../src/fixer/repair.js';
import type { ChatTurn } from '../src/fixer/llm.js';

describe('coerceOutline', () => {
  it('maps a lore kind the enum lacks, clamps the grid and cuts long text', () => {
    const raw = {
      title: 'The Barrens',
      premise: 'A hideout and a cookout.',
      lore: [
        { title: 'The Cookout', kind: 'encounter', summary: 'x'.repeat(700) },
        { title: 'The Block', kind: 'building', summary: 'Condemned.' },
        { name: 'Untyped', summary: 'No kind at all.' },
      ],
      npcs: [
        { name: 'Vex', role: 'Gang leader', persona: { traits: Array.from({ length: 12 }, (_, i) => `t${i}`), voice: 'short' } },
        { name: 'Nameless role' },
      ],
      scenes: [
        { name: 'Courtyard', purpose: 'The cookout.', floor: 'One big yard, a grill, a wall.', cols: 120.4, rows: '25' },
      ],
    };
    const checked = ArchitectOutlineSchema.safeParse(coerceOutline(raw));
    expect(checked.success).toBe(true);
    if (!checked.success) return;
    expect(checked.data.lore.map((l) => l.kind)).toEqual(['run', 'location', 'page']);
    expect(checked.data.lore[0]!.summary.length).toBeLessThanOrEqual(600);
    expect(checked.data.npcs).toHaveLength(1);
    expect(checked.data.npcs[0]!.persona.traits).toHaveLength(8);
    expect(checked.data.scenes[0]!.cols).toBe(80);
    expect(checked.data.scenes[0]!.rows).toBe(25);
  });

  it('accepts the shape the schema already accepts, unchanged in meaning', () => {
    const good = {
      title: 'T',
      premise: 'P',
      lore: [{ title: 'L', kind: 'faction', summary: 'S' }],
      npcs: [],
      scenes: [{ name: 'S', purpose: 'P', floor: 'F', cols: 30, rows: 20, tileset: 'barrens' }],
    };
    const checked = ArchitectOutlineSchema.safeParse(coerceOutline(good));
    expect(checked.success).toBe(true);
    if (checked.success) expect(checked.data.scenes[0]!.tileset).toBe('barrens');
  });
});

describe('coerceFloorPlan', () => {
  it('rounds and clamps the numbers, aliases the kinds and the walls', () => {
    const raw = {
      title: 'Courtyard',
      rooms: [
        { name: 'Yard', kind: 'courtyard', x: 2.0, y: '3', width: 1, height: 12.6, props: [{ id: 'grill', x: 4, y: 5 }] },
        { name: 'No size' },
      ],
      doors: [{ room: 'Yard', wall: 'north', offset: 0, width: 30 }],
      stairs: [{ x: 1, y: 1, direction: 'sideways' }],
    };
    const checked = FloorPlanSchema.safeParse(coerceFloorPlan(raw, ROOM_KINDS));
    expect(checked.success).toBe(true);
    if (!checked.success) return;
    const room = checked.data.rooms[0]!;
    expect(checked.data.rooms).toHaveLength(1);
    expect([room.x, room.y, room.w, room.h]).toEqual([2, 3, 2, 13]);
    expect(room.props[0]!.tile).toBe('grill');
    expect(checked.data.openings[0]).toMatchObject({ room: 'Yard', wall: 'n', offset: 1, width: 20, kind: 'door' });
    expect(checked.data.stairs[0]!.direction).toBe('up');
  });
});

describe('issueLines', () => {
  it('names each issue by path', () => {
    const r = ArchitectOutlineSchema.safeParse({ title: 'T', premise: 'P', lore: [{ title: 'L', kind: 'nope', summary: 'S' }] });
    expect(r.success).toBe(false);
    if (r.success) return;
    const lines = issueLines(r.error.issues);
    expect(lines[0]).toMatch(/^lore\[0\]\.kind: /);
  });
});

describe('repairJson', () => {
  const turn = (content: string): ChatTurn => ({
    content,
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'fake',
    latencyMs: 1,
  });

  it('sends the bad answer and the issues back on the same thread at temperature 0, and parses the fix', async () => {
    const chat = vi.fn(async () => turn('```json\n{"title":"T","premise":"P","lore":[],"npcs":[],"scenes":[]}\n```'));
    const r = ArchitectOutlineSchema.safeParse({ title: 'T', premise: 'P', lore: [{ title: 'L', kind: 'nope', summary: 'S' }] });
    if (r.success) throw new Error('fixture should fail');
    const out = await repairJson(
      { chat },
      { model: 'fake', max_tokens: 100 },
      {},
      {
        messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'ask' }],
        badContent: '{"title":"T"}',
        issues: r.error.issues,
        what: 'the campaign outline',
        mustHave: 'premise',
      },
    );
    expect(out.parsed).toMatchObject({ title: 'T', premise: 'P' });
    const req = chat.mock.calls[0]![0] as { temperature: number; messages: Array<{ role: string; content: string | null }> };
    expect(req.temperature).toBe(0);
    expect(req.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(req.messages[2]!.content).toBe('{"title":"T"}');
    expect(req.messages[3]!.content).toContain('lore[0].kind');
    expect(req.messages[3]!.content).toContain('corrected JSON only');
  });
});

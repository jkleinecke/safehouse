/**
 * A token's look on the isometric map: describe it and let the AI dress the
 * figure, then adjust by hand.
 *
 * The figure is drawn, not painted (`stage/figure.ts`), so the AI's job is
 * to choose — archetype, metatype, coat, hair, eyes, what they carry, which
 * arm is chrome, and the colours — from the same lists the hand controls
 * offer. Whatever it leaves out stays as the token already had it. Nothing
 * reaches the map until Save.
 *
 * The GM uses it for any token (in Prep's properties); a player for their
 * own runner (the right-click menu), and a runner's look follows them into
 * every scene.
 */
import { useEffect, useState } from 'react';
import {
  FIGURE_ARCHETYPES,
  FIGURE_CYBERARMS,
  FIGURE_EYES,
  FIGURE_GEAR,
  FIGURE_HEADS,
  FIGURE_METATYPES,
  FIGURE_OUTFITS,
  type Token,
  type TokenLook,
} from '@safehouse/contracts';
import { useDescribeLook, useSetTokenLook } from '../api.js';
import { lookFor } from '../stage/figure.js';
import { inputCls, Row } from './ui.js';

const LABELS: Record<string, string> = {
  samurai: 'street samurai',
  decker: 'decker',
  mage: 'mage',
  rigger: 'rigger',
  face: 'face',
  adept: 'adept',
  ganger: 'ganger',
  security: 'corp security',
  civilian: 'civilian',
  cybereye: 'cybereye',
  none: 'none',
  topknot: 'topknot',
};

const COLOR_PARTS: ReadonlyArray<[keyof NonNullable<TokenLook['colors']>, string]> = [
  ['coat', 'Coat'],
  ['under', 'Shirt'],
  ['legs', 'Legs'],
  ['hair', 'Hair'],
  ['skin', 'Skin'],
  ['neon', 'Neon'],
  ['chrome', 'Chrome'],
];

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <Row label={label}>
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}>
        {options.map((o) => (
          <option key={o} value={o}>
            {LABELS[o] ?? o}
          </option>
        ))}
      </select>
    </Row>
  );
}

export default function LookEditor({ token, onDone }: { token: Token; onDone?: () => void }) {
  const [draft, setDraft] = useState<TokenLook>(token.look ?? {});
  const [description, setDescription] = useState(token.look?.description ?? '');
  const describe = useDescribeLook();
  const save = useSetTokenLook(token.sceneId);
  useEffect(() => {
    setDraft(token.look ?? {});
    setDescription(token.look?.description ?? '');
  }, [token.id, token.look]);

  // What the figure resolves to with this draft — the values the controls show.
  const shown = lookFor({ ...token, look: draft });
  const arm = shown.cyberarm === -1 ? 'left' : shown.cyberarm === 1 ? 'right' : 'none';
  const set = (patch: Partial<TokenLook>) => setDraft((d) => ({ ...d, ...patch }));
  const setColor = (part: keyof NonNullable<TokenLook['colors']>, v: string) =>
    setDraft((d) => ({ ...d, colors: { ...(d.colors ?? {}), [part]: v } }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(token.look ?? {});

  return (
    <div className="space-y-2" data-testid="look-editor">
      <form
        className="space-y-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const text = description.trim();
          if (!text) return;
          describe.mutate(
            { tokenId: token.id, description: text, current: draft },
            { onSuccess: (look) => setDraft({ ...look, description: text }) },
          );
        }}
      >
        <textarea
          className={inputCls + ' min-h-16 resize-y'}
          placeholder="Troll street samurai, long red duster, chrome left arm, green mohawk, katana…"
          value={description}
          maxLength={600}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Describe the look"
        />
        <div className="flex items-center gap-2">
          <button type="submit" className="btn px-2 py-1 text-xs text-cyan" disabled={describe.isPending || !description.trim()}>
            {describe.isPending ? 'dressing…' : 'Describe with AI'}
          </button>
          {describe.isError && <span className="mono-label text-danger">{(describe.error as Error).message || 'the AI could not answer'}</span>}
        </div>
      </form>

      <div className="space-y-1">
        <Choice label="Archetype" value={shown.archetype} options={FIGURE_ARCHETYPES} onChange={(v) => set({ archetype: v })} />
        <Choice label="Metatype" value={shown.metatype} options={FIGURE_METATYPES} onChange={(v) => set({ metatype: v })} />
        <Choice label="Outfit" value={shown.outfit} options={FIGURE_OUTFITS} onChange={(v) => set({ outfit: v })} />
        <Choice label="Hair / head" value={shown.headStyle} options={FIGURE_HEADS} onChange={(v) => set({ headStyle: v })} />
        <Choice label="Eyes" value={shown.eyes} options={FIGURE_EYES} onChange={(v) => set({ eyes: v })} />
        <Choice label="Carries" value={shown.gear} options={FIGURE_GEAR} onChange={(v) => set({ gear: v })} />
        <Choice label="Cyberarm" value={arm} options={FIGURE_CYBERARMS} onChange={(v) => set({ cyberarm: v })} />
        <Row label="Shoulders">
          <label className="flex items-center gap-1.5 text-xs text-dim">
            <input type="checkbox" checked={shown.pads} onChange={(e) => set({ pads: e.target.checked })} />
            armour plates
          </label>
        </Row>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {COLOR_PARTS.map(([part, label]) => (
          <label key={part} className="flex flex-col items-center gap-0.5">
            <input
              type="color"
              className="h-7 w-full cursor-pointer rounded border border-edge bg-deck"
              value={draft.colors?.[part] ?? hex(shown[part])}
              onChange={(e) => setColor(part, e.target.value)}
              aria-label={`${label} colour`}
            />
            <span className="mono-label text-faint">{label}</span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          className="btn px-2 py-1 text-xs text-cyan"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ tokenId: token.id, look: { ...draft, ...(description.trim() ? { description: description.trim() } : {}) } }, { onSuccess: () => onDone?.() })}
        >
          {save.isPending ? 'saving…' : 'Save look'}
        </button>
        <button
          type="button"
          className="btn px-2 py-1 text-xs text-dim"
          title="Back to the look chosen from its name"
          disabled={save.isPending || (token.look == null && Object.keys(draft).length === 0)}
          onClick={() => {
            setDraft({});
            setDescription('');
            save.mutate({ tokenId: token.id, look: null });
          }}
        >
          Reset
        </button>
        {save.isError && <span className="mono-label text-danger">not saved — retry</span>}
      </div>
      {token.source === 'character' && <p className="text-xs text-faint">A runner&apos;s look follows them into every scene.</p>}
    </div>
  );
}

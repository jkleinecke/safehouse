/**
 * The roll card (DESIGN.md §10.1): what the action is and where it is in the
 * book, the target, the pool line by line with a page on each, the offers to
 * tick, the limit, the attack's facts for the GM, then the dice: the app's
 * here, or the table's typed in. The server builds every number.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AttackKind,
  CardLine,
  CardOffer,
  CardSuggestion,
  Combatant,
  DeclaredBy,
  EdgeAction,
  Exchange,
  Glitch,
  RollCard,
  Visibility,
} from '@safehouse/contracts';
import type { CoverLevel } from '@safehouse/rules';
import { useMyCharacterId } from '../../api/campaigns.js';
import { useLiveStore } from '../../live/store.js';
import { Stepper } from '../sheet/components/ui.js';
import { signed } from '../sheet/lib.js';
import { useTrackerEncounter } from '../table/commands.js';
import DiceFaces from '../table/DiceFaces.js';
import { isOwnCombatant } from '../table/initiative.js';
import { PageChip, TypeBadge } from './ActionList.js';
import { previewCard, settleCard, type CardSettled } from './cardApi.js';
import {
  OUTCOME_WORD,
  flipOffer,
  latestExchanges,
  offOffers,
  offersOnWith,
  requestOf,
  tableResult,
  type CardDraft,
} from './cardModel.js';
import { modifierOrder, saidBy, stepLine, withCoverHint } from './gmModel.js';

export interface RollCardPanelProps {
  campaignId: string;
  /** The map's scene: its fight's rows are the targets. Else the live fight. */
  sceneId?: string | null;
  draft: CardDraft;
  onDraft: (next: CardDraft) => void;
  gm: boolean;
  /** GM only: who rolled when the GM enters it for them. */
  forActorBy?: DeclaredBy;
  /** The sheet's skill ids, for Use Skill. */
  skills?: readonly string[];
  /** On the map: step aside so the next token tap is the target. */
  onPickOnMap?: () => void;
  /** GM, on the map: the cover the map reads between two rows (a hint, never ticked). */
  coverOf?: (attackerId: string, targetId: string) => CoverLevel | null;
  initialVisibility?: Visibility;
  onBack?: () => void;
  onDone: () => void;
}

const SUGGESTED: Record<CardSuggestion, string> = {
  los: 'likely, from line of sight',
  attack: 'likely, from the attack',
  status: 'likely, from a status',
  turn: 'likely, from the turn',
};

const TONE: Record<CardLine['tone'], string> = {
  base: 'text-ink',
  buff: 'text-cyan',
  debuff: 'text-magenta',
  neutral: 'text-faint',
};

const EDGE: { id: EdgeAction | 'none'; label: string }[] = [
  { id: 'none', label: 'No Edge' },
  { id: 'push_pre', label: 'Push the limit' },
  { id: 'second_chance', label: 'Second chance' },
];

const VISIBILITY: { id: Visibility; label: string }[] = [
  { id: 'public', label: 'Everyone' },
  { id: 'gm_owner', label: 'GM and me' },
  { id: 'gm', label: 'GM only' },
];

const GLITCHES: Glitch[] = ['none', 'glitch', 'critical'];

function offerNote(o: CardOffer): string {
  const bits: string[] = [];
  if (o.note) bits.push(o.note);
  if (o.suggestedBy) bits.push(SUGGESTED[o.suggestedBy]);
  if (o.declaredBy) bits.push(`said by ${o.declaredBy.name}`);
  if (o.noDefense) bits.push('no defense test at all');
  return bits.join(' · ');
}

function failText(e: unknown): string {
  return e instanceof Error ? e.message : 'That did not go through.';
}

/** A number typed on a phone: shown as it stands, taken on blur or Enter. */
export function NumberField({
  value,
  label,
  min = 0,
  max = 99,
  onCommit,
  className = 'w-14',
}: {
  value: number;
  label: string;
  min?: number;
  max?: number;
  onCommit: (n: number) => void;
  className?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    const t = text?.trim() ?? '';
    setText(null);
    if (t === '') return;
    const n = Math.trunc(Number(t));
    if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
  };
  return (
    <input
      value={text ?? String(value)}
      inputMode="numeric"
      aria-label={label}
      title={label}
      onFocus={(e) => {
        setText(String(value));
        e.currentTarget.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={`${className} rounded border border-edge bg-deck px-1.5 py-1 text-center font-label text-sm tabular-nums outline-none focus:border-cyan pointer-coarse:min-h-10`}
    />
  );
}

function Tick({ on, label, onFlip }: { on: boolean; label: string; onFlip: () => void }) {
  return (
    <input
      type="checkbox"
      checked={on}
      onChange={onFlip}
      aria-label={label}
      className="h-4 w-4 shrink-0 accent-[#2fe6ff] pointer-coarse:h-5 pointer-coarse:w-5"
    />
  );
}

function OfferRow({
  offer,
  onFlip,
  onStep,
}: {
  offer: CardOffer;
  onFlip: (id: string) => void;
  onStep: (id: string, n: number) => void;
}) {
  const note = offerNote(offer);
  return (
    <li className="flex items-center gap-2 py-1 text-xs">
      <Tick on={offer.on} label={`${offer.label}, ${offer.on ? 'on' : 'off'}`} onFlip={() => onFlip(offer.id)} />
      <span className="min-w-0 flex-1">
        <span className={offer.on ? 'text-ink' : 'text-dim'}>{offer.label}</span>
        {offer.target === 'limit' && <span className="text-faint"> (limit)</span>}
        {note && <span className="block text-[0.65rem] text-faint">{note}</span>}
      </span>
      {offer.stepper && (
        <Stepper
          value={offer.stepper.count}
          min={0}
          max={offer.stepper.max ?? 20}
          onChange={(n) => onStep(offer.id, n)}
          label={offer.stepper.unit}
        />
      )}
      <PageChip refValue={offer.ref} />
      <span className={`w-8 text-right font-label tabular-nums ${offer.value < 0 ? 'text-magenta' : 'text-cyan'}`}>
        {signed(offer.value)}
      </span>
    </li>
  );
}

/** The pool's receipt; a line from an offer carries its strike box. */
function Receipt({
  lines,
  offers,
  onFlip,
  onStep,
}: {
  lines: readonly CardLine[];
  offers: readonly CardOffer[];
  onFlip: (id: string) => void;
  onStep: (id: string, n: number) => void;
}) {
  return (
    <ul className="mt-1">
      {lines.map((l, i) => {
        const o = l.offerId ? offers.find((x) => x.id === l.offerId) : undefined;
        const note = o ? offerNote(o) : '';
        return (
          <li key={`${l.label}-${i}`} className="flex items-center gap-2 py-0.5 text-xs">
            {o ? (
              <Tick on label={`${l.label}, on: untick to strike`} onFlip={() => onFlip(o.id)} />
            ) : (
              <span className="w-4 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1 text-dim">
              {l.label}
              {note && <span className="block text-[0.65rem] text-faint">{note}</span>}
            </span>
            {o?.stepper && (
              <Stepper
                value={o.stepper.count}
                min={0}
                max={o.stepper.max ?? 20}
                onChange={(n) => onStep(o.id, n)}
                label={o.stepper.unit}
              />
            )}
            <PageChip refValue={l.ref} />
            <span className={`w-8 text-right font-label tabular-nums ${TONE[l.tone]}`}>
              {l.tone === 'base' ? l.value : signed(l.value)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Section({ label, children, aside }: { label: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mt-3 border-t border-edge/60 pt-2">
      <div className="flex items-center gap-2">
        <span className="mono-label text-faint">{label}</span>
        {aside && <span className="ml-auto flex items-center gap-1.5">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** The fight's rows this viewer may target, the actor's own left out. */
function useTargetRows(campaignId: string, sceneId: string | null, draft: CardDraft, gm: boolean): Combatant[] {
  const { encounter } = useTrackerEncounter(campaignId, null, sceneId);
  const myCharacterId = useMyCharacterId(campaignId);
  return useMemo(() => {
    const a = draft.actor;
    const viewer = { role: gm ? ('gm' as const) : ('player' as const), ...(myCharacterId ? { characterId: myCharacterId } : {}) };
    return (encounter?.combatants ?? []).filter((c) => {
      if (a.kind === 'combatant') return c.id !== a.id;
      if (a.kind === 'token') return c.tokenId !== a.id;
      return gm ? !(c.source === 'character' && c.sourceId === a.id) : !isOwnCombatant(c, viewer);
    });
  }, [encounter, draft.actor, gm, myCharacterId]);
}

function TargetPicker({
  rows,
  draft,
  card,
  onDraft,
  onPickOnMap,
}: {
  rows: readonly Combatant[];
  draft: CardDraft;
  card: RollCard | undefined;
  onDraft: (next: CardDraft) => void;
  onPickOnMap?: () => void;
}) {
  const t = draft.target;
  const chosen = (c: Combatant) => !!t && ((t.kind === 'combatant' && t.id === c.id) || (t.kind === 'token' && t.id === c.tokenId));
  const name = card?.target?.name ?? t?.name;
  const without = () => {
    const next = { ...draft };
    delete next.target;
    onDraft(next);
  };
  return (
    <Section
      label="Target"
      aside={
        onPickOnMap ? (
          <button type="button" className="btn px-2 py-0.5 text-xs pointer-coarse:min-h-9" onClick={onPickOnMap}>
            Tap a token
          </button>
        ) : undefined
      }
    >
      <p className="mt-1 text-sm">
        {name ? <span className="font-semibold text-ink">{name}</span> : <span className="text-faint">None yet</span>}
      </p>
      <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Pick a target">
        {rows.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={chosen(c)}
            className={`chip pointer-coarse:min-h-9 ${chosen(c) ? 'border-cyan text-cyan' : 'text-dim'}`}
            onClick={() => onDraft({ ...draft, target: { kind: 'combatant', id: c.id, name: c.name } })}
          >
            {c.name}
            {c.tokenRemoved && <span className="ml-1 text-faint">(no token)</span>}
          </button>
        ))}
        {t && (
          <button type="button" className="chip text-faint pointer-coarse:min-h-9" onClick={without}>
            No target
          </button>
        )}
      </div>
    </Section>
  );
}

/** The attacker's facts for the defender's card; each one editable. */
function TellTheGm({
  card,
  draft,
  onDraft,
  gm,
}: {
  card: RollCard;
  draft: CardDraft;
  onDraft: (next: CardDraft) => void;
  gm: boolean;
}) {
  const d = card.declare;
  const [note, setNote] = useState<string | null>(null);
  if (!d) return null;
  const edit = (patch: CardDraft['declare']) => onDraft({ ...draft, declare: { ...draft.declare, ...patch } });
  const spell = card.action.id === 'cast_spell' || card.action.id === 'reckless_spellcasting';
  const kind: AttackKind | undefined = draft.declare.attack ?? card.action.attack;
  return (
    <Section label={gm ? 'The attack' : 'Tell the GM'}>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-1">
          <span className="mono-label">DV</span>
          <NumberField value={d.dv.value} label="Damage value" max={40} onCommit={(n) => edit({ dv: { value: n, type: d.dv.type } })} />
          {(['P', 'S'] as const).map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={d.dv.type === type}
              className={`chip pointer-coarse:min-h-9 ${d.dv.type === type ? 'border-cyan text-cyan' : 'text-dim'}`}
              onClick={() => edit({ dv: { value: d.dv.value, type } })}
            >
              {type}
            </button>
          ))}
        </span>
        <Stepper value={d.ap} min={-20} max={10} onChange={(n) => edit({ ap: n })} label="AP" />
        <span className="inline-flex items-center gap-1">
          <Stepper value={d.defenseModifier} min={-10} max={0} onChange={(n) => edit({ defenseModifier: n })} label="fire mode" />
          {d.mode && (
            <span className="text-faint">
              {d.mode}
              {d.rounds ? `, ${d.rounds} rounds` : ''}
            </span>
          )}
        </span>
      </div>
      {spell && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Kind of spell">
          {(
            [
              ['ranged', 'Indirect: they defend'],
              ['direct-spell', 'Direct: they resist'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={kind === id}
              className={`chip pointer-coarse:min-h-9 ${kind === id ? 'border-cyan text-cyan' : 'text-dim'}`}
              onClick={() => edit({ attack: id })}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <input
        value={note ?? d.note ?? ''}
        placeholder={gm ? 'Note' : 'Note for the GM'}
        aria-label={gm ? 'Note' : 'Note for the GM'}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if (note !== null && note !== (d.note ?? '')) edit({ note });
          setNote(null);
        }}
        className="mt-2 w-full rounded border border-edge bg-deck px-2 py-1 text-xs outline-none placeholder:text-faint focus:border-cyan pointer-coarse:min-h-10"
      />
      <p className="mt-1 text-[0.65rem] text-faint">From the weapon; change anything that differs.</p>
    </Section>
  );
}

/** The exchange this settle opened or answered, followed live. */
function useFollowed(x: Exchange | undefined): Exchange | undefined {
  const events = useLiveStore((s) => s.events);
  return useMemo(() => {
    if (!x) return undefined;
    return latestExchanges(events).find((s) => s.exchange.id === x.id)?.exchange ?? x;
  }, [events, x]);
}

/** GM: the attack this card answers, and who said so. */
function Answering({ x }: { x: Exchange }) {
  return (
    <p className="mt-2 rounded border border-magenta-dim/60 px-2 py-1 text-xs text-ink" data-testid="card-answering">
      {stepLine(x)}
      <span className="text-faint"> · {saidBy(x.declared.by)}</span>
      {x.declared.note && <span className="block text-[0.65rem] text-faint">{x.declared.note}</span>}
    </p>
  );
}

function Settled({
  out,
  gm,
  onAgain,
  onDone,
}: {
  out: CardSettled;
  gm: boolean;
  onAgain: () => void;
  onDone: () => void;
}) {
  const x = useFollowed(out.exchange);
  const r = out.roll;
  const role = out.card.action.exchange;
  const table = r !== null && r.faces.length === 0;
  let follow: ReactNode = null;
  if (x && x.state === 'cancelled') follow = <p className="text-sm text-faint">The GM closed this attack.</p>;
  else if (x && role === 'opens') {
    follow = x.outcome ? (
      <p className="font-label text-2xl text-cyan" data-testid="attack-outcome">
        {OUTCOME_WORD[x.outcome]}
      </p>
    ) : (
      <p className="text-sm text-dim">
        {gm ? `Open on ${x.target.name}'s row: defend it there.` : `Waiting for ${x.target.name} to defend…`}
      </p>
    );
  } else if (x && role === 'defends' && x.outcome) {
    follow = (
      <p className="text-sm">
        <span className="font-label text-2xl text-cyan">{OUTCOME_WORD[x.outcome]}</span>
        {x.state === 'awaiting_soak' && <span className="ml-2 text-dim">Resist the damage next.</span>}
      </p>
    );
  } else if (x && role === 'soaks' && x.boxes !== undefined) {
    follow = (
      <p className="text-sm text-dim">
        {x.boxes} {x.track === 'stun' ? 'Stun' : 'Physical'} boxes
        {x.appliedAt ? ' on your monitor.' : '. The GM puts them on your monitor.'}
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-2 border-t border-edge/60 pt-3" role="status">
      {r ? (
        <div className="space-y-1">
          {!table && <DiceFaces faces={r.faces} />}
          <p className="text-sm">
            <span className="font-label text-2xl text-cyan">{r.limitedHits}</span>{' '}
            <span className="text-dim">
              hits{r.hits > r.limitedHits ? ` (${r.hits} rolled, limit ${r.limitedHits})` : ''}
              {table ? ' · table dice' : ''}
            </span>
            {r.glitch !== 'none' && (
              <span className={`chip ml-2 ${r.glitch === 'critical' ? 'border-danger text-danger' : 'border-warn text-warn'}`}>
                {r.glitch === 'critical' ? 'Critical glitch' : 'Glitch'}
              </span>
            )}
          </p>
        </div>
      ) : (
        <p className="text-sm text-dim">Done: no test to roll.</p>
      )}
      {out.initScore && (
        <p className="text-xs text-warn">
          Initiative {out.initScore.from} → {out.initScore.to}
        </p>
      )}
      {follow}
      <div className="flex gap-2">
        <button type="button" className="btn flex-1 py-2" onClick={onAgain}>
          Again
        </button>
        <button type="button" className="btn btn-accent flex-1 py-2" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

export default function RollCardPanel(props: RollCardPanelProps) {
  const { draft, onDraft, gm } = props;
  const req = requestOf(draft);
  const flips = draft.flips;
  const flipped = Object.keys(flips).length > 0;
  const preview = useQuery({
    queryKey: ['card-preview', req, flips],
    queryFn: async () => {
      const base = await previewCard(req);
      return flipped ? previewCard({ ...req, offersOn: offersOnWith(base.offers, flips) }) : base;
    },
    placeholderData: keepPreviousData,
    staleTime: 5_000,
    retry: 0,
  });
  const card = preview.data;
  const qc = useQueryClient();
  const rows = useTargetRows(props.campaignId, props.sceneId ?? null, draft, gm);

  const [edge, setEdge] = useState<EdgeAction | 'none'>('none');
  const [visibility, setVisibility] = useState<Visibility | null>(props.initialVisibility ?? null);
  const [hits, setHits] = useState(0);
  const [glitch, setGlitch] = useState<Glitch>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState<CardSettled | null>(null);

  const flip = (id: string) => card && onDraft({ ...draft, flips: flipOffer(card.offers, flips, id) });
  const step = (id: string, n: number) => {
    const nextFlips = { ...flips };
    delete nextFlips[id];
    onDraft({ ...draft, steppers: { ...draft.steppers, [id]: n }, flips: nextFlips });
  };

  const settle = (dice: 'app' | { hits: number; glitch: Glitch }) => {
    if (!card || busy) return;
    setBusy(true);
    setError(null);
    settleCard({
      ...req,
      ...(flipped ? { offersOn: card.offers.filter((o) => o.on).map((o) => o.id) } : {}),
      settle: dice,
      edge: edge === 'none' ? null : edge,
      ...(visibility ? { visibility } : {}),
      ...(gm && props.forActorBy ? { forActorBy: props.forActorBy } : {}),
    })
      .then((out) => {
        setSettled(out);
        // Recoil, the score and Edge moved: the next card is built fresh.
        void qc.invalidateQueries({ queryKey: ['card-preview'] });
        void qc.invalidateQueries({ queryKey: ['card-actions'] });
      })
      .catch((e: unknown) => setError(failText(e)))
      .finally(() => setBusy(false));
  };

  if (!card) {
    return (
      <div className="py-6 text-center text-sm" role="status">
        {preview.isError ? <span className="text-danger">{failText(preview.error)}</span> : <span className="text-faint">Building the card…</span>}
        {props.onBack && (
          <div className="mt-3">
            <button type="button" className="btn px-3 py-1" onClick={props.onBack}>
              Back
            </button>
          </div>
        )}
      </div>
    );
  }

  const answering = card.context?.exchange;
  const coverFrom = answering?.attacker?.combatantId;
  const coverTo = answering?.target.combatantId;
  const cover =
    props.coverOf && card.action.exchange === 'defends' && coverFrom && coverTo ? props.coverOf(coverFrom, coverTo) : null;
  const offers = withCoverHint(card.offers, cover);
  const initCost = offers.find((o) => o.target === 'initiative');
  const modifiersFirst = gm && card.stage === 'modifiers';
  const targeted = card.action.exchange === 'opens' || draft.needsTarget === true || draft.target !== undefined;
  const stale = preview.isPlaceholderData || preview.isFetching;
  const vis = visibility ?? card.defaultVisibility;
  const test = card.test;
  const weapons = draft.weapons ?? [];

  return (
    <div data-testid="roll-card">
      <header className="flex flex-wrap items-center gap-2">
        {props.onBack && (
          <button type="button" className="btn px-2 py-0.5 text-xs" onClick={props.onBack} aria-label="Back to the actions">
            ←
          </button>
        )}
        <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{card.action.name}</span>
        <TypeBadge type={card.action.type} />
        <PageChip refValue={card.action.ref} />
        {card.action.refs?.map((r, i) => <PageChip key={i} refValue={r} />)}
      </header>
      <p className="mt-0.5 text-xs text-faint">
        {card.actor.name}
        {test?.kind === 'opposed' && test.against ? ` · against ${test.against}` : ''}
        {test?.kind === 'threshold' ? ` · threshold ${test.threshold}` : ''}
        {card.cost?.rounds ? ` · ${card.cost.rounds} rounds` : ''}
        {test && <PageChip refValue={test.ref} />}
      </p>
      {gm && answering && <Answering x={answering} />}

      {initCost && (
        <div className="mt-2 flex items-center gap-2 rounded border border-warn/40 px-2 py-1 text-xs">
          <Tick on={initCost.on} label={`${initCost.label}, ${initCost.on ? 'paid' : 'not paid'}`} onFlip={() => flip(initCost.id)} />
          <span className={`flex-1 ${initCost.on ? 'text-warn' : 'text-faint line-through'}`}>
            {initCost.label}
            {initCost.note ? ` (${initCost.note})` : ''}
          </span>
          <PageChip refValue={initCost.ref} />
        </div>
      )}

      {weapons.length > 0 && (
        <label className="mt-2 flex items-center gap-2 text-xs">
          <span className="mono-label">Weapon</span>
          <select
            value={draft.weapon ?? weapons[0]}
            onChange={(e) => onDraft({ ...draft, weapon: e.target.value })}
            className="min-w-0 flex-1 rounded border border-edge bg-deck px-1.5 py-1 text-sm text-ink pointer-coarse:min-h-10"
          >
            {weapons.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
      )}

      {card.action.id === 'use_skill' && (
        <label className="mt-2 flex items-center gap-2 text-xs">
          <span className="mono-label">Skill</span>
          <input
            list="card-skills"
            defaultValue={draft.skill ?? ''}
            placeholder="e.g. sneaking"
            onBlur={(e) => {
              const skill = e.target.value.trim();
              if (skill === (draft.skill ?? '')) return;
              const next = { ...draft };
              delete next.skill;
              onDraft(skill ? { ...next, skill } : next);
            }}
            className="min-w-0 flex-1 rounded border border-edge bg-deck px-1.5 py-1 text-sm text-ink outline-none focus:border-cyan pointer-coarse:min-h-10"
          />
          <datalist id="card-skills">
            {(props.skills ?? []).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
      )}

      {targeted && (
        <TargetPicker rows={rows} draft={draft} card={card} onDraft={onDraft} {...(props.onPickOnMap ? { onPickOnMap: props.onPickOnMap } : {})} />
      )}

      {modifiersFirst ? (
        <Section label="Modifiers">
          <ul className="mt-1">
            {modifierOrder(offers).map((o) => (
              <OfferRow key={o.id} offer={o} onFlip={flip} onStep={step} />
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between">
            <span className="mono-label text-faint">Other</span>
            <Stepper value={draft.other} onChange={(n) => onDraft({ ...draft, other: n })} label="other modifier" />
          </div>
          <button
            type="button"
            className="btn btn-accent mt-2 w-full py-2"
            onClick={() => onDraft({ ...draft, stage: 'dice' })}
          >
            Done, show dice
          </button>
        </Section>
      ) : (
        <>
          {card.pool ? (
            <Section
              label="Pool"
              aside={
                <>
                  {gm && (
                    <button
                      type="button"
                      className="btn px-2 py-0.5 text-xs"
                      onClick={() => onDraft({ ...draft, stage: 'modifiers' })}
                    >
                      ← Modifiers
                    </button>
                  )}
                  <span className="font-label text-2xl leading-none text-cyan" aria-label={`${card.pool.total} dice`}>
                    {card.pool.total}
                  </span>
                </>
              }
            >
              <Receipt lines={card.pool.lines} offers={offers} onFlip={flip} onStep={step} />
            </Section>
          ) : (
            <p className="mt-3 text-sm text-dim">No test for this one.</p>
          )}

          {card.limit && (
            <Section
              label="Limit"
              aside={
                <>
                  <span className="text-xs text-dim">{card.limit.kind}</span>
                  <PageChip refValue={card.limit.ref} />
                  <span className={`font-label text-lg leading-none ${edge === 'push_pre' ? 'text-faint line-through' : 'text-ink'}`}>
                    {card.limit.value}
                  </span>
                </>
              }
            >
              <Receipt lines={card.limit.lines} offers={offers} onFlip={flip} onStep={step} />
            </Section>
          )}

          {offOffers(offers).length > 0 && (
            <Section label="More modifiers">
              <ul className="mt-1">
                {offOffers(offers).map((o) => (
                  <OfferRow key={o.id} offer={o} onFlip={flip} onStep={step} />
                ))}
              </ul>
            </Section>
          )}
          <div className="mt-2 flex items-center justify-between">
            <span className="mono-label text-faint">Other</span>
            <Stepper value={draft.other} onChange={(n) => onDraft({ ...draft, other: n })} label="other modifier" />
          </div>
        </>
      )}

      <TellTheGm card={card} draft={draft} onDraft={onDraft} gm={gm} />

      {settled ? (
        <Settled
          out={settled}
          gm={gm}
          onAgain={() => {
            setSettled(null);
            setHits(0);
            setGlitch('none');
          }}
          onDone={props.onDone}
        />
      ) : (
        !modifiersFirst && (
          <div className="mt-3 border-t border-edge/60 pt-3">
            {card.pool && (
              <div className="mb-2 space-y-1.5 text-xs">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Edge">
                  {EDGE.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      aria-pressed={edge === o.id}
                      className={`chip ${edge === o.id ? 'border-warn text-warn' : 'text-dim'}`}
                      onClick={() => setEdge(o.id)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Who sees it">
                  {VISIBILITY.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      aria-pressed={vis === o.id}
                      className={`chip ${vis === o.id ? 'border-cyan text-cyan' : 'text-dim'}`}
                      onClick={() => setVisibility(o.id)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(error ?? (preview.isError ? failText(preview.error) : null)) && (
              <p className="mb-2 text-sm text-danger" role="alert">
                {error ?? failText(preview.error)}
              </p>
            )}
            {card.pool ? (
              <>
                <button
                  type="button"
                  className="btn btn-accent w-full py-3 text-sm"
                  disabled={busy || stale}
                  onClick={() => settle('app')}
                >
                  {busy ? 'Rolling…' : gm ? 'Roll here' : `Roll ${card.pool.total} d6 here`}
                </button>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="mono-label">I rolled:</span>
                  <NumberField
                    value={hits}
                    label="Hits you rolled"
                    max={60}
                    onCommit={(n) => {
                      setHits(n);
                      if (n > 0 && glitch === 'critical') setGlitch('glitch');
                    }}
                  />
                  <span className="text-faint">hits</span>
                  {GLITCHES.map((g) => (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={glitch === g}
                      className={`chip pointer-coarse:min-h-9 ${glitch === g ? (g === 'none' ? 'border-cyan text-cyan' : 'border-warn text-warn') : 'text-dim'}`}
                      onClick={() => {
                        setGlitch(g);
                        if (g === 'critical') setHits(0);
                      }}
                    >
                      {g}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="btn ml-auto px-3 py-1 pointer-coarse:min-h-10"
                    disabled={busy || stale}
                    onClick={() => settle(tableResult(hits, glitch))}
                  >
                    Send
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="btn btn-accent w-full py-3 text-sm" disabled={busy || stale} onClick={() => settle('app')}>
                {busy ? 'Sending…' : 'Confirm'}
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}

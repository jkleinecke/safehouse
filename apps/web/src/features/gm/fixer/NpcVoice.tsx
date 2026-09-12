/**
 * Speak as an NPC (FR12.6): the GM picks an archetype with a persona and
 * talks to it in character — the Fixer answers in the NPC's voice, one line
 * a turn, inside that NPC's knowledge boundary. `POST /api/npcs/:id/converse`
 * has been on the server since M10; this is its first surface
 * (docs/UX_AUDIT.md, "built server-side, no UI entry point"). Nothing here
 * reaches the table: a line is for the GM to read aloud, or not.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { NpcTemplate } from '@safehouse/contracts';
import { fmtLatency, fmtTokens } from '../common.js';
import { useNpcTemplates } from '../generator/api.js';
import { ErrorNote, SectionTitle, inputClass } from '../ui.js';
import {
  aiDisabledFrom,
  isAiCancelled,
  useCancelAi,
  useFixerStatus,
  useNpcConverse,
  type NpcConverseAck,
} from './api.js';

export interface VoiceLine {
  who: 'gm' | 'npc';
  text: string;
  ts: number;
}

/** An archetype with something written down to speak from. */
export function hasVoice(t: NpcTemplate): boolean {
  const p = t.persona;
  return Boolean(p && (p.voice || p.backstory || (p.traits?.length ?? 0) > 0));
}

/** Archetypes with a persona first — they are the ones with a voice. */
export function voiceOrder(list: readonly NpcTemplate[]): NpcTemplate[] {
  return [...list].sort(
    (a, b) => Number(hasVoice(b)) - Number(hasVoice(a)) || a.name.localeCompare(b.name),
  );
}

/** The persona in one line, so the GM stays in character between turns. */
export function personaLine(t: NpcTemplate | undefined): string | null {
  const p = t?.persona;
  if (!p) return null;
  const bits = [p.voice, ...(p.traits ?? []).slice(0, 3), ...(p.mannerisms ?? []).slice(0, 2)].filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  );
  return bits.length > 0 ? bits.join(' · ') : null;
}

export interface NpcVoiceProps {
  campaignId: string;
  /** Live session → default to the fast slot so inference never starves the table. */
  sessionLive?: boolean | undefined;
}

export default function NpcVoice({ campaignId, sessionLive }: NpcVoiceProps) {
  const templates = useNpcTemplates(campaignId);
  const status = useFixerStatus();
  const send = useNpcConverse();
  const cancel = useCancelAi(campaignId);
  const list = voiceOrder(templates.data ?? []);

  const [npcId, setNpcId] = useState('');
  const [draft, setDraft] = useState('');
  const [slot, setSlot] = useState<'primary' | 'fast'>(sessionLive ? 'fast' : 'primary');
  const [lines, setLines] = useState<VoiceLine[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [last, setLast] = useState<NpcConverseAck | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  const picked = list.find((t) => t.id === npcId) ?? list[0];
  const disabled = aiDisabledFrom(status.data, status.error, send.error);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const reset = () => {
    setLines([]);
    setConversationId(undefined);
    setLast(null);
  };
  const choose = (id: string) => {
    setNpcId(id);
    reset();
  };

  const submit = () => {
    const message = draft.trim();
    if (!message || !picked || disabled || send.isPending) return;
    setLines((l) => [...l, { who: 'gm', text: message, ts: Date.now() }]);
    setDraft('');
    send.mutate(
      {
        npcId: picked.id,
        body: { campaignId, message, slot, ...(conversationId ? { conversationId } : {}) },
      },
      {
        onSuccess: (ack) => {
          setConversationId(ack.conversationId);
          setLast(ack);
          setLines((l) => [...l, { who: 'npc', text: ack.line, ts: Date.now() }]);
        },
      },
    );
  };

  if (disabled) {
    return (
      <div className="panel p-4" data-testid="npc-voice-offline">
        <SectionTitle hint="NG7 — needs the Fixer's inference endpoint">Speak as an NPC</SectionTitle>
        <p className="mt-2 text-sm text-dim">
          Comes back with the Fixer: point{' '}
          <Link className="text-cyan underline" to={`/c/${campaignId}/gm/ai`}>
            AI
          </Link>{' '}
          at an inference endpoint and any archetype with a persona can be talked to in character.
        </p>
      </div>
    );
  }

  return (
    <div className="panel flex min-h-0 flex-col p-4" data-testid="npc-voice">
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle hint="in character, inside what they know — for you to read aloud">
          Speak as an NPC
        </SectionTitle>
        <span className="chip text-faint" title="Model slot">
          {slot}
        </span>
        <button
          className="chip cursor-pointer text-dim hover:text-cyan"
          onClick={() => setSlot(slot === 'primary' ? 'fast' : 'primary')}
        >
          use {slot === 'primary' ? 'fast' : 'primary'}
        </button>
        <button
          className="btn ml-auto px-2.5 py-1"
          onClick={reset}
          title="Start the conversation over (history lives server-side)"
        >
          new thread
        </button>
      </div>

      {templates.data && list.length === 0 && (
        <p className="mt-2 text-sm text-dim" data-testid="npc-voice-empty">
          No archetypes yet —{' '}
          <Link className="text-cyan underline" to={`/c/${campaignId}/gm/generator?tab=library`}>
            install or write one
          </Link>
          , give it a persona, and it can talk.
        </p>
      )}

      {list.length > 0 && (
        <label className="mt-2 flex flex-wrap items-center gap-2">
          <span className="mono-label">npc</span>
          <select
            className={`${inputClass} w-auto`}
            value={picked?.id ?? ''}
            onChange={(e) => choose(e.target.value)}
            aria-label="Speak as"
            data-testid="npc-voice-pick"
          >
            {list.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {hasVoice(t) ? '' : ' (no persona yet)'}
              </option>
            ))}
          </select>
        </label>
      )}
      {picked && personaLine(picked) && (
        <p className="mt-1 text-xs text-dim" data-testid="npc-voice-persona">
          {personaLine(picked)}
        </p>
      )}

      <div ref={scroller} className="mt-3 max-h-72 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {lines.length === 0 && picked && (
          <p className="text-sm text-dim">
            Say something to {picked.name}. What comes back is a line, not a ruling: they only know
            what their persona says they know.
          </p>
        )}
        {lines.map((l, i) =>
          l.who === 'gm' ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-md bg-raised px-3 py-2">
              <div className="mono-label text-faint">gm</div>
              <p className="whitespace-pre-wrap text-sm text-ink">{l.text}</p>
            </div>
          ) : (
            <div key={i} className="max-w-[95%]">
              <div className="mono-label text-magenta">{picked?.name ?? 'npc'}</div>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{l.text}</p>
            </div>
          ),
        )}
        {send.isPending && (
          <p className="flex items-center gap-2 mono-label text-cyan" data-testid="npc-working">
            <span className="animate-pulse">{picked?.name ?? 'npc'} is thinking…</span>
            <button
              type="button"
              className="btn px-2 py-0 text-danger"
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending}
              data-testid="npc-cancel"
            >
              cancel
            </button>
          </p>
        )}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <textarea
          className="min-h-[2.5rem] w-full resize-y rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
          rows={2}
          value={draft}
          placeholder={picked ? `say something to ${picked.name}…` : 'pick an archetype first'}
          disabled={!picked}
          aria-label="Your line"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {/* "speak", not "send": it is the NPC's line, and the Fixer chat beside
            this panel already owns the word "send" (its e2e clicks it by name). */}
        <button
          className="btn btn-accent shrink-0 px-3 py-2"
          onClick={submit}
          disabled={!picked || send.isPending || draft.trim().length === 0}
        >
          {send.isPending ? 'speaking…' : 'speak'}
        </button>
      </div>
      <p className="mono-label mt-1 text-faint">ctrl+enter speaks</p>
      {isAiCancelled(send.error) ? (
        <p className="mt-2 text-xs text-warn">Cancelled — {picked?.name ?? 'the NPC'} said nothing.</p>
      ) : (
        <ErrorNote error={send.error} />
      )}

      {last && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-edge pt-2">
          <span className="mono-label text-faint">usage</span>
          <span className="chip text-dim" title="Tokens in the most recent turn">
            {fmtTokens(last.usage?.totalTokens)} tok
          </span>
          <span className="chip text-dim" title="Latency of the most recent turn">
            {fmtLatency(last.usage?.latencyMs)}
          </span>
          {last.model && <span className="mono-label ml-auto text-faint">{last.model}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * "What is actually set up in this campaign" — the console's opening answer.
 *
 * A GM filling in a new campaign had no way to tell which parts of the app were
 * waiting on them and which were simply somewhere else. Each row is a real
 * count read from REST on mount (LIVE-1), and each row that is empty carries
 * the control that fixes it rather than a sentence about one.
 */
import { Link } from 'react-router-dom';
import { aiProviderInfo, type AiSettingsView } from '@safehouse/contracts';
import { useScenes } from '../../grid/api.js';
import { useBooks } from '../books/api.js';
import { useAiSettings } from '../fixer/api.js';
import { useNpcTemplates } from '../generator/api.js';
import { useDevices, useRoster } from './api.js';

/** The part of the AI settings the checklist row needs. */
export type AiStatus = Pick<AiSettingsView, 'provider' | 'ready' | 'primaryModel' | 'fallback'>;

/**
 * One line on the AI. The feature is optional (NG7), so "off" is a state and
 * not a gap — but a GM who never found where the choice lives had no way to
 * know that either, which is what the row is for.
 */
export function aiDetail(ai: AiStatus | undefined): string {
  if (!ai || ai.provider === 'off') {
    if (ai?.fallback) return `running on the server's .env — ${ai.fallback.baseUrl}`;
    return 'optional — off, every AI feature keeps its manual path';
  }
  const info = aiProviderInfo(ai.provider);
  if (ai.ready) return `${info.label} · ${ai.primaryModel || info.defaults.primary}`;
  return `${info.label} chosen, but not usable yet — a key is missing`;
}

export interface ChecklistRow {
  key: string;
  label: string;
  /** Undefined while the count is still loading. */
  count: number | undefined;
  done: boolean;
  detail: string;
  /** Where the GM goes to fix it. */
  to: string;
  cta: string;
}

/** Pure so the states are testable without a query client. */
export function checklistRows(input: {
  campaignId: string;
  named: boolean;
  characters: number | undefined;
  devices: number | undefined;
  scenes: number | undefined;
  books: number | undefined;
  /** NPC templates — the Opposition Kit's cold start. */
  archetypes: number | undefined;
  /** Which AI, as the server reports it; undefined while loading. */
  ai?: AiStatus | undefined;
}): ChecklistRow[] {
  const c = `/c/${input.campaignId}`;
  return [
    {
      key: 'name',
      label: 'Campaign named',
      count: undefined,
      done: input.named,
      detail: input.named ? 'name and in-game date are set' : 'give it a name and a Sixth World date',
      to: `${c}/gm`,
      cta: 'settings',
    },
    {
      key: 'party',
      label: 'Party',
      count: input.characters,
      done: (input.characters ?? 0) > 0,
      detail:
        (input.characters ?? 0) > 0
          ? 'open any sheet from the roster'
          : 'import a Chummer build or start a blank sheet',
      to: `${c}/gm/party`,
      cta: (input.characters ?? 0) > 0 ? 'roster' : 'add a runner',
    },
    {
      key: 'devices',
      label: 'Devices joined',
      count: input.devices,
      done: (input.devices ?? 0) > 0,
      detail:
        (input.devices ?? 0) > 0
          ? 'phones and screens paired to this table'
          : 'show the join QR — nobody ever types an IP',
      to: `${c}/gm`,
      cta: 'invites',
    },
    {
      key: 'scenes',
      label: 'Scenes',
      count: input.scenes,
      done: (input.scenes ?? 0) > 0,
      detail:
        (input.scenes ?? 0) > 0
          ? 'activate one to push it to the table'
          : 'a map, a grid calibration, fog — built on the Map',
      to: `${c}/gm/scenes`,
      cta: (input.scenes ?? 0) > 0 ? 'scenes' : 'create one',
    },
    {
      /**
       * Closes `generator/GeneratorWorkspace`'s `// INTEGRATION:` note: it
       * built `?tab=library` as the deep link for exactly this card and said
       * the GM home was another agent's file that round. This is that card. A
       * campaign with no archetypes cannot roll opposition at all, and the
       * starter library is one click away — but only if something says so.
       */
      key: 'opposition',
      label: 'Opposition',
      count: input.archetypes,
      done: (input.archetypes ?? 0) > 0,
      detail:
        (input.archetypes ?? 0) > 0
          ? 'roll bodies from an archetype and check the threat math'
          : 'nothing to throw at them yet — install the starter archetypes',
      to:
        (input.archetypes ?? 0) > 0
          ? `${c}/gm/generator`
          : `${c}/gm/generator?tab=library`,
      cta: (input.archetypes ?? 0) > 0 ? 'generator' : 'starter library',
    },
    {
      key: 'books',
      label: 'Rules library',
      count: input.books,
      done: (input.books ?? 0) > 0,
      detail:
        (input.books ?? 0) > 0
          ? 'shared books open to the printed page'
          : 'run pnpm seed:books with the server stopped',
      to: `${c}/books`,
      cta: (input.books ?? 0) > 0 ? 'library' : 'how to seed',
    },
    {
      /**
       * The runtime AI choice lives on the Fixer page, and nothing else on the
       * console pointed at it — so a GM who had set `LLM_BASE_URL` in `.env`
       * and then could not see where to change it was looking in the right
       * place for the wrong thing. This row names it.
       */
      key: 'ai',
      label: 'Which AI',
      count: undefined,
      done: input.ai?.ready === true,
      detail: aiDetail(input.ai),
      to: `${c}/gm/ai`,
      cta: input.ai?.ready ? 'change' : 'choose',
    },
  ];
}

export default function SetupChecklist({
  campaignId,
  named,
}: {
  campaignId: string;
  named: boolean;
}) {
  const roster = useRoster(campaignId);
  const devices = useDevices(campaignId);
  const scenes = useScenes(campaignId);
  const books = useBooks(campaignId);
  const archetypes = useNpcTemplates(campaignId);
  const ai = useAiSettings(campaignId);

  const rows = checklistRows({
    campaignId,
    named,
    characters: roster.data?.length,
    devices: devices.data?.filter((d) => !d.revokedAt).length,
    scenes: scenes.data?.length,
    books: books.data?.length,
    archetypes: archetypes.data?.length,
    ai: ai.data,
  });

  return (
    <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" data-testid="setup-checklist">
      {rows.map((row) => (
        <li
          key={row.key}
          data-check={row.key}
          data-done={row.done ? 'yes' : 'no'}
          className="flex items-center gap-2.5 rounded-md border border-edge bg-deck/50 px-3 py-2"
        >
          <span aria-hidden className={row.done ? 'text-ok' : 'text-warn'}>
            {row.done ? '●' : '○'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">
              {row.label}
              {row.count !== undefined && (
                <span className="mono-label ml-2 text-faint">{row.count}</span>
              )}
            </span>
            <span className="mono-label block truncate text-faint">{row.detail}</span>
          </span>
          <Link className="btn shrink-0 px-2.5 py-1" to={row.to}>
            {row.cta}
          </Link>
        </li>
      ))}
    </ul>
  );
}

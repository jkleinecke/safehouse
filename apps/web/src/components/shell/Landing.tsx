/**
 * `/` — the front door (FR1.1/1.2; BUILD_REPORT gap #2).
 *
 * A joined device bounces straight to its campaign. Everyone else used to get
 * a card that said "scan the QR" and nothing else — which is fine for a player
 * holding a phone and useless for the GM, who had no in-app path at all and
 * was told to hand-write `localStorage['safehouse.session']`. This screen is
 * that missing path:
 *
 *   - **Your campaigns** — the list a returning GM actually wants. Sessions
 *     are keyed by (campaign, role) now, so every table this browser has ever
 *     been paired with is still here, and `GET /api/campaigns` names them and
 *     adds the ones this user belongs to but has no device for.
 *   - **Start a new campaign** — the bootstrap route, storing the GM token it
 *     returns. Works on a fresh install; on a server that already has a table
 *     the server answers 401 and we say so in plain words.
 *   - **Pair this device** — type/paste the GM pairing code (or the whole join
 *     URL off the QR) and redeem it here.
 *   - **Paste a device token** — the escape hatch for a token printed by
 *     `seed:demo` or `pnpm gm:token`, verified against the server before it is
 *     stored.
 *
 * Two things happen quietly on arrival. `GET /api/gm/recover` asks the machine
 * itself which campaigns it hosts: on the laptop running the server that fills
 * the list with tables this browser has no token for, and everywhere else it
 * refuses — the right answer for a player's phone, and therefore never
 * mentioned. It mints nothing; the device is issued when a row is tapped. And
 * a `?expired=1` bounce (a tab whose token the server rejected) suppresses the
 * auto-redirect, so a dead session cannot loop this screen back into the
 * campaign it just failed to open.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import type { Role } from '@safehouse/contracts';
import { ApiError } from '../../api/client.js';
import {
  fetchCampaignsForTokens,
  mergeCampaignCards,
  probeGmRecovery,
  rememberNames,
  type CampaignCard,
} from '../../api/my-campaigns.js';
import { getSession, listSessions, type Session } from '../../api/session.js';
import BuildBadge from './BuildBadge.js';
import CampaignPicker from './CampaignPicker.js';
import { useBootstrapCampaign, useAdoptPastedSession, useRedeemCode } from './signin-api.js';
import { destinationFor, normalizePairCode, parsePastedSession } from './signin.js';

const inputClass =
  'w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-faint focus:border-cyan focus:outline-none';

function Problem({ error }: { error: unknown }) {
  if (!error) return null;
  let message = error instanceof Error ? error.message : String(error);
  if (error instanceof ApiError) {
    if (error.status === 401) {
      message =
        'This server already has a campaign, so only a signed-in GM can start another. Pair this device instead.';
    } else if (error.status === 404 || error.code === 'invite_not_found') {
      message = 'No invite with that code. Ask for a fresh one — pairing codes expire in minutes.';
    } else if (error.code === 'invite_expired' || error.code === 'invite_exhausted') {
      message = 'That code is spent. Mint a new one from the GM console.';
    } else if (error.code === 'network_error') {
      message = 'Could not reach the table server. Same Wi-Fi as the laptop?';
    }
  }
  return (
    <p role="alert" className="mt-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
      {message}
    </p>
  );
}

function Tab({
  id,
  active,
  onSelect,
  children,
}: {
  id: string;
  active: boolean;
  onSelect: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`signin-tab-${id}`}
      aria-selected={active}
      aria-controls={`signin-panel-${id}`}
      className={`chip cursor-pointer ${active ? 'border-cyan text-cyan' : 'text-dim hover:text-ink'}`}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

/**
 * The empty front door, explained.
 *
 * A GM whose browser storage is gone gets here with nothing to pick up and
 * three tabs that all ask for something they do not have: a pairing code only
 * a live GM can mint, a bootstrap that 401s once a campaign exists, and a
 * campaign UUID nothing in the app would tell them. Before this note that was
 * a silent dead end.
 *
 * The reason it is empty is almost always the address. Coming back without a
 * secret works only over a genuinely local connection (`assertLoopbackOrigin`
 * on the server), so the LAN address the players use — the one a GM is most
 * likely to have bookmarked — refuses, and so does Docker, whose bridge
 * network makes the host indistinguishable from a phone on the venue Wi-Fi.
 * That refusal is correct; being unable to explain it was not.
 */
function NothingToResume() {
  // Same port, loopback host: the address that can answer, built from the one
  // that could not. Guarded because this renders without a DOM in tests.
  const here = typeof window === 'undefined' ? null : window.location;
  const localUrl =
    here && here.hostname !== 'localhost' && here.hostname !== '127.0.0.1'
      ? `${here.protocol}//localhost:${here.port || (here.protocol === 'https:' ? '443' : '80')}`
      : null;

  return (
    <section className="mt-6 text-left" data-testid="nothing-to-resume">
      <div className="mono-label">Nothing to pick up here</div>
      <p className="mt-2 text-xs text-dim">
        This server listed no campaigns for you. If nobody has started one yet,{' '}
        <strong className="font-normal text-ink">Start a campaign</strong> below is the answer. If
        you expected to see one, it is almost always the address:
      </p>
      <ul className="mt-2 space-y-1.5 text-xs text-dim">
        {localUrl && (
          <li>
            On that computer, open{' '}
            <a className="text-cyan underline" href={localUrl} data-testid="loopback-hint">
              {localUrl}
            </a>{' '}
            instead of this address — a LAN address is refused even on the right machine.
          </li>
        )}
        <li>
          Running in Docker, or on another computer? The container cannot tell your laptop from a
          player&rsquo;s phone, so it always refuses. Mint a token where the server lives:{' '}
          <code className="text-cyan">pnpm gm:token</code> (see the README for the Docker form),
          then paste it below.
        </li>
      </ul>
    </section>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const expired = params.get('expired') === '1';
  // "Show me the tables" — the front door reached on purpose rather than
  // because nothing was stored. Without it a browser holding one session can
  // never see the picker again, which is the whole point of an open table.
  const picking = params.get('pick') === '1';

  const session = getSession();
  const stored = listSessions();

  // One device on this browser: go straight in, as it always did. Two or more
  // (the GM's own laptop running a player view beside the console, or two
  // tables) and `/` becomes the chooser instead of guessing — every session is
  // still here either way. A recovered device never triggers this, because it
  // is not stored until the GM picks the table it belongs to.
  const autoEnter = session !== null && stored.length <= 1 && !expired && !picking;

  const [cards, setCards] = useState<CampaignCard[]>(() => mergeCampaignCards(stored, []));
  // Whether the two lookups below have answered yet. An empty list before they
  // have is 'we do not know'; after, it is a fact worth explaining.
  const [probed, setProbed] = useState(false);

  const [tab, setTab] = useState<'start' | 'pair' | 'token'>('pair');
  const [campaignName, setCampaignName] = useState('');
  const [gmName, setGmName] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [pasteCampaign, setPasteCampaign] = useState('');
  const [pasteRole, setPasteRole] = useState<Role>('gm');
  const [pasteError, setPasteError] = useState<string | null>(null);

  const bootstrap = useBootstrapCampaign();
  const redeem = useRedeemCode();
  const adopt = useAdoptPastedSession();

  useEffect(() => {
    if (autoEnter) return;
    let cancelled = false;

    void (async () => {
      const held = listSessions();
      // Two questions at once: what do this browser's tokens see, and — if
      // this is the machine hosting the server — what is on the box at all.
      // The second is silent on every other device, which is most of them,
      // and it mints nothing: a token is issued only when a row is tapped.
      const [listed, hosted] = await Promise.all([
        fetchCampaignsForTokens(held.map((s) => s.token)),
        probeGmRecovery(),
      ]);

      const named = [...listed, ...hosted];
      if (named.length > 0) rememberNames(named);
      if (cancelled) return;
      // Re-read the stored half: a token the server rejected on the way was
      // retired by `api/client.ts`, so the list must not still offer it.
      setCards(mergeCampaignCards(listSessions(), named));
      setProbed(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [autoEnter]);

  if (autoEnter && session) return <Navigate to={destinationFor(session)} replace />;

  const go = (s: Session) => navigate(destinationFor(s), { replace: true });

  const onStart = (e: FormEvent) => {
    e.preventDefault();
    const name = campaignName.trim();
    if (!name) return;
    bootstrap.mutate(
      { name, ...(gmName.trim() ? { gmName: gmName.trim() } : {}) },
      { onSuccess: go },
    );
  };

  const onPair = (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizePairCode(code);
    if (!normalized) {
      setCodeError('That does not look like a join code. Try the code, or the whole join URL.');
      return;
    }
    setCodeError(null);
    redeem.mutate(normalized, { onSuccess: go });
  };

  const onPaste = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parsePastedSession(paste, { campaignId: pasteCampaign, role: pasteRole });
    if (!parsed) {
      setPasteError('Paste the token JSON, or a token plus the campaign id.');
      return;
    }
    setPasteError(null);
    adopt.mutate(parsed, { onSuccess: go });
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-ground p-6 text-ink">
      <div className="panel w-full max-w-md p-8">
        <div className="text-center">
          <div className="font-label text-xl tracking-[0.35em] text-cyan">SAFEHOUSE</div>
          <p className="mt-2 text-sm text-dim">The place the team plans the run.</p>
        </div>

        {expired && (
          <p
            className="mt-5 rounded-md border border-edge-bright bg-deck px-3 py-2 text-xs text-dim"
            data-testid="session-expired-note"
            role="status"
          >
            That device was signed out by the server — a GM can revoke a device at any time. Pick
            a campaign below, or pair this device again.
          </p>
        )}

        {/* Above the tabs on purpose: a returning GM is here to re-enter a
            table, not to sign in again. */}
        <CampaignPicker cards={cards} />
        {probed && cards.length === 0 && <NothingToResume />}

        <div className="mt-6 flex justify-center gap-2" role="tablist" aria-label="How to sign in">
          <Tab id="pair" active={tab === 'pair'} onSelect={() => setTab('pair')}>
            Pair this device
          </Tab>
          <Tab id="start" active={tab === 'start'} onSelect={() => setTab('start')}>
            Start a campaign
          </Tab>
          <Tab id="token" active={tab === 'token'} onSelect={() => setTab('token')}>
            Paste a token
          </Tab>
        </div>

        {tab === 'pair' && (
          <form
            id="signin-panel-pair"
            role="tabpanel"
            aria-labelledby="signin-tab-pair"
            className="mt-5 space-y-3"
            onSubmit={onPair}
          >
            <p className="text-sm text-dim">
              Players scan the GM&apos;s QR. A second GM machine takes the pairing code from the GM
              console — it is single-use and expires in minutes.
            </p>
            <label className="block">
              <span className="mono-label block">Join or pairing code</span>
              <input
                className={`${inputClass} mt-1 font-label tracking-[0.2em]`}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ABCD2345"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-describedby="pair-help"
              />
            </label>
            <p id="pair-help" className="mono-label text-faint">
              The whole join URL works too.
            </p>
            <button className="btn btn-accent w-full" type="submit" disabled={redeem.isPending}>
              {redeem.isPending ? 'jacking in…' : 'pair this device'}
            </button>
            {codeError && (
              <p role="alert" className="text-xs text-danger">
                {codeError}
              </p>
            )}
            <Problem error={redeem.error} />
          </form>
        )}

        {tab === 'start' && (
          <form
            id="signin-panel-start"
            role="tabpanel"
            aria-labelledby="signin-tab-start"
            className="mt-5 space-y-3"
            onSubmit={onStart}
          >
            <p className="text-sm text-dim">
              First run on this server: this creates the campaign and signs this browser in as its
              GM. No password — the token lives on this device.
            </p>
            <label className="block">
              <span className="mono-label block">Campaign name</span>
              <input
                className={`${inputClass} mt-1`}
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Static on the Line"
                required
              />
            </label>
            <label className="block">
              <span className="mono-label block">Your name (optional)</span>
              <input
                className={`${inputClass} mt-1`}
                value={gmName}
                onChange={(e) => setGmName(e.target.value)}
                placeholder="GM"
              />
            </label>
            <button
              className="btn btn-accent w-full"
              type="submit"
              disabled={bootstrap.isPending || campaignName.trim().length === 0}
            >
              {bootstrap.isPending ? 'building the safehouse…' : 'start a new campaign'}
            </button>
            <Problem error={bootstrap.error} />
          </form>
        )}

        {tab === 'token' && (
          <form
            id="signin-panel-token"
            role="tabpanel"
            aria-labelledby="signin-tab-token"
            className="mt-5 space-y-3"
            onSubmit={onPaste}
          >
            <p className="text-sm text-dim">
              For a token printed by <code className="text-cyan">pnpm gm:token</code>,{' '}
              <code className="text-cyan">seed:demo</code>, or the bootstrap response. It is
              checked against the server before anything is stored.
            </p>
            <label className="block">
              <span className="mono-label block">Device token (or the whole JSON blob)</span>
              <textarea
                className={`${inputClass} mt-1 h-20 resize-y font-label text-xs`}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder='{"token":"…","role":"gm","campaignId":"…"}'
                spellCheck={false}
              />
            </label>
            <div className="flex gap-2">
              <label className="min-w-0 flex-1">
                <span className="mono-label block">Campaign id</span>
                <input
                  className={`${inputClass} mt-1`}
                  value={pasteCampaign}
                  onChange={(e) => setPasteCampaign(e.target.value)}
                  placeholder="uuid"
                />
              </label>
              <label className="shrink-0">
                <span className="mono-label block">Role</span>
                <select
                  className={`${inputClass} mt-1 w-auto`}
                  value={pasteRole}
                  onChange={(e) => setPasteRole(e.target.value as Role)}
                  aria-label="Role for this token"
                >
                  <option value="gm">gm</option>
                  <option value="player">player</option>
                  <option value="observer">observer</option>
                  <option value="display">display</option>
                </select>
              </label>
            </div>
            <button className="btn btn-accent w-full" type="submit" disabled={adopt.isPending}>
              {adopt.isPending ? 'checking the token…' : 'use this token'}
            </button>
            {pasteError && (
              <p role="alert" className="text-xs text-danger">
                {pasteError}
              </p>
            )}
            <Problem error={adopt.error} />
          </form>
        )}
      </div>
      {/* Which build this server is — before anyone signs in, so "is this the latest?" needs no token. */}
      <BuildBadge className="mt-4 text-center" />
    </main>
  );
}

/**
 * `/` — the front door (FR1.1/1.2; BUILD_REPORT gap #2).
 *
 * A joined device bounces straight to its campaign. Everyone else used to get
 * a card that said "scan the QR" and nothing else — which is fine for a player
 * holding a phone and useless for the GM, who had no in-app path at all and
 * was told to hand-write `localStorage['safehouse.session']`. This screen is
 * that missing path:
 *
 *   - **Start a new campaign** — the bootstrap route, storing the GM token it
 *     returns. Works on a fresh install; on a server that already has a table
 *     the server answers 401 and we say so in plain words.
 *   - **Pair this device** — type/paste the GM pairing code (or the whole join
 *     URL off the QR) and redeem it here.
 *   - **Paste a device token** — the escape hatch for a token printed by
 *     `seed:demo`, verified against the server before it is stored.
 *
 * Sessions are stored per role (see `api/session.ts`), so pairing a player view
 * on the same laptop no longer signs the GM out.
 */
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { Role } from '@safehouse/contracts';
import { ApiError } from '../../api/client.js';
import { getSession, listSessions, switchSession, type Session } from '../../api/session.js';
import {
  resetClientState,
  useAdoptPastedSession,
  useBootstrapCampaign,
  useRedeemCode,
} from './signin-api.js';
import { destinationFor, normalizePairCode, parsePastedSession, roleLabel } from './signin.js';

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

/** Devices already stored in this browser — one tap back into any of them. */
function StoredSessions({ sessions, onPick }: { sessions: Session[]; onPick: (role: Role) => void }) {
  if (sessions.length === 0) return null;
  return (
    <div className="mt-6 border-t border-edge pt-4 text-left">
      <div className="mono-label">Already paired on this browser</div>
      <ul className="mt-2 space-y-1.5">
        {sessions.map((s) => (
          <li key={s.role}>
            <button
              type="button"
              className="btn w-full justify-between px-3 py-1.5"
              aria-label={`Continue as ${roleLabel(s.role)}${s.displayName ? ` (${s.displayName})` : ''}`}
              onClick={() => onPick(s.role)}
            >
              <span>{roleLabel(s.role)}</span>
              <span className="mono-label text-faint">{s.displayName ?? s.campaignId.slice(0, 8)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const session = getSession();
  const stored = listSessions();

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

  // One device on this browser: go straight in, as it always did. Two or more
  // (the GM's own laptop running a player view beside the console) and `/`
  // becomes the chooser instead of guessing — the sessions are all still here.
  if (session && stored.length <= 1) return <Navigate to={destinationFor(session)} replace />;

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
    <main className="flex min-h-dvh items-center justify-center bg-ground p-6 text-ink">
      <div className="panel w-full max-w-md p-8">
        <div className="text-center">
          <div className="font-label text-xl tracking-[0.35em] text-cyan">SAFEHOUSE</div>
          <p className="mt-2 text-sm text-dim">The place the team plans the run.</p>
        </div>

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
              GM. No password — the token lives on this device (FR1.1).
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
              For a token printed by <code className="text-cyan">seed:demo</code> or the bootstrap
              response. It is checked against the server before anything is stored.
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

        <StoredSessions
          sessions={stored}
          onPick={(role) => {
            const picked = switchSession(role);
            resetClientState();
            if (picked) go(picked);
          }}
        />
      </div>
    </main>
  );
}

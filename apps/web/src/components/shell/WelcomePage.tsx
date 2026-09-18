/**
 * `/c/:campaignId/welcome` — a joining player's first stop (onboarding).
 *
 * The join screen sends a new player here once they have named themselves.
 * They leave with a runner, one of three ways:
 *
 *   - **pick** a runner nobody plays yet (`POST /api/characters/:id/claim` —
 *     the server refuses a sheet someone holds, or a player who holds one);
 *   - **upload** a Chummer5a `.chum5` (`POST /api/characters`, theirs on
 *     arrival; its karma/nuyen wait for the GM as pending ledger entries);
 *   - **build** one in the native builder, which the GM approves.
 *
 * The GM can still move any runner to anyone from the Party roster; nothing
 * here is final. A player who already has a sheet is sent straight to it.
 */
import { useRef, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMe } from '../../api/campaigns.js';
import { getSession } from '../../api/session.js';
import { BuildRunnerButton } from '../../features/build/entry.js';
import { useClaimCharacter, useCreateCharacter, useRoster } from '../../features/gm/home/api.js';

function errorText(err: unknown): string | null {
  if (!err) return null;
  return err instanceof Error ? err.message : String(err);
}

function Section({ title, blurb, children }: { title: string; blurb: string; children: ReactNode }) {
  return (
    <section className="panel p-4">
      <div className="font-label text-sm uppercase tracking-widest text-cyan">{title}</div>
      <p className="mt-1 text-sm text-dim">{blurb}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function WelcomePage() {
  const { campaignId = '' } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const me = useMe();
  const roster = useRoster(campaignId);
  const claim = useClaimCharacter(campaignId);
  const upload = useCreateCharacter(campaignId);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const home = `/c/${campaignId}`;
  const openSheet = (id: string | undefined) => navigate(id ? `${home}/sheet/${id}` : home, { replace: true });

  // Onboarding is a player's; anyone else (or a player who already has a
  // runner, say the GM handed one over) goes where they would have anyway.
  if (getSession()?.role !== 'player') return <Navigate to={home} replace />;
  if (me.data?.characterId) return <Navigate to={`${home}/sheet/${me.data.characterId}`} replace />;

  const open = (roster.data ?? []).filter(
    (c) => !c.ownerUserId && (c.status ?? 'active') === 'active',
  );
  const busy = claim.isPending || upload.isPending;

  return (
    <div className="mx-auto max-w-lg space-y-3 p-4" data-testid="player-welcome">
      <div>
        <div className="mono-label">Welcome{me.data ? `, ${me.data.user.displayName}` : ''}</div>
        <h1 className="mt-1 text-lg font-semibold">Who are you running?</h1>
        <p className="mt-1 text-sm text-dim">
          Pick a runner, bring your own, or build a new one. The GM can reassign runners at any time.
        </p>
      </div>

      <Section title="Pick a runner" blurb="Runners the GM has made that nobody plays yet.">
        {roster.isLoading ? (
          <p className="text-sm text-faint">Checking the roster…</p>
        ) : open.length === 0 ? (
          <p className="text-sm text-faint" data-testid="no-open-runners">
            None free right now.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {open.map((c) => {
              const alias = c.sheet?.identity?.alias || c.name || 'Unnamed runner';
              const metatype = c.sheet?.identity?.metatype;
              return (
                <li key={c.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {alias}
                    {metatype && <span className="text-faint"> · {metatype}</span>}
                  </span>
                  <button
                    type="button"
                    className="btn shrink-0 px-3 py-1.5"
                    disabled={busy}
                    onClick={() => claim.mutate(c.id, { onSuccess: (r) => openSheet(r.characterId) })}
                  >
                    play {alias}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {claim.error && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {errorText(claim.error)}
          </p>
        )}
      </Section>

      <Section
        title="Bring your own"
        blurb="Upload a Chummer5a .chum5 file. Its karma and nuyen wait for the GM to approve."
      >
        <button type="button" className="btn px-3 py-1.5" disabled={busy} onClick={() => fileRef.current?.click()}>
          {upload.isPending ? 'uploading…' : 'upload .chum5'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".chum5,.xml,text/xml,application/xml"
          className="hidden"
          aria-label="Chummer5a character file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) upload.mutate({ file }, { onSuccess: (rec) => openSheet(rec.id) });
          }}
        />
        {upload.error && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {errorText(upload.error)}
          </p>
        )}
      </Section>

      <Section title="Build a new one" blurb="Step by step, checked as you go. The GM approves it before it plays.">
        <div className="flex flex-wrap gap-2">
          <BuildRunnerButton campaignId={campaignId} className="btn btn-accent px-3 py-1.5" />
        </div>
      </Section>

      <Link to={home} className="mono-label inline-flex min-h-10 items-center text-dim hover:text-cyan">
        skip for now
      </Link>
    </div>
  );
}

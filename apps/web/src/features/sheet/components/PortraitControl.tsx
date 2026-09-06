/**
 * The picture that stands for this runner on the battle map (FR9.4).
 *
 * One control, two audiences. A player uses it on their own sheet; the GM uses
 * the same one on anybody's, because a GM can already open any sheet in the
 * campaign and building them a second, separate uploader would be two things
 * to keep in step for no gain. `canEditCharacter` mirrors the server's
 * owner-or-GM rule, so somebody looking at a sheet they cannot change sees the
 * portrait and no buttons rather than a control that 403s.
 *
 * Deliberately shows the token as the MAP will draw it — a circle, cropped to
 * a circle — because a portrait that looks right in a rectangle and loses the
 * subject's head to the crop is the failure this preview exists to prevent.
 */
import { useRef, useState } from 'react';
import { fileUrl } from '../../grid/api.js';
import { canEditCharacter, useClearPortrait, useUploadPortrait } from '../api.js';

/** What the server will take. Mirrored into `accept` so the picker filters. */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/**
 * The server's own cap. Checked here too so an oversized file is refused
 * instantly with a sentence, rather than after a slow upload with a status
 * code — which on a phone over a house wifi is a genuinely different feeling.
 */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Just the face — no hooks, no fetching, usable anywhere a runner is named.
 *
 * Split out because the GM console's overview wants the picture and nothing
 * else: the avatar plus an upload button cost enough width there to start
 * truncating the names, and an overview that cannot show you who is on the
 * crew has traded the wrong thing away. Managing portraits belongs on the
 * party page and the sheet, which both have room to say what they are doing.
 *
 * Circular, because that is how the map draws a token: a portrait that reads
 * well in a rectangle and loses the subject's head to the crop is exactly what
 * this preview exists to catch.
 */
export function PortraitAvatar({
  portraitId,
  label,
  size = 'h-14 w-14',
  text = 'text-lg',
}: {
  portraitId: string | null;
  label: string;
  size?: string;
  text?: string;
}) {
  return (
    <span
      className={`relative ${size} block shrink-0 overflow-hidden rounded-full border border-edge bg-raised`}
    >
      {portraitId === null ? (
        <span
          className={`grid h-full w-full place-items-center font-semibold text-dim ${text}`}
          aria-hidden
        >
          {(label || '?').charAt(0).toUpperCase()}
        </span>
      ) : (
        <img src={fileUrl(portraitId)} alt={`${label}'s token`} className="h-full w-full object-cover" />
      )}
    </span>
  );
}

/**
 * The minimum a portrait needs to know about whose it is.
 *
 * Structural rather than a `CharacterRecord`, because the two places this
 * appears hold different shapes of the same person: the sheet has the whole
 * record, the GM's party roster has a `PartyMember`. Asking for only these
 * five fields lets one component serve both without either of them
 * manufacturing a record it does not have.
 */
export interface PortraitSubject {
  id: string;
  /** Falls back to the initial when there is no picture. */
  name: string;
  /** What the table calls them, when that differs from the name. */
  alias?: string | undefined;
  ownerUserId?: string | null | undefined;
  portraitId: string | null;
}

export interface PortraitControlProps {
  subject: PortraitSubject;
  /** Compact: just the picture and a smaller button, for a dense roster row. */
  compact?: boolean;
}

export default function PortraitControl({ subject, compact = false }: PortraitControlProps) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const upload = useUploadPortrait(subject.id);
  const clear = useClearPortrait(subject.id);

  const mayEdit = canEditCharacter(subject);
  const portraitId = subject.portraitId;
  const busy = upload.isPending || clear.isPending;
  const label = subject.alias || subject.name || '?';
  const size = compact ? 'h-9 w-9' : 'h-14 w-14';

  const pick = (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setProblem(`That file is ${Math.round(file.size / 1024 / 1024)} MB — the limit is 25 MB.`);
      return;
    }
    upload.mutate(file, {
      onError: (err: unknown) => {
        setProblem(err instanceof Error ? err.message : 'The upload did not go through.');
      },
    });
  };

  return (
    <div className={`flex items-center ${compact ? 'gap-1.5' : 'gap-3'}`}>
      <span className="relative">
        <PortraitAvatar
          portraitId={portraitId}
          label={label}
          size={size}
          text={compact ? 'text-sm' : 'text-lg'}
        />
        {busy && (
          <span className="absolute inset-0 grid place-items-center rounded-full bg-ground/70 text-[0.6rem] text-cyan">
            …
          </span>
        )}
      </span>

      {mayEdit && (
        <div className="min-w-0">
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="hidden"
            data-testid="portrait-file"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              // Let the same file be chosen again after a failure.
              e.target.value = '';
            }}
          />
          {compact ? (
            /*
             * ONE button, always the same width, whether or not there is a
             * picture yet. A roster is a column of rows and the eye reads down
             * the names: a control that grows from one button to two when a
             * runner gets a face pushes that row's name sideways and the
             * column stops being a column. Removing a portrait is rare and
             * lives on the sheet, where there is room to say so.
             */
            <button
              type="button"
              className="btn h-7 w-7 p-0 text-xs"
              disabled={busy}
              title={portraitId === null ? `Set ${label}'s token image` : `Change ${label}'s token image`}
              aria-label={portraitId === null ? `Set ${label}'s token image` : `Change ${label}'s token image`}
              data-testid="portrait-set"
              onClick={() => input.current?.click()}
            >
              <span aria-hidden>▣</span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                className="btn px-2 py-1 text-xs"
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                {portraitId === null ? 'add token image' : 'replace'}
              </button>
              {portraitId !== null && (
                <button
                  type="button"
                  className="btn px-2 py-1 text-xs text-dim"
                  disabled={busy}
                  onClick={() => {
                    setProblem(null);
                    clear.mutate();
                  }}
                >
                  remove
                </button>
              )}
            </div>
          )}
          {problem !== null && (
            <p role="alert" className="mt-1 text-[0.7rem] text-danger">
              {problem}
            </p>
          )}
          {problem === null && !compact && upload.data !== undefined && upload.data.tokens > 0 && (
            // Say it out loud: the interesting part is that it reached the map,
            // not that a file was stored.
            <p className="mt-1 text-[0.7rem] text-dim">
              {upload.data.tokens === 1
                ? 'Updated the token already on the map.'
                : `Updated ${upload.data.tokens} tokens already on the map.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

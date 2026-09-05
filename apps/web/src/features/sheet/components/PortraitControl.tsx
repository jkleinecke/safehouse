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
import {
  canEditCharacter,
  useClearPortrait,
  useUploadPortrait,
  type CharacterRecord,
} from '../api.js';

/** What the server will take. Mirrored into `accept` so the picker filters. */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/**
 * The server's own cap. Checked here too so an oversized file is refused
 * instantly with a sentence, rather than after a slow upload with a status
 * code — which on a phone over a house wifi is a genuinely different feeling.
 */
const MAX_BYTES = 25 * 1024 * 1024;

export interface PortraitControlProps {
  character: CharacterRecord;
}

export default function PortraitControl({ character }: PortraitControlProps) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const upload = useUploadPortrait(character.id);
  const clear = useClearPortrait(character.id);

  const mayEdit = canEditCharacter(character);
  const portraitId = character.sheet.identity.portraitId ?? null;
  const busy = upload.isPending || clear.isPending;
  const initial = (character.sheet.identity.alias || character.name || '?')
    .charAt(0)
    .toUpperCase();

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
    <div className="flex items-center gap-3">
      <div
        className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border border-edge bg-raised"
        aria-hidden={portraitId === null}
      >
        {portraitId === null ? (
          <span className="grid h-full w-full place-items-center text-lg font-semibold text-dim">
            {initial}
          </span>
        ) : (
          <img
            src={fileUrl(portraitId)}
            alt={`${character.sheet.identity.alias || character.name}'s token`}
            className="h-full w-full object-cover"
          />
        )}
        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-ground/70 text-[0.6rem] text-cyan">
            …
          </span>
        )}
      </div>

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
          {problem !== null && (
            <p role="alert" className="mt-1 text-[0.7rem] text-danger">
              {problem}
            </p>
          )}
          {problem === null && upload.data !== undefined && upload.data.tokens > 0 && (
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

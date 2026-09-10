/**
 * The door into an empty campaign (FR3.1).
 *
 * `POST /api/characters` has accepted a blank sheet and a Chummer5a `.chum5`
 * since M3 and nothing in the browser had ever called it, so a GM who started a
 * fresh campaign got a world with no characters in it and no way to make one —
 * `pnpm seed:demo` was the only thing that had ever created a character. This
 * is that missing control, and it is deliberately the empty roster's call to
 * action rather than a screen of its own.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorNote, inputClass } from '../ui.js';
import { useCreateCharacter } from './api.js';

export interface AddCharacterProps {
  campaignId: string;
  /** Jump to the new sheet once it exists (the usual next thing). */
  openOnCreate?: boolean;
  onCreated?: (characterId: string) => void;
}

export default function AddCharacter({
  campaignId,
  openOnCreate = true,
  onCreated,
}: AddCharacterProps) {
  const navigate = useNavigate();
  const create = useCreateCharacter(campaignId);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const landed = (id: string | undefined, message: string) => {
    setNote(message);
    if (id) {
      onCreated?.(id);
      if (openOnCreate) navigate(`/c/${campaignId}/sheet/${id}`);
    }
  };

  return (
    <div data-testid="add-character" className="text-left">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mono-label block">Street name</span>
          <input
            className={`${inputClass} mt-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Torque"
            aria-label="New character street name"
          />
        </label>
        <button
          type="button"
          className="btn btn-accent shrink-0 px-3 py-1.5"
          disabled={create.isPending}
          onClick={() =>
            create.mutate(
              { name: name.trim() || 'New runner' },
              { onSuccess: (rec) => landed(rec?.id, `created ${rec?.name ?? name}`) },
            )
          }
        >
          {create.isPending ? 'creating…' : 'new blank sheet'}
        </button>
        <button
          type="button"
          className="btn shrink-0 px-3 py-1.5"
          disabled={create.isPending}
          onClick={() => fileRef.current?.click()}
        >
          import .chum5
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
            if (!file) return;
            create.mutate(
              { file, ...(name.trim() ? { name: name.trim() } : {}) },
              { onSuccess: (rec) => landed(rec?.id, `imported ${rec?.name ?? file.name}`) },
            );
          }}
        />
      </div>
      <p className="mono-label mt-2 text-faint">
        Chummer's karma and nuyen land as opening ledger entries, not sheet numbers.
      </p>
      {note && <p className="mono-label mt-1 text-ok">{note}</p>}
      <ErrorNote error={create.error} />
    </div>
  );
}

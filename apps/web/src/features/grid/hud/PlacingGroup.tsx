/**
 * What the GM is placing, and which tile of it — one control per kind of
 * thing (`subjects.ts` for the three steps the row reads in).
 *
 * Each subject is a split button: press the face to start laying that kind of
 * thing, press the caret beside it to pick which one. Ground, then concrete;
 * Wall, then chain-link. The two used to be separate steps — a row of
 * subjects and then one dropdown beside it — which asked the GM to look in
 * two places to answer what is really one question, and left that dropdown
 * showing tiles for whichever subject happened to be in hand.
 *
 * Select is not here at all: it lays nothing, so it is a tool rather than a
 * subject, and it stands on its own at the head of the row.
 *
 * Nothing is stored twice: the armed tile is the store's `tileId`, the same
 * field the panel's palette writes, so the row and the palette cannot drift
 * apart.
 */
import { useEffect, useRef, useState } from 'react';
import { useTilesets, type TileDef, type TilesetDef } from '../api.js';
import { useGridStore } from '../store.js';
import { categoryOf } from '../tileCategories.js';
import Swatch from '../gm/Swatch.js';
import HudButton, { HudIcon } from './HudButton.js';
import { SUBJECTS, subjectOf, tileIsSubject, type SubjectDef } from './subjects.js';

/** The tiles a subject may lay, in the set's own order. */
export function tilesFor(tileset: TilesetDef | undefined, subject: SubjectDef | undefined): TileDef[] {
  if (!tileset) return [];
  return tileset.tiles.filter((t) => tileIsSubject(subject, t, categoryOf));
}

/** What is armed, for the button's tooltip: the tile's name, or Auto. */
export function armedLabel(tileset: TilesetDef | undefined, tileId: string | null): string {
  if (!tileset || tileId === null) return 'Auto';
  return tileset.tiles.find((t) => t.id === tileId)?.name ?? 'Auto';
}

export default function PlacingGroup() {
  const { data: tilesets = [] } = useTilesets();
  const tool = useGridStore((s) => s.tool);
  const tilesetId = useGridStore((s) => s.tilesetId);
  const tileId = useGridStore((s) => s.tileId);
  const tileCategory = useGridStore((s) => s.tileCategory);
  const setTileId = useGridStore((s) => s.setTileId);
  const setTileCategory = useGridStore((s) => s.setTileCategory);

  const tileset = tilesets.find((t) => t.id === tilesetId) ?? tilesets[0];
  const armedKind = tileset?.tiles.find((t) => t.id === tileId)?.kind;
  const current = subjectOf(tool, tileCategory, armedKind);

  /**
   * Start laying this kind of thing. The category goes first — setting it
   * clears the armed tile and hands over a tool that can lay the new kind —
   * and only the split category needs a tile afterwards, to say which half of
   * `building` this is.
   */
  const pick = (subject: SubjectDef) => {
    setTileCategory(subject.category);
    if (subject.kinds && tileset) {
      const first = tilesFor(tileset, subject)[0];
      if (first) setTileId(first.id);
    }
  };

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Placing">
      {SUBJECTS.map((s) => (
        <SubjectControl
          key={s.id}
          subject={s}
          active={current === s.id}
          tileset={tileset}
          tileId={tileId}
          onPick={() => pick(s)}
          onTile={(tile) => {
            pick(s);
            setTileId(tile?.id ?? null);
          }}
        />
      ))}
    </div>
  );
}

function SubjectControl({
  subject,
  active,
  tileset,
  tileId,
  onPick,
  onTile,
}: {
  subject: SubjectDef;
  active: boolean;
  tileset: TilesetDef | undefined;
  tileId: string | null;
  onPick: () => void;
  onTile: (tile: TileDef | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // A menu left open is a menu over the map: it covers the thing the GM is
  // about to drag on.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const tiles = tilesFor(tileset, subject);
  const armed = active ? tiles.find((t) => t.id === tileId) : undefined;
  const hasMenu = tiles.length > 0;
  const title = active && hasMenu ? subject.label + ': ' + armedLabel(tileset, armed?.id ?? null) : subject.label;

  return (
    <div ref={boxRef} className="relative flex items-center">
      <HudButton
        active={active}
        title={title}
        testId={'placing-' + subject.id}
        onClick={onPick}
        className={hasMenu ? 'rounded-r-none' : ''}
      >
        {/*
          The armed tile on the face of the button it belongs to: once the GM
          has picked chain-link, the Wall button is chain-link.
        */}
        {armed && tileset ? (
          <Swatch set={tileset} tile={armed} size="h-5 w-5" />
        ) : (
          <HudIcon>{subject.glyph}</HudIcon>
        )}
      </HudButton>

      {hasMenu && (
        <button
          type="button"
          data-testid={'placing-menu-' + subject.id}
          title={'Pick a ' + subject.label.toLowerCase()}
          aria-label={'Pick a ' + subject.label.toLowerCase()}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            onPick();
            setOpen((o) => !o);
          }}
          className="btn -ml-px rounded-l-none px-1 py-1.5 text-[0.6rem] text-dim"
        >
          <span aria-hidden>▾</span>
        </button>
      )}

      {open && tileset && (
        <div
          role="menu"
          data-testid={'placing-open-' + subject.id}
          aria-label={subject.label}
          className="absolute left-0 top-full z-30 mt-1 max-h-80 w-56 overflow-y-auto rounded-lg border border-edge bg-panel p-1 shadow-lg"
        >
          {/*
            Auto first: with nothing pinned the engine reads the square — its
            ground, the walls around it — and lays what belongs, which is a
            better answer more often than any one tile a GM would pin.
          */}
          <Row
            selected={armed === undefined}
            name="Auto"
            note="reads the square"
            onClick={() => {
              onTile(null);
              setOpen(false);
            }}
            swatch={
              <span
                aria-hidden
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-dashed border-cyan text-sm"
              >
                ✦
              </span>
            }
          />
          {tiles.map((t) => (
            <Row
              key={t.id}
              selected={armed?.id === t.id}
              name={t.name}
              note={t.hint}
              onClick={() => {
                onTile(t);
                setOpen(false);
              }}
              swatch={<Swatch set={tileset} tile={t} size="h-8 w-8" />}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  selected,
  name,
  note,
  swatch,
  onClick,
}: {
  selected: boolean;
  name: string;
  note?: string | undefined;
  swatch: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      data-tile-name={name}
      title={note ?? name}
      onClick={onClick}
      className={
        'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs ' +
        (selected ? 'bg-raised text-cyan' : 'text-ink hover:bg-raised/60')
      }
    >
      {swatch}
      <span className="min-w-0 truncate">{name}</span>
    </button>
  );
}

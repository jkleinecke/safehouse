/**
 * `/c/:campaignId/gm/scenes` — the scene MANAGER.
 *
 * An earlier revision of this file was a placeholder arguing the route should be
 * deleted because scene authoring already lives in the Grid's GM panel. That is
 * half right and it was the wrong conclusion. The Grid panel is an in-canvas
 * tool: it does drawing beautifully and does the LIST badly — a one-line-per-
 * scene switcher with no map preview, no token count, no fog inventory, no
 * rename, no duplicate, no delete, and an environment editor you can only reach
 * by first putting a scene on screen. A GM prepping Friday's session is doing
 * list work, and clicking the sidebar entry named after the feature must land
 * on it.
 *
 * So the division of labour is explicit, and every card says it out loud:
 *   here  — inventory, create, duplicate, rename, archive, delete, ACTIVATE for
 *           the table, environment (FR9.11), staged fog reveals (FR9.14);
 *   Grid  — walls, doors, zones, pins, painting fog, placing and dragging
 *           tokens, map rotation/crop/contrast and grid calibration.
 *
 * Hydration: the list is a REST read on mount (LIVE-1). Live events only
 * invalidate it — nothing on this screen is drawn from the event stream alone.
 */
import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Scene, SceneEnvironment } from '@safehouse/contracts';
import { useGridStore } from '../grid/store.js';
import CreateSceneForm, { type CreateSceneSubmit } from './scenes/CreateSceneForm.js';
import SceneCard, { type SceneBusy } from './scenes/SceneCard.js';
import {
  useActivateScene,
  useCreateScene,
  useDeleteScene,
  useDuplicateScene,
  useFogOp,
  usePatchScene,
  useSceneTokenCounts,
  useScenes,
  useScenesLiveSync,
  useUploadMapImage,
} from './scenes/api.js';
import {
  duplicateName,
  sceneCounts,
  sortScenes,
  summarizeScene,
  type EnvAxis,
} from './scenes/summary.js';
import { ErrorNote, GmGuard, SectionTitle, Spinner } from './ui.js';

interface BusyState {
  sceneId: string;
  kind: NonNullable<SceneBusy>;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function ScenesPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const scenesQuery = useScenes(campaignId);
  useScenesLiveSync(campaignId);

  const create = useCreateScene(campaignId);
  const patch = usePatchScene(campaignId);
  const activate = useActivateScene(campaignId);
  const remove = useDeleteScene(campaignId);
  const duplicate = useDuplicateScene(campaignId);
  const fog = useFogOp(campaignId);
  const upload = useUploadMapImage();

  const [busy, setBusy] = useState<BusyState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** Unsaved GM-note edits by scene id (nothing is written until "save notes"). */
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const all = useMemo(() => sortScenes(scenesQuery.data ?? []), [scenesQuery.data]);
  const counts = useMemo(() => sceneCounts(all), [all]);
  const working = useMemo(() => all.filter((s) => s.state !== 'archived'), [all]);
  const archived = useMemo(() => all.filter((s) => s.state === 'archived'), [all]);
  const liveScene = all.find((s) => s.state === 'active') ?? null;

  const sceneIds = useMemo(() => all.map((s) => s.id), [all]);
  const tokenCounts = useSceneTokenCounts(sceneIds);

  const setError = useCallback((sceneId: string, err: unknown) => {
    setErrors((prev) => ({ ...prev, [sceneId]: message(err) }));
  }, []);

  const clearError = useCallback((sceneId: string) => {
    setErrors((prev) => {
      if (!prev[sceneId]) return prev;
      const next = { ...prev };
      delete next[sceneId];
      return next;
    });
  }, []);

  /** Run one card-scoped mutation with its own busy flag and error slot. */
  const run = useCallback(
    async (sceneId: string, kind: NonNullable<SceneBusy>, fn: () => Promise<unknown>) => {
      setBusy({ sceneId, kind });
      clearError(sceneId);
      try {
        await fn();
      } catch (err) {
        setError(sceneId, err);
      } finally {
        setBusy(null);
      }
    },
    [clearError, setError],
  );

  const onCreate = useCallback(
    async (input: CreateSceneSubmit) => {
      setCreating(true);
      setCreateError(null);
      try {
        const mapAttachmentIds: string[] = [];
        if (input.file) {
          const attachment = await upload.mutateAsync(input.file);
          mapAttachmentIds.push(attachment.id);
        }
        const scene = await create.mutateAsync({
          name: input.name,
          grid: { unitM: input.unitM, cols: input.cols, rows: input.rows, offset: { x: 0, y: 0 } },
          ...(mapAttachmentIds.length > 0 ? { mapAttachmentIds } : {}),
        });
        if (input.activate) await activate.mutateAsync(scene.id);
      } catch (err) {
        setCreateError(message(err));
      } finally {
        setCreating(false);
      }
    },
    [activate, create, upload],
  );

  /**
   * "Open in Grid" hands the canvas the scene the GM was just looking at. For
   * the live scene that means *following* the table (viewSceneId null), so a
   * later activation from anywhere still moves this GM's canvas with it; for
   * any other scene it means staging it privately, which is exactly what
   * FR9.1's staging is for.
   */
  const onOpenInGrid = useCallback((scene: Scene) => {
    useGridStore.getState().setViewSceneId(scene.state === 'active' ? null : scene.id);
  }, []);

  const existingNames = useMemo(() => all.map((s) => s.name), [all]);

  const renderCard = (scene: Scene) => {
    const summary = summarizeScene(scene, tokenCounts[scene.id] ?? null);
    const cardBusy: SceneBusy = busy && busy.sceneId === scene.id ? busy.kind : null;
    const savedNotes = scene.notes ?? '';
    const notesValue = notes[scene.id] ?? savedNotes;
    return (
      <SceneCard
        key={scene.id}
        scene={scene}
        summary={summary}
        gridHref={`/c/${campaignId}/grid`}
        busy={cardBusy}
        renameDraft={renameId === scene.id ? renameDraft : null}
        confirmingDelete={confirmDeleteId === scene.id}
        error={errors[scene.id] ?? null}
        onActivate={() => void run(scene.id, 'activate', () => activate.mutateAsync(scene.id))}
        onOpenInGrid={() => onOpenInGrid(scene)}
        onStartRename={() => {
          setRenameId(scene.id);
          setRenameDraft(scene.name);
        }}
        onRenameDraft={setRenameDraft}
        onCancelRename={() => setRenameId(null)}
        onCommitRename={() => {
          const name = renameDraft.trim();
          setRenameId(null);
          if (!name || name === scene.name) return;
          void run(scene.id, 'rename', () =>
            patch.mutateAsync({ sceneId: scene.id, patch: { name } }),
          );
        }}
        onDuplicate={() =>
          void run(scene.id, 'duplicate', () =>
            duplicate.mutateAsync({
              source: scene,
              name: duplicateName(scene.name, existingNames),
            }),
          )
        }
        onArchive={() =>
          void run(scene.id, 'archive', () =>
            patch.mutateAsync({ sceneId: scene.id, patch: { state: 'archived' } }),
          )
        }
        onRestore={() =>
          void run(scene.id, 'archive', () =>
            patch.mutateAsync({ sceneId: scene.id, patch: { state: 'draft' } }),
          )
        }
        onAskDelete={() => setConfirmDeleteId(scene.id)}
        onCancelDelete={() => setConfirmDeleteId(null)}
        onConfirmDelete={() =>
          void run(scene.id, 'delete', async () => {
            await remove.mutateAsync(scene.id);
            setConfirmDeleteId(null);
          })
        }
        onEnvChange={(axis: EnvAxis, level: number) => {
          const environment: SceneEnvironment = { ...scene.environment, [axis]: level };
          void run(scene.id, 'save', () =>
            patch.mutateAsync({ sceneId: scene.id, patch: { environment } }),
          );
        }}
        onFog={(regionId, reveal) =>
          void run(scene.id, 'save', () =>
            fog.mutateAsync({
              sceneId: scene.id,
              op: reveal ? 'reveal' : 'hide',
              regionId,
              ...(reveal ? { announce: true } : {}),
            }),
          )
        }
        onRefogAll={() =>
          void run(scene.id, 'save', () => fog.mutateAsync({ sceneId: scene.id, op: 'hide' }))
        }
        notesValue={notesValue}
        notesDirty={notesValue !== savedNotes}
        onNotesDraft={(next) => setNotes((prev) => ({ ...prev, [scene.id]: next }))}
        onSaveNotes={() =>
          void run(scene.id, 'save', () =>
            patch.mutateAsync({ sceneId: scene.id, patch: { notes: notesValue } }),
          )
        }
      />
    );
  };

  const loaded = scenesQuery.data !== undefined;

  return (
    <GmGuard>
      <div className="p-6">
        <SectionTitle hint="M9 — the list; drawing lives in the Grid">Scenes</SectionTitle>
        <h1 className="mt-1 text-lg font-semibold">Scene manager</h1>

        {/* `isPending` (not `isLoading`) — before the read lands the screen must
            say so, never "no scenes yet". */}
        {scenesQuery.isPending && (
          <div className="mt-6">
            <Spinner label="loading scenes" />
          </div>
        )}
        <ErrorNote error={scenesQuery.error} />

        {loaded && all.length > 0 && (
          <div
            className="panel mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 p-3"
            data-testid="scenes-summary"
          >
            <span className="mono-label">
              {`${counts.total} scene${counts.total === 1 ? '' : 's'}`}
            </span>
            <span className="mono-label text-faint">{`${counts.drafts} staged`}</span>
            {counts.archived > 0 && (
              <span className="mono-label text-faint">{`${counts.archived} archived`}</span>
            )}
            {liveScene ? (
              <span className="chip border-ok/50 text-ok" data-testid="live-scene-banner">
                {`on the table · ${liveScene.name}`}
              </span>
            ) : (
              <span className="chip border-warn/50 text-warn" data-testid="live-scene-banner">
                nothing on the table — activate a scene
              </span>
            )}
            <p className="mono-label w-full text-faint">
              activating pushes a scene to every player device and the TV · one scene is live at a
              time
            </p>
          </div>
        )}

        {loaded && all.length === 0 && (
          <div className="mt-4 max-w-3xl">
            <CreateSceneForm
              emptyState
              pending={creating}
              error={createError}
              onSubmit={(input) => void onCreate(input)}
            />
          </div>
        )}

        {working.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-4 2xl:grid-cols-2">
            {working.map(renderCard)}
          </div>
        )}

        {archived.length > 0 && (
          <details className="mt-6" data-testid="archived-scenes">
            <summary className="mono-label cursor-pointer text-faint">
              {`archived (${archived.length})`}
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-4 2xl:grid-cols-2">
              {archived.map(renderCard)}
            </div>
          </details>
        )}

        {loaded && all.length > 0 && (
          <div className="mt-6 max-w-3xl">
            <CreateSceneForm
              pending={creating}
              error={createError}
              onSubmit={(input) => void onCreate(input)}
            />
          </div>
        )}
      </div>
    </GmGuard>
  );
}

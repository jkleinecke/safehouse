/**
 * `/c/:campaignId/lab/3d[/:sceneId]` — the 3D lab.
 *
 * A GM-facing experiment, not a feature: it draws one existing scene with a
 * real 3D engine so the question "should the map move to three.js?" can be
 * answered with numbers from the devices the table actually uses — a phone,
 * the TV, the GM's laptop. Everything it shows is read-only; nothing here
 * writes to the scene, and the 2D map does not know it exists.
 *
 * Without a scene id it is a picker. With one, the canvas fills the screen and
 * a small panel over it switches quality, ambient light, walls, the floor in
 * view (and what the floors below it do), and the camera — iso or a
 * top-down plan — with a HUD of frame times and a benchmark whose
 * results copy out as text, so each device's run can be pasted side by side.
 *
 * The whole of `features/lab3d/` is one lazy chunk behind this route
 * (`routes.tsx`), so three.js costs the rest of the app nothing.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TILESETS, sceneLevels, type LightRow } from '@safehouse/rules';
import { useComposedScene, useScenes } from '../grid/api.js';
import { tileDefsFromSets } from '../grid/types.js';
import { ErrorNote, GmGuard, Spinner } from '../gm/ui.js';
import {
  createLabView,
  type BenchProgress,
  type BenchResult,
  type LabBelow,
  type LabCamera,
  type LabQuality,
  type LabStats,
  type LabView,
  type LabViewOptions,
  type LabWalls,
} from './labView.js';
import { floorTintCss } from './world3d.js';

/** The light rows by name, 0 (full light) to 3 (total darkness). */
const ROW_NAMES: Record<LightRow, string> = { 0: 'Full', 1: 'Partial', 2: 'Dim', 3: 'Dark' };

/** The page's ambient choice: the scene's own row, or one picked here to judge the lamps by. */
type AmbientChoice = 'scene' | LightRow;

const QUALITY_OPTIONS: ReadonlyArray<{ value: LabQuality; label: string; title: string }> = [
  { value: 'low', label: 'Low', title: 'No antialiasing, no shadows, pixel ratio 1' },
  { value: 'medium', label: 'Medium', title: 'Antialiasing and soft shadows, pixel ratio up to 2' },
  { value: 'high', label: 'High', title: 'More real-time lamps and shadows, sharper shadow maps' },
];

const WALL_OPTIONS: ReadonlyArray<{ value: LabWalls; label: string; title: string }> = [
  { value: 'full', label: 'Full', title: 'Walls at their full height' },
  { value: 'cut', label: 'Cut', title: 'Walls cut down so the rooms can be seen into' },
];

const CAMERA_OPTIONS: ReadonlyArray<{ value: LabCamera; label: string; title: string }> = [
  { value: 'iso', label: 'Iso', title: 'Orthographic, from the 2D iso angle (45°, 35.264°); drag to turn it' },
  { value: 'top', label: 'Top', title: 'Straight down, north up, like the 2D plan view: pan and zoom only' },
];

const BELOW_OPTIONS: ReadonlyArray<{ value: LabBelow; label: string; title: string }> = [
  { value: 'dim', label: 'Shaded', title: 'Floors below the one in view, shaded darker per floor down' },
  { value: 'hide', label: 'Hidden', title: 'Only the floor in view' },
  { value: 'show', label: 'As is', title: 'Floors below drawn unshaded' },
];

/** Low on a touch device, where the GPU is likeliest to be a phone's; Medium elsewhere. */
function defaultQuality(): LabQuality {
  try {
    return window.matchMedia('(pointer: coarse)').matches ? 'low' : 'medium';
  } catch {
    return 'medium';
  }
}

function isCoarse(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Any stored number as a light row. */
function toRow(n: number | undefined): LightRow {
  if (n === undefined || !Number.isFinite(n)) return 0;
  return Math.min(3, Math.max(0, Math.round(n))) as LightRow;
}

export default function Lab3DPage() {
  const { campaignId, sceneId } = useParams<{ campaignId: string; sceneId?: string }>();
  return (
    <GmGuard>
      {sceneId ? (
        // Keyed by scene: another scene starts a fresh view, panel and benchmark.
        <LabScene key={sceneId} campaignId={campaignId ?? ''} sceneId={sceneId} />
      ) : (
        <ScenePicker campaignId={campaignId} />
      )}
    </GmGuard>
  );
}

// ---------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------

/** Every scene in the campaign, one link each into the lab. */
function ScenePicker({ campaignId }: { campaignId: string | undefined }) {
  const scenes = useScenes(campaignId);
  const list = useMemo(
    () => [...(scenes.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [scenes.data],
  );
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <div>
        <div className="mono-label text-cyan">3D lab</div>
        <h1 className="mt-1 text-base font-semibold">Pick a scene to draw in 3D</h1>
        <p className="mt-1 text-sm text-dim">
          A prototype for judging a real 3D map: open a scene on each device you play on, run the
          benchmark, and copy the numbers out. Nothing here changes the scene.
        </p>
      </div>
      {scenes.isLoading && <Spinner label="loading scenes" />}
      <ErrorNote error={scenes.error} />
      {!scenes.isLoading && list.length === 0 && (
        <p className="text-sm text-dim">This campaign has no scenes yet.</p>
      )}
      <ul className="flex flex-col gap-2">
        {list.map((scene) => (
          <li key={scene.id}>
            <Link
              to={`/c/${campaignId}/lab/3d/${scene.id}`}
              className="panel flex items-center gap-3 p-3 hover:border-cyan"
              data-testid="lab3d-scene"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{scene.name}</span>
              <span className="mono-label text-faint">
                {`${scene.grid.cols}×${scene.grid.rows} · ${sceneLevels(scene).length} floor${
                  sceneLevels(scene).length === 1 ? '' : 's'
                }`}
              </span>
              {scene.state !== 'draft' && <span className="chip text-faint">{scene.state}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The lab itself
// ---------------------------------------------------------------------------

interface BenchState {
  running: boolean;
  progress: BenchProgress | null;
  results: BenchResult[] | null;
  /** The copyable report, fixed when the run finished. */
  text: string | null;
  error: string | null;
}

const BENCH_IDLE: BenchState = { running: false, progress: null, results: null, text: null, error: null };

function LabScene({ campaignId, sceneId }: { campaignId: string; sceneId: string }) {
  const query = useComposedScene(sceneId);
  const scene = query.data?.scene;
  const tokens = query.data?.tokens;
  // The built-in catalogue, as the 2D stage seeds itself with: every tileset
  // ships with the build, so there is nothing to wait for.
  const defs = useMemo(() => tileDefsFromSets(TILESETS), []);

  const [quality, setQuality] = useState<LabQuality>(defaultQuality);
  const [ambientChoice, setAmbientChoice] = useState<AmbientChoice | null>(null);
  const [walls, setWalls] = useState<LabWalls>('full');
  /** The floor in view: the ground floor to start, as the 2D map starts. */
  const [floorChoice, setFloorChoice] = useState(0);
  const [below, setBelow] = useState<LabBelow>('dim');
  const [camera, setCamera] = useState<LabCamera>('iso');
  const [panelOpen, setPanelOpen] = useState(() => !isCoarse());
  const [failure, setFailure] = useState<unknown>(null);
  const [bench, setBench] = useState<BenchState>(BENCH_IDLE);

  const levels = useMemo(() => (scene ? sceneLevels(scene) : []), [scene]);
  const sceneLight = toRow(scene?.environment.light);
  // Default to Dim when the scene is fully lit: the point is to see the lamps.
  const ambientSelected: AmbientChoice = ambientChoice ?? (sceneLight === 0 ? 2 : 'scene');
  const ambient: LightRow = ambientSelected === 'scene' ? sceneLight : ambientSelected;
  const topFloor = Math.max(0, levels.length - 1);
  const floor = Math.min(Math.max(0, floorChoice), topFloor);

  const options = useMemo<LabViewOptions | null>(
    () =>
      scene && tokens
        ? { scene, tokens, defs, quality, ambient, walls, floor, below, camera }
        : null,
    [scene, tokens, defs, quality, ambient, walls, floor, below, camera],
  );

  // Page Up / Page Down walk the floors, as a lift would.
  useEffect(() => {
    if (levels.length < 2) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
      e.preventDefault();
      setFloorChoice((f) => Math.min(Math.max(0, f + (e.key === 'PageUp' ? 1 : -1)), levels.length - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [levels.length]);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<LabView | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const ready = options !== null;

  // One view per scene: made once the data is here, torn down on the way out.
  useEffect(() => {
    const host = hostRef.current;
    const initial = latest.current;
    if (!host || !initial) return;
    let view: LabView;
    try {
      view = createLabView(host, initial);
    } catch (err) {
      setFailure(err);
      return;
    }
    viewRef.current = view;
    setFailure(null);
    return () => {
      viewRef.current = null;
      view.dispose();
    };
  }, [ready, sceneId]);

  // Every later change goes in as an update; the view rebuilds only what moved.
  useEffect(() => {
    if (!options) return;
    try {
      viewRef.current?.update(options);
    } catch (err) {
      setFailure(err);
    }
  }, [options]);

  const runBenchmark = async () => {
    const view = viewRef.current;
    if (!view || bench.running) return;
    setBench({ ...BENCH_IDLE, running: true });
    try {
      const results = await view.benchmark((progress) =>
        setBench((b) => (b.running ? { ...b, progress } : b)),
      );
      const text = benchReport(scene?.name ?? sceneId, results, view.stats());
      setBench({ running: false, progress: null, results, text, error: null });
    } catch (err) {
      setBench({ ...BENCH_IDLE, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const locked = bench.running;

  return (
    <div className="relative h-full min-h-[70dvh] w-full overflow-hidden bg-ground" data-testid="lab3d">
      <div ref={hostRef} className="absolute inset-0" data-testid="lab3d-host" />

      {(query.isLoading || query.error || failure !== null) && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
          <div className="panel max-w-md p-4 text-center">
            {query.isLoading && <Spinner label="loading the scene" />}
            {query.error && <ErrorNote error={query.error} />}
            {failure !== null && (
              <>
                <div className="mono-label text-danger">the lab could not start</div>
                <ErrorNote error={failure} />
              </>
            )}
          </div>
        </div>
      )}

      {/* --- controls --------------------------------------------------------- */}
      <div className="absolute left-2 top-2 z-20 flex max-h-[calc(100%-1rem)] w-72 max-w-[calc(100%-1rem)] flex-col">
        {panelOpen ? (
          <div className="panel flex min-h-0 flex-col gap-3 overflow-y-auto bg-panel/90 p-3 backdrop-blur" data-testid="lab3d-panel">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="mono-label text-cyan">3D lab</div>
                <div className="truncate text-sm font-semibold text-ink">{scene?.name ?? '…'}</div>
              </div>
              <button type="button" className="btn px-2 py-1" onClick={() => setPanelOpen(false)} title="Hide the controls">
                hide
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              <Link to={`/c/${campaignId}/lab/3d`} className="btn px-2 py-1" title="Pick another scene">
                scenes
              </Link>
              <button
                type="button"
                className="btn px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={locked}
                onClick={() => viewRef.current?.reframe()}
                title="Put the camera back on the whole scene"
              >
                reframe
              </button>
            </div>

            <Seg label="Quality" value={quality} options={QUALITY_OPTIONS} onChange={setQuality} disabled={locked} />
            <Seg<AmbientChoice>
              label="Ambient light"
              value={ambientSelected}
              options={[
                { value: 'scene', label: `Scene's own · ${ROW_NAMES[sceneLight]}`, title: 'The ambient row the scene is set to' },
                { value: 0, label: 'Full' },
                { value: 1, label: 'Partial' },
                { value: 2, label: 'Dim' },
                { value: 3, label: 'Dark' },
              ]}
              onChange={setAmbientChoice}
              disabled={locked}
            />
            <Seg label="Walls" value={walls} options={WALL_OPTIONS} onChange={setWalls} disabled={locked} />
            {levels.length > 1 && (
              <>
                <FloorStack levels={levels} floor={floor} onChange={setFloorChoice} disabled={locked} />
                <Seg label="Floors below" value={below} options={BELOW_OPTIONS} onChange={setBelow} disabled={locked} />
              </>
            )}
            <Seg label="Camera" value={camera} options={CAMERA_OPTIONS} onChange={setCamera} disabled={locked} />

            {/* --- benchmark -------------------------------------------------- */}
            <div className="flex flex-col gap-2 border-t border-edge pt-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-accent px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={locked || !ready || failure !== null}
                  onClick={() => void runBenchmark()}
                  title="Orbit the camera for 6 s at Low, Medium and High in turn, and measure each"
                  data-testid="lab3d-benchmark"
                >
                  {bench.running ? 'benchmarking…' : 'benchmark'}
                </button>
                {bench.running && bench.progress && (
                  <span className="mono-label text-dim">
                    {`${bench.progress.quality} · ${bench.progress.index + 1}/${bench.progress.of} · ${Math.round(
                      bench.progress.fraction * 100,
                    )}%`}
                  </span>
                )}
              </div>
              {bench.error && <p className="text-xs text-danger">{bench.error}</p>}
              {bench.results && bench.text && <BenchResults results={bench.results} text={bench.text} />}
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn self-start bg-panel/90 px-3 py-1.5"
            onClick={() => setPanelOpen(true)}
            data-testid="lab3d-show-panel"
          >
            3D lab · controls
          </button>
        )}
      </div>

      {levels.length > 1 && levels[floor] && (
        // Which floor this is, where the eye already is: over the middle of the canvas.
        <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2" data-testid="lab3d-floor-badge">
          <div className="flex items-center gap-2 rounded-md border border-edge bg-panel/85 px-3 py-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: floorTintCss(floor) }} />
            <span className="text-sm font-semibold text-ink">{levels[floor]!.name}</span>
            <span className="mono-label text-faint">{`floor ${floor + 1} of ${levels.length} · PgUp/PgDn`}</span>
          </div>
        </div>
      )}

      <Hud viewRef={viewRef} />
    </div>
  );
}

/**
 * The floors as a building's lift panel: the top floor at the top, each in
 * its own colour — the colour its slab edges and outline are drawn in — and
 * the one in view lit.
 */
function FloorStack({
  levels,
  floor,
  onChange,
  disabled,
}: {
  levels: ReadonlyArray<{ id: string; name: string }>;
  floor: number;
  onChange: (next: number) => void;
  disabled: boolean;
}) {
  const order = levels.map((l, i) => ({ ...l, index: i })).reverse();
  return (
    <div className="flex flex-col gap-1">
      <span className="mono-label text-faint">Floor in view</span>
      <div className="flex flex-col gap-1" role="group" aria-label="Floor in view">
        {order.map((l) => (
          <button
            key={l.id}
            type="button"
            aria-pressed={l.index === floor}
            disabled={disabled}
            className={
              'btn flex items-center gap-2 px-2 py-1 text-left disabled:cursor-not-allowed disabled:opacity-40' +
              (l.index === floor ? ' btn-accent' : '')
            }
            onClick={() => onChange(l.index)}
          >
            <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: floorTintCss(l.index) }} />
            <span className="min-w-0 flex-1 truncate">{l.name}</span>
            <span className="mono-label text-faint">{l.index + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

interface SegOption<T> {
  value: T;
  label: string;
  title?: string;
}

/** A row of mutually exclusive buttons under a label. */
function Seg<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<SegOption<T>>;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="mono-label text-faint">{label}</span>
      <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={o.value === value}
            disabled={disabled}
            title={o.title}
            className={
              'btn px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40' +
              (o.value === value ? ' btn-accent' : '')
            }
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The numbers, twice a second. Its own component with its own timer, so the
 * HUD ticking over re-renders the HUD and nothing else.
 */
function Hud({ viewRef }: { viewRef: MutableRefObject<LabView | null> }) {
  const [stats, setStats] = useState<LabStats | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setStats(viewRef.current?.stats() ?? null), 500);
    return () => window.clearInterval(timer);
  }, [viewRef]);
  if (!stats) return null;
  const rows: Array<[string, string]> = [
    ['fps', stats.fps.toFixed(0)],
    ['frame', `${stats.frameMsAvg.toFixed(1)} ms · worst ${stats.frameMsWorst.toFixed(1)}`],
    ['cpu', `${stats.cpuMsAvg.toFixed(2)} ms`],
    ['draws', `${stats.drawCalls} · ${formatCount(stats.triangles)} tris`],
    ['lights', `${stats.lights.realtime} live · ${stats.lights.shadowed} shadowed · ${stats.lights.baked} baked`],
    ['world', `${formatCount(stats.worldTriangles)} tris · built in ${stats.worldBuildMs.toFixed(0)} ms`],
    ['quality', `${stats.quality} · dpr ${stats.pixelRatio.toFixed(2)}`],
    ['canvas', `${stats.width}×${stats.height}`],
    ['gpu', stats.gpu],
  ];
  return (
    <div
      className="pointer-events-none absolute right-2 top-2 z-10 max-w-[min(22rem,calc(100%-1rem))] rounded-md border border-edge bg-panel/80 px-2.5 py-2 font-mono text-[11px] leading-snug text-ink backdrop-blur"
      data-testid="lab3d-hud"
    >
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="w-12 shrink-0 text-faint">{k}</span>
          <span className={'min-w-0 ' + (k === 'gpu' ? 'break-words text-dim' : '')}>{v}</span>
        </div>
      ))}
      {stats.benchmarking && <div className="mt-1 text-warn">benchmark running</div>}
    </div>
  );
}

/** The results table, a Copy button, and the same report as selectable text for browsers that cannot copy. */
function BenchResults({ results, text }: { results: BenchResult[]; text: string }) {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  return (
    <div className="flex flex-col gap-2" data-testid="lab3d-bench-results">
      <table className="w-full font-mono text-[11px]">
        <thead>
          <tr className="text-left text-faint">
            <th className="font-normal">quality</th>
            <th className="text-right font-normal">fps</th>
            <th className="text-right font-normal">1% low</th>
            <th className="text-right font-normal">ms</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.quality} className="text-ink">
              <td>{r.quality}</td>
              <td className="text-right">{r.fps.toFixed(1)}</td>
              <td className="text-right">{r.low1Fps.toFixed(1)}</td>
              <td className="text-right">{r.frameMs.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn px-3 py-1"
          onClick={() => void copyText(text).then((ok) => setCopied(ok ? 'yes' : 'no'))}
        >
          copy
        </button>
        {copied === 'yes' && <span className="mono-label text-ok">copied</span>}
        {copied === 'no' && <span className="mono-label text-warn">could not copy — select the text below</span>}
      </div>
      <details className="rounded-md border border-edge p-2">
        <summary className="mono-label cursor-pointer text-cyan">as text</summary>
        <pre className="mt-2 select-all overflow-x-auto whitespace-pre text-[10px] text-dim">{text}</pre>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

/**
 * The benchmark as plain text: the device first (GPU, screen, pixel ratio,
 * browser), then one row per quality, so a run on each device can be pasted
 * into one note and read down a column.
 */
function benchReport(sceneName: string, results: readonly BenchResult[], stats: LabStats): string {
  const head = [
    `Safehouse 3D lab benchmark - ${sceneName}`,
    `GPU:     ${stats.gpu}`,
    `Screen:  ${window.screen.width}x${window.screen.height} CSS px, devicePixelRatio ${window.devicePixelRatio}`,
    `Canvas:  ${stats.width}x${stats.height} CSS px`,
    `Browser: ${navigator.userAgent}`,
    `When:    ${new Date().toISOString()}`,
    '',
  ];
  const cols: Array<[string, (r: BenchResult) => string]> = [
    ['quality', (r) => r.quality],
    ['avg fps', (r) => r.fps.toFixed(1)],
    ['1% low', (r) => r.low1Fps.toFixed(1)],
    ['avg ms', (r) => r.frameMs.toFixed(2)],
    ['cpu ms', (r) => r.cpuMs.toFixed(2)],
    ['dpr', (r) => r.pixelRatio.toFixed(2)],
    ['draws', (r) => String(r.drawCalls)],
    ['tris', (r) => formatCount(r.triangles)],
    ['lights live/shadow/baked', (r) => `${r.lights.realtime}/${r.lights.shadowed}/${r.lights.baked}`],
    ['frames', (r) => String(r.frames)],
  ];
  const cells = [cols.map(([name]) => name), ...results.map((r) => cols.map(([, get]) => get(r)))];
  const widths = cols.map((_, i) => Math.max(...cells.map((row) => (row[i] ?? '').length)));
  const table = cells.map((row) => row.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ').trimEnd());
  return [...head, ...table].join('\n');
}

/**
 * Put text on the clipboard. The async clipboard needs a secure context,
 * which a TV browser on the LAN is not, so fall back to the old
 * select-and-copy; false means neither worked and the reader should select
 * the text by hand.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied or unavailable: try the fallback.
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

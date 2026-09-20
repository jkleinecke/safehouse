/**
 * The zone tool's drafting controls: name the area, then save the polygon.
 *
 * A zone is the one authoring act that is not finished by a click — a polygon
 * is saved when the GM says it is — so the tool needs somewhere to say it.
 * These controls used to live on the Layout tab, which is gone (2026-09-19),
 * and they cannot live on a tab in any case: a GM drawing a zone is looking
 * at the map, not at whichever section happens to be open.
 *
 * So they sit above the tabs, beside the inspector, and only while the zone
 * tool is in hand.
 */
import type { Point, Scene } from '@safehouse/contracts';
import { usePatchGeometry } from '../api.js';
import { rectPolygon } from '../geometry.js';
import { addZone } from '../geometryEdit.js';
import { useGridStore } from '../store.js';
import { inputCls, PanelSection } from './ui.js';

export default function ZoneDraft({ scene }: { scene: Scene }) {
  const patch = usePatchGeometry();
  const draft = useGridStore((s) => s.fogDraft);
  const clearDraft = useGridStore((s) => s.clearFogDraft);
  const zoneName = useGridStore((s) => s.zoneName);
  const setZoneName = useGridStore((s) => s.setZoneName);

  const points = draft?.points ?? [];
  const first = points[0];
  const second = points[1];
  const canRect = points.length === 2 && first !== undefined && second !== undefined;

  const saveZone = (polygon: Point[]) => {
    patch.mutate({ sceneId: scene.id, geometry: addZone(scene.geometry, polygon, { name: zoneName }) });
    setZoneName('');
    clearDraft();
  };

  return (
    <PanelSection title="New zone" hint={`${points.length} vertices`}>
      <input
        className={inputCls}
        placeholder="loading dock, the vault…"
        value={zoneName}
        onChange={(e) => setZoneName(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="zone-save-polygon"
          className="btn flex-1 py-1"
          disabled={points.length < 3}
          onClick={() => saveZone(points)}
        >
          save polygon
        </button>
        <button
          type="button"
          data-testid="zone-save-rect"
          className="btn flex-1 py-1"
          disabled={!canRect}
          title="Two clicks = opposite corners"
          onClick={() => {
            if (first && second) saveZone(rectPolygon(first, second));
          }}
        >
          save rect
        </button>
        <button
          type="button"
          className="btn py-1"
          disabled={points.length === 0}
          onClick={clearDraft}
        >
          clear
        </button>
      </div>
    </PanelSection>
  );
}

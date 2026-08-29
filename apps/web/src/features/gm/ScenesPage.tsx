/**
 * /c/:campaignId/gm/scenes — still a placeholder, but NOT because M9 authoring
 * is unbuilt. It is built, and it lives somewhere else: scene authoring,
 * activation, fog regions, geometry, pins, map upload and the display switch
 * are all in the Grid's GM panel (`features/grid/gm/*`, reached from
 * `/c/:campaignId/grid`), because authoring wants the canvas beside it.
 *
 * What is actually wrong here is the route: `components/shell/GmSidebar.tsx`
 * still offers a "Scenes" link that lands on this card, so a GM who takes it
 * sees a placeholder for a feature they already have. The fix is the link and
 * this route, not a second authoring UI — do not build one here.
 */
export default function ScenesPage() {
  return (
    <div className="p-6">
      <div className="mono-label text-cyan">Route / GM / Scenes</div>
      <h1 className="mt-2 text-lg font-semibold">Scenes</h1>
      <p className="mt-1 text-sm text-dim">
        Placeholder — scene authoring, activation, fog regions land here.
      </p>
    </div>
  );
}

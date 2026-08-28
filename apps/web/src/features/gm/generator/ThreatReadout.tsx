/**
 * THREAT READOUT (FR10.5/10.6) — the feature only an integrated tool can do:
 * the opposition's math against the *live* PC sheets, both directions, with
 * the receipts on display. Every number here is an ESTIMATE and says so:
 * SR5 has no CR, and we don't pretend otherwise (Principle 3, R10).
 */
import { EstBadge, SectionTitle } from '../ui.js';
import { actionEconomy, readoutRows, type ReadoutRow, type SideProfile } from './readout.js';

const METHOD =
  'hits ≈ pool ÷ 3 · est. Initiative Score = base + 3.5 × dice · passes ≈ ceil(score ÷ 10)';

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function Cell({ row }: { row: ReadoutRow }) {
  const { est, connectsToDrop } = row;
  if (!est.connects) {
    return (
      <td className="border border-edge px-2 py-1.5 text-center align-top" title={est.summary}>
        <span className="mono-label text-faint">expected miss</span>
      </td>
    );
  }
  const heavy = connectsToDrop !== null && connectsToDrop <= 2;
  return (
    <td
      className="border border-edge px-2 py-1.5 text-center align-top"
      title={est.summary}
    >
      <div className={`text-sm font-semibold ${heavy ? 'text-danger' : 'text-ink'}`}>
        ~{fmt(est.boxesPerConnect)} boxes
      </div>
      <div className="mono-label text-faint">
        ~{fmt(est.netHits)} net · DV {fmt(est.modifiedDv)}
        {est.dv.type}
      </div>
      <div className="mono-label text-faint">
        {connectsToDrop === null ? 'never drops' : `${connectsToDrop} connect${connectsToDrop === 1 ? '' : 's'} to drop`}
      </div>
    </td>
  );
}

function Matrix({
  title,
  hint,
  attackers,
  defenders,
}: {
  title: string;
  hint: string;
  attackers: readonly SideProfile[];
  defenders: readonly SideProfile[];
}) {
  if (attackers.length === 0 || defenders.length === 0) {
    return (
      <div>
        <SectionTitle hint={hint}>{title}</SectionTitle>
        <p className="mt-2 text-sm text-faint">
          {attackers.length === 0 ? 'No attackers on this side yet.' : 'No targets on the other side yet.'}
        </p>
      </div>
    );
  }

  const rows = readoutRows(attackers, defenders);
  const byAttacker = attackers.map((attacker) => ({
    attacker,
    cells: rows.filter((r) => r.attacker === attacker),
  }));

  return (
    <div>
      <div className="flex items-center gap-2">
        <SectionTitle hint={hint}>{title}</SectionTitle>
        <EstBadge />
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr>
              <th className="mono-label border border-edge bg-deck px-2 py-1.5 text-left">
                attacker → target
              </th>
              {defenders.map((d) => (
                <th key={d.name} className="border border-edge bg-deck px-2 py-1.5 text-center">
                  <div className="truncate text-xs font-semibold text-ink">{d.name}</div>
                  <div className="mono-label text-faint">
                    def {d.defensePool} · soak {d.soakPool} · {d.physicalBoxes} boxes
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byAttacker.map(({ attacker, cells }) => (
              <tr key={attacker.name}>
                <th className="border border-edge bg-deck px-2 py-1.5 text-left">
                  <div className="truncate text-xs font-semibold text-ink">
                    {attacker.name}
                    {attacker.bodies > 1 && <span className="text-faint"> ×{attacker.bodies}</span>}
                  </div>
                  <div className="mono-label text-faint">
                    {attacker.attackLabel} · pool {attacker.attackPool} · DV {attacker.dv}
                  </div>
                </th>
                {cells.map((row, i) => (
                  <Cell key={i} row={row} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EconomyCard({ label, profiles }: { label: string; profiles: readonly SideProfile[] }) {
  const econ = actionEconomy(profiles);
  return (
    <div className="rounded-md border border-edge bg-deck p-3">
      <div className="mono-label text-faint">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-3">
        <span className="text-lg font-semibold text-ink">{econ.bodies}</span>
        <span className="mono-label">bodies</span>
        <span className="text-lg font-semibold text-cyan">{fmt(econ.actionsPerTurn)}</span>
        <span className="mono-label">actions / turn</span>
        <span className="text-sm text-dim">top init ~{fmt(econ.topInit)}</span>
      </div>
    </div>
  );
}

export interface ThreatReadoutProps {
  party: readonly SideProfile[];
  opposition: readonly SideProfile[];
  /** Rows still waiting on a roll, so the GM knows the table is partial. */
  pendingCount?: number;
}

export default function ThreatReadout({ party, opposition, pendingCount = 0 }: ThreatReadoutProps) {
  return (
    <div className="panel space-y-5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle hint={METHOD}>Threat readout</SectionTitle>
        <EstBadge />
        {pendingCount > 0 && (
          <span className="mono-label text-warn">{pendingCount} row(s) still rolling…</span>
        )}
      </div>

      <p className="text-xs text-dim">
        Estimates the GM tunes, not promises — move the levers and the whole table recomputes.
        Hover any cell for its receipt.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <EconomyCard label="Party action economy" profiles={party} />
        <EconomyCard label="Opposition action economy" profiles={opposition} />
      </div>

      <Matrix
        title="Opposition → party"
        hint="their attack vs each PC's defense and soak"
        attackers={opposition}
        defenders={party}
      />
      <Matrix
        title="Party → opposition"
        hint="and the reverse — how fast the PCs chew through them"
        attackers={party}
        defenders={opposition}
      />
    </div>
  );
}

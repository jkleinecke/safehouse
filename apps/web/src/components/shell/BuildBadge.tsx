/**
 * "Which build is this?" — one line in the corner of the GM console and the
 * front door.
 *
 * Nothing on screen used to say. An image from last week and one from a
 * minute ago render the same page at the same URL, so a GM who had just run
 * `docker compose up` could not tell whether the change they were testing was
 * in the container at all. The line names the server's build (from
 * `/healthz`) and when it was built; and when this bundle came from a
 * different commit than the server — a tab left open across a rebuild — it
 * says so and offers the reload that fixes it.
 */
import { useServerBuild, type ServerBuild } from '../../api/health.js';
import { CLIENT_BUILD, commitOf, type ClientBuild } from '../../build.js';

export interface BuildLine {
  /** `build abc1234` */
  text: string;
  /** `built 7 Sep, 14:02` / `running from the checkout` / … */
  detail: string;
  /** This page is from a different commit than the server it is talking to. */
  stale: boolean;
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Pure: what to print, and whether a reload is owed. */
export function buildLine(server: ServerBuild | undefined, client: ClientBuild = CLIENT_BUILD): BuildLine {
  if (!server) return { text: `build ${client.version}`, detail: 'server not reached yet', stale: false };
  const detail =
    server.builtAt !== null
      ? `built ${when(server.builtAt)}`
      : server.source === 'checkout'
        ? 'running from the checkout'
        : 'no build time';
  // `dev` on either side means "unknown", which is not a mismatch; and two
  // builds of one commit — one of them dirty — are the same page.
  const stale =
    client.version !== 'dev' &&
    server.version !== 'dev' &&
    commitOf(client.version) !== commitOf(server.version);
  return { text: `build ${server.version}`, detail, stale };
}

export default function BuildBadge({ className = '' }: { className?: string }) {
  const { data } = useServerBuild();
  const line = buildLine(data);
  return (
    <div
      className={`mono-label text-faint ${className}`}
      data-testid="build-badge"
      data-stale={line.stale ? 'yes' : 'no'}
      title={data ? `server ${data.version} · this page ${CLIENT_BUILD.version}` : undefined}
    >
      <span>{line.text}</span>
      <span className="ml-1.5 opacity-80">{line.detail}</span>
      {line.stale && (
        <button
          type="button"
          className="ml-2 cursor-pointer text-warn underline"
          onClick={() => window.location.reload()}
        >
          this page is from {CLIENT_BUILD.version} — reload
        </button>
      )}
    </div>
  );
}

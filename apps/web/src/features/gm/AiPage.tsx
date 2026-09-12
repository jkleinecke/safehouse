/**
 * `/c/:campaignId/gm/ai` — which AI the table talks to, as its own screen.
 *
 * The panel has lived at the top of the Fixer page since FR12.13, and a GM
 * who went looking for "AI settings" did not find it there: nothing in the
 * console said AI. Now the sidebar does, the setup checklist points here,
 * and every "the Fixer is off" note links here. The panel itself is the same
 * component the Fixer page shows — one form, one saved answer.
 */
import { Link, useParams } from 'react-router-dom';
import AiSettings from './fixer/AiSettings.js';
import { GmGuard, SectionTitle } from './ui.js';

export default function AiPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  if (!campaignId) return null;
  return (
    <GmGuard>
      <div className="p-6">
        <SectionTitle hint="a box on the LAN, or a provider — saved per campaign">AI</SectionTitle>
        <h1 className="mt-1 text-lg font-semibold">Which AI the Fixer talks to</h1>
        <p className="mt-1 max-w-2xl text-sm text-dim">
          Everything the Fixer does — the chat, NPC voices, drafts, reading a map, building a floor —
          goes through the model chosen here. Nothing else in the app needs it; with it off, every AI
          surface says so and the table plays on.
        </p>

        <div className="mt-4 max-w-2xl">
          <AiSettings campaignId={campaignId} />
        </div>

        <div className="mt-4 max-w-2xl rounded-lg border border-edge bg-deck/50 p-4" data-testid="ai-local-howto">
          <h2 className="text-sm font-semibold text-ink">A box on your own machine</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-dim">
            <li>
              Pick <span className="text-ink">Local or other</span>, and give the base URL the way the
              server names it, ending in <code className="text-cyan">/v1</code> — for example{' '}
              <code className="text-cyan">http://127.0.0.1:8888/v1</code> for llama.cpp, vLLM, LM
              Studio, TabbyAPI or anything else that speaks the OpenAI shape.
            </li>
            <li>
              Press <span className="text-ink">check the box</span>: the server tries to reach it and
              lists the model ids it serves, so the two model fields can be picked rather than typed.
            </li>
            <li>
              If Safehouse runs in Docker, <code className="text-cyan">127.0.0.1</code> is the
              container, not your machine — use{' '}
              <code className="text-cyan">http://host.docker.internal:8888/v1</code>. The check says
              so when that is the problem.
            </li>
            <li>
              Save, then open the{' '}
              <Link className="text-cyan underline" to={`/c/${campaignId}/gm/fixer`}>
                Fixer
              </Link>{' '}
              — it takes effect on the next message, no restart.
            </li>
          </ul>
        </div>
      </div>
    </GmGuard>
  );
}

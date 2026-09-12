/**
 * Which AI the table talks to (FR12.13, D12).
 *
 * The Fixer used to be an env var and a restart. This is the same decision
 * made where the GM already is, taking effect on the next message — because a
 * setting you change by editing a file on the machine hosting the game and
 * then bouncing the server is a setting nobody changes mid-campaign.
 *
 * ## Two things this screen is careful about
 *
 * IT NEVER SHOWS A KEY. The server reports only whether one is on file, so the
 * field is always blank and always says what leaving it blank means. There is
 * no state in which a secret is sitting in a rendered input for somebody to
 * screenshot.
 *
 * IT SAYS WHETHER THIS WOULD ACTUALLY RUN. "Configured" and "working" are
 * different, and a provider chosen with no key is the gap between them. Better
 * to say so while the GM is looking at the form than to let them find out from
 * a failed call in the middle of a session.
 */
import { useEffect, useState } from 'react';
import {
  AI_PROVIDERS,
  aiProviderInfo,
  effortSupport,
  type AiEffort,
  type AiProvider,
} from '@safehouse/contracts';
import { useAiSettings, useProbeModels, useSaveAiSettings } from './api.js';

const inputCls =
  'w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-faint focus:border-cyan focus:outline-none';

export default function AiSettings({ campaignId }: { campaignId: string }) {
  const query = useAiSettings(campaignId);
  const save = useSaveAiSettings(campaignId);
  const probe = useProbeModels(campaignId);
  const saved = query.data;

  const [provider, setProvider] = useState<AiProvider>('off');
  const [baseUrl, setBaseUrl] = useState('');
  const [primaryModel, setPrimary] = useState('');
  const [fastModel, setFast] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [effort, setEffort] = useState<AiEffort>('default');
  const [touched, setTouched] = useState(false);

  // Adopt the server's answer once, and again whenever a save returns — but
  // never over the top of an edit in progress, which would eat what the GM is
  // typing the moment a background refetch lands.
  useEffect(() => {
    if (!saved || touched) return;
    setProvider(saved.provider);
    setBaseUrl(saved.baseUrl);
    setPrimary(saved.primaryModel);
    setFast(saved.fastModel);
    setEffort(saved.reasoningEffort);
  }, [saved, touched]);

  const info = aiProviderInfo(provider);
  const isLocal = provider === 'openai-compatible';
  const support = effortSupport(provider);
  const changedProvider = saved !== undefined && provider !== saved.provider;
  // Changing provider drops the stored key server-side, so the form should not
  // claim one is still on file.
  const keyOnFile = saved?.hasKey === true && !changedProvider;

  const submit = () => {
    save.mutate(
      {
        provider,
        baseUrl: isLocal ? baseUrl.trim() : '',
        primaryModel: primaryModel.trim() || info.defaults.primary,
        fastModel: fastModel.trim(),
        reasoningEffort: effort,
        // Omitted, not blank: an omitted key leaves the stored one alone, a
        // blank one clears it, and those must not be the same request.
        ...(apiKey.length > 0 ? { apiKey } : {}),
      },
      {
        onSuccess: () => {
          setApiKey('');
          setTouched(false);
        },
      },
    );
  };

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    setTouched(true);
    set(v);
  };

  return (
    <section className="rounded-lg border border-edge bg-panel p-4" data-testid="ai-settings" id="which-ai">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold text-ink">Which AI</h3>
        {saved && (
          <span
            className={`chip ${saved.ready ? 'border-ok/50 text-ok' : 'text-warn'}`}
            data-testid="ai-ready"
          >
            {saved.ready
              ? saved.fallback
                ? 'ready · from .env'
                : 'ready'
              : saved.provider === 'off'
                ? 'off'
                : 'not usable yet'}
          </span>
        )}
        <span className="ml-auto text-[0.7rem] text-faint">
          Takes effect on the next message — no restart.
        </span>
      </div>
      <p className="mt-1.5 text-[0.7rem] leading-snug text-dim">
        Saved on this server, for this campaign, and it wins: the <code>LLM_*</code> lines in{' '}
        <code>.env</code> only decide what a campaign uses until something is chosen here.
      </p>
      {saved?.fallback && (
        <p
          className="mt-2 rounded-md border border-warn/40 bg-warn/5 px-2.5 py-1.5 text-[0.7rem] leading-snug text-warn"
          data-testid="ai-fallback"
        >
          Nothing chosen here yet, so the AI is running on the server's environment:{' '}
          <code>{saved.fallback.baseUrl}</code> · {saved.fallback.primaryModel}. Pick a provider to
          take over, or Off to switch it off.
        </p>
      )}

      <label className="mt-3 block">
        <span className="mono-label">Provider</span>
        <select
          className={inputCls}
          value={provider}
          data-testid="ai-provider"
          onChange={(e) => {
            const next = e.target.value as AiProvider;
            edit(setProvider)(next);
            // Offer that provider's own models rather than leaving the last
            // one's behind, which would be a model id the new host has never
            // heard of and a 404 the GM has to decode.
            const chosen = aiProviderInfo(next);
            setPrimary(chosen.defaults.primary);
            setFast(chosen.defaults.fast);
          }}
        >
          {AI_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[0.7rem] text-dim">{info.blurb}</span>
      </label>

      {provider !== 'off' && (
        <>
          {isLocal && (
            <label className="mt-3 block">
              <span className="mono-label">Base URL</span>
              <input
                className={inputCls}
                value={baseUrl}
                placeholder="http://box.lan:8080/v1"
                data-testid="ai-base-url"
                onChange={(e) => edit(setBaseUrl)(e.target.value)}
              />
            </label>
          )}

          {isLocal && (
            <div className="mt-2" data-testid="ai-probe">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn px-2.5 py-1"
                  disabled={probe.isPending || !/^https?:\/\//i.test(baseUrl.trim())}
                  onClick={() => probe.mutate(baseUrl.trim())}
                  data-testid="ai-probe-check"
                >
                  {probe.isPending ? 'checking…' : 'check the box'}
                </button>
                <span className="text-[0.7rem] text-dim">
                  Reaches it from this server and lists the models it serves.
                </span>
              </div>
              {probe.data && (
                <div
                  className="mt-2 text-[0.75rem]"
                  data-testid="ai-probe-result"
                  data-reachable={probe.data.reachable ? 'yes' : 'no'}
                >
                  {probe.data.reachable ? (
                    probe.data.models.length > 0 ? (
                      <>
                        <span className="text-ok">reachable</span>
                        <span className="text-dim">
                          {' '}
                          · {probe.data.models.length} model{probe.data.models.length === 1 ? '' : 's'} — click
                          one to make it the primary
                        </span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {probe.data.models.map((id) => (
                            <button
                              key={id}
                              type="button"
                              className={`chip cursor-pointer normal-case ${
                                primaryModel === id ? 'border-cyan text-cyan' : 'text-dim hover:text-cyan'
                              }`}
                              onClick={() => {
                                edit(setPrimary)(id);
                                // A fast model the box does not serve would 404 mid-session;
                                // blank means the primary, which it does serve.
                                if (!probe.data?.models.includes(fastModel)) edit(setFast)('');
                              }}
                              data-testid="ai-probe-model"
                            >
                              {id}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <span className="text-warn">{probe.data.note}</span>
                    )
                  ) : (
                    <span className="text-warn">{probe.data.note}</span>
                  )}
                  {probe.data.hint && (
                    <p className="mt-1 text-warn" data-testid="ai-probe-hint">
                      {probe.data.hint}
                    </p>
                  )}
                </div>
              )}
              {probe.isError && (
                <p className="mt-1 text-[0.75rem] text-danger">
                  {probe.error instanceof Error ? probe.error.message : 'the check failed'}
                </p>
              )}
            </div>
          )}

          {info.needsKey && (
            <label className="mt-3 block">
              <span className="mono-label">API key</span>
              <input
                className={inputCls}
                type="password"
                autoComplete="off"
                value={apiKey}
                data-testid="ai-key"
                placeholder={keyOnFile ? 'a key is on file — leave blank to keep it' : 'required'}
                onChange={(e) => edit(setApiKey)(e.target.value)}
              />
              <span className="mt-1 block text-[0.7rem] text-dim">
                {keyOnFile
                  ? 'Stored on this server and never sent back to a browser. Leave blank to keep it.'
                  : 'Stored on this server and never sent back to a browser.'}
              </span>
            </label>
          )}

          <label className="mt-3 block">
            <span className="mono-label">Thinking</span>
            <select
              className={inputCls}
              value={effort}
              data-testid="ai-effort"
              onChange={(e) => edit(setEffort)(e.target.value as AiEffort)}
            >
              <option value="default">Whatever the model does</option>
              <option value="off">Off — answer directly</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <span className="mt-1 block text-[0.7rem] text-dim">
              {support === 'on-off'
                ? 'A local server only understands on or off — the three levels all mean on.'
                : support === 'levels'
                  ? 'Reasoning models spend tokens before answering. Less thinking is faster and cheaper.'
                  : ''}
            </span>
          </label>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mono-label">Primary model</span>
              <input
                className={inputCls}
                value={primaryModel}
                placeholder={info.defaults.primary}
                data-testid="ai-primary"
                onChange={(e) => edit(setPrimary)(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mono-label">Fast model</span>
              <input
                className={inputCls}
                value={fastModel}
                placeholder={info.defaults.fast || primaryModel}
                data-testid="ai-fast"
                onChange={(e) => edit(setFast)(e.target.value)}
              />
              <span className="mt-1 block text-[0.7rem] text-dim">
                Used for mechanical work during play. Blank means the primary.
              </span>
            </label>
          </div>
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-accent px-3 py-1.5"
          disabled={save.isPending}
          onClick={submit}
        >
          {save.isPending ? 'saving…' : 'save'}
        </button>
        {save.isError && (
          <span role="alert" className="text-xs text-danger">
            {save.error instanceof Error ? save.error.message : 'That did not save.'}
          </span>
        )}
        {!save.isError && save.isSuccess && !touched && (
          <span className="text-xs text-dim">Saved.</span>
        )}
      </div>
    </section>
  );
}

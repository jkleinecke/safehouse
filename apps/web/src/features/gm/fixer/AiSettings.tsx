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
import { AI_PROVIDERS, aiProviderInfo, type AiProvider } from '@safehouse/contracts';
import { useAiSettings, useSaveAiSettings } from './api.js';

const inputCls =
  'w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-faint focus:border-cyan focus:outline-none';

export default function AiSettings({ campaignId }: { campaignId: string }) {
  const query = useAiSettings(campaignId);
  const save = useSaveAiSettings(campaignId);
  const saved = query.data;

  const [provider, setProvider] = useState<AiProvider>('off');
  const [baseUrl, setBaseUrl] = useState('');
  const [primaryModel, setPrimary] = useState('');
  const [fastModel, setFast] = useState('');
  const [apiKey, setApiKey] = useState('');
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
  }, [saved, touched]);

  const info = aiProviderInfo(provider);
  const isLocal = provider === 'openai-compatible';
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
    <section className="rounded-lg border border-edge bg-panel p-4" data-testid="ai-settings">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold text-ink">Which AI</h3>
        {saved && (
          <span
            className={`chip ${saved.ready ? 'border-ok/50 text-ok' : 'text-warn'}`}
            data-testid="ai-ready"
          >
            {saved.ready ? 'ready' : saved.provider === 'off' ? 'off' : 'not usable yet'}
          </span>
        )}
        <span className="ml-auto text-[0.7rem] text-faint">
          Takes effect on the next message — no restart.
        </span>
      </div>

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

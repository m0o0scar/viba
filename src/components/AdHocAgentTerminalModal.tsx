'use client';

import { startTtydProcess } from '@/app/actions/git';
import { useEscapeDismiss } from '@/hooks/use-escape-dismiss';
import type { TerminalWindow } from '@/hooks/useTerminalLink';
import { buildTtydTerminalSrc, type TerminalShellKind } from '@/lib/terminal-session';
import {
  applyThemeToTerminalWindow,
  resolveShouldUseDarkTheme,
  TERMINAL_THEME_DARK,
  TERMINAL_THEME_LIGHT,
} from '@/lib/ttyd-theme';
import type { AgentProvider, AppStatus, ModelOption, ProviderCatalogEntry } from '@/lib/types';
import { ChevronDown } from 'lucide-react';
import { useTheme } from 'next-themes';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

const AD_HOC_AGENT_SELECTION_STORAGE_KEY_PREFIX = 'palx:ad-hoc-agent-selection:';
const SUPPORTED_AGENT_PROVIDERS = ['codex', 'gemini', 'cursor'] as const;
const AGENT_PROVIDER_FALLBACK_LABELS: Record<string, string> = {
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  cursor: 'Cursor Agent CLI',
};
const DEFAULT_MODEL_OPTION: ModelOption = {
  id: '',
  label: 'Default model',
  description: 'Use the provider default model.',
};

type AgentStatusResponse = {
  providers?: ProviderCatalogEntry[];
  defaultProvider?: AgentProvider;
  status: AppStatus | null;
  error?: string;
};

type PersistedSelection = {
  provider: AgentProvider;
  model: string;
};

type BuildAdHocAgentCommandArgs = {
  provider: AgentProvider;
  model: string;
  shellKind: TerminalShellKind;
};

export type AdHocAgentTerminalModalProps = {
  isOpen: boolean;
  scenarioKey: string;
  title: string;
  description: ReactNode;
  workingDirectory: string;
  confirmLabel?: string;
  onClose: () => void;
  buildCommand: (args: BuildAdHocAgentCommandArgs) => string;
};

function normalizeProvider(value: string | null | undefined): AgentProvider {
  return value === 'codex' || value === 'gemini' || value === 'cursor'
    ? value
    : 'codex';
}

function providerLabel(provider: string, providers: ProviderCatalogEntry[] = []): string {
  return providers.find((entry) => entry.id === provider)?.label
    || AGENT_PROVIDER_FALLBACK_LABELS[provider]
    || provider;
}

function readPersistedSelection(scenarioKey: string): PersistedSelection | null {
  if (typeof window === 'undefined') return null;

  try {
    const rawValue = window.localStorage.getItem(`${AD_HOC_AGENT_SELECTION_STORAGE_KEY_PREFIX}${scenarioKey}`);
    if (!rawValue) return null;

    const parsed = JSON.parse(rawValue) as Partial<PersistedSelection>;
    const provider = normalizeProvider(parsed.provider);
    const model = typeof parsed.model === 'string' ? parsed.model.trim() : '';
    return { provider, model };
  } catch {
    return null;
  }
}

function writePersistedSelection(scenarioKey: string, selection: PersistedSelection) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      `${AD_HOC_AGENT_SELECTION_STORAGE_KEY_PREFIX}${scenarioKey}`,
      JSON.stringify(selection),
    );
  } catch {
    // Ignore storage failures.
  }
}

export default function AdHocAgentTerminalModal({
  isOpen,
  scenarioKey,
  title,
  description,
  workingDirectory,
  confirmLabel = 'Start agent',
  onClose,
  buildCommand,
}: AdHocAgentTerminalModalProps) {
  const { resolvedTheme } = useTheme();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [agentProviders, setAgentProviders] = useState<ProviderCatalogEntry[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<AgentProvider>('codex');
  const [selectedModel, setSelectedModel] = useState('');
  const [agentStatus, setAgentStatus] = useState<AppStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [terminalSrc, setTerminalSrc] = useState('/terminal');
  const [terminalCommand, setTerminalCommand] = useState('');
  const [terminalProvider, setTerminalProvider] = useState<AgentProvider>('codex');
  const [terminalModel, setTerminalModel] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [isCommandInjected, setIsCommandInjected] = useState(false);
  const [hasStartedTerminal, setHasStartedTerminal] = useState(false);

  const resetState = useCallback(() => {
    setTerminalSrc('/terminal');
    setTerminalCommand('');
    setTerminalProvider('codex');
    setTerminalModel('');
    setTerminalError(null);
    setIsCommandInjected(false);
    setIsLaunching(false);
    setHasStartedTerminal(false);
    iframeRef.current = null;
  }, []);

  useEffect(() => {
    if (!isOpen) {
      resetState();
      return;
    }

    const persistedSelection = readPersistedSelection(scenarioKey);
    setSelectedProvider(persistedSelection?.provider ?? 'codex');
    setSelectedModel(persistedSelection?.model ?? '');
    setStatusError(null);
    setAgentStatus(null);
    setAgentProviders([]);
    resetState();
  }, [isOpen, resetState, scenarioKey]);

  const fetchAgentStatus = useCallback(async (provider: AgentProvider) => {
    setIsLoadingStatus(true);
    setStatusError(null);

    try {
      const response = await fetch(`/api/agent/status?provider=${encodeURIComponent(provider)}`, {
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as AgentStatusResponse | null;
      if (!payload) {
        throw new Error('Failed to load agent runtime status.');
      }

      setAgentProviders(payload.providers ?? []);
      setAgentStatus(payload.status);
      setStatusError(payload.error ?? null);

      if (!readPersistedSelection(scenarioKey) && payload.defaultProvider && payload.defaultProvider !== provider) {
        setSelectedProvider(normalizeProvider(payload.defaultProvider));
      }
    } catch (error) {
      console.error('Failed to load ad-hoc agent status:', error);
      setAgentProviders([]);
      setAgentStatus(null);
      setStatusError(error instanceof Error ? error.message : 'Failed to load agent runtime status.');
    } finally {
      setIsLoadingStatus(false);
    }
  }, [scenarioKey]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchAgentStatus(selectedProvider);
  }, [fetchAgentStatus, isOpen, selectedProvider]);

  const modelOptions = useMemo(() => {
    const models = agentStatus?.models ?? [];
    const options = [DEFAULT_MODEL_OPTION, ...models];
    if (selectedModel.trim() && !options.some((entry) => entry.id === selectedModel)) {
      options.push({
        id: selectedModel,
        label: selectedModel,
        description: 'Previously selected model.',
      });
    }
    return options;
  }, [agentStatus?.models, selectedModel]);

  const selectedModelOption = useMemo(
    () => modelOptions.find((entry) => entry.id === selectedModel) ?? DEFAULT_MODEL_OPTION,
    [modelOptions, selectedModel],
  );

  useEffect(() => {
    if (!isOpen) return;

    const nextModel = modelOptions.find((entry) => entry.id === selectedModel)?.id
      ?? agentStatus?.defaultModel
      ?? agentStatus?.models[0]?.id
      ?? '';
    if (nextModel !== selectedModel) {
      setSelectedModel(nextModel);
    }
  }, [agentStatus?.defaultModel, agentStatus?.models, isOpen, modelOptions, selectedModel]);

  useEffect(() => {
    if (!isOpen) return;
    writePersistedSelection(scenarioKey, {
      provider: selectedProvider,
      model: selectedModel,
    });
  }, [isOpen, scenarioKey, selectedModel, selectedProvider]);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  useEscapeDismiss(isOpen, handleClose);

  const handleStart = useCallback(async () => {
    setIsLaunching(true);
    setTerminalError(null);
    setIsCommandInjected(false);

    try {
      const ttydResult = await startTtydProcess();
      if (!ttydResult.success) {
        throw new Error(ttydResult.error || 'Failed to start ttyd.');
      }

      const shellKind = ttydResult.shellKind === 'powershell' ? 'powershell' : 'posix';
      const resolvedModel = selectedModel.trim()
        || agentStatus?.defaultModel
        || agentStatus?.models[0]?.id
        || '';
      const resolvedProvider = normalizeProvider(selectedProvider);
      const command = buildCommand({
        provider: resolvedProvider,
        model: resolvedModel,
        shellKind,
      });

      writePersistedSelection(scenarioKey, {
        provider: resolvedProvider,
        model: resolvedModel,
      });
      setTerminalProvider(resolvedProvider);
      setTerminalModel(resolvedModel);
      setTerminalCommand(command);
      setTerminalSrc(buildTtydTerminalSrc(`adhoc-${scenarioKey}-${Date.now()}`, 'terminal', undefined, {
        persistenceMode: 'shell',
        shellKind,
        workingDirectory,
      }));
      setHasStartedTerminal(true);
    } catch (error) {
      setTerminalError(error instanceof Error ? error.message : 'Failed to initialize ad-hoc agent session.');
    } finally {
      setIsLaunching(false);
    }
  }, [agentStatus?.defaultModel, agentStatus?.models, buildCommand, scenarioKey, selectedModel, selectedProvider, workingDirectory]);

  const handleTerminalLoad = useCallback(() => {
    if (!hasStartedTerminal || !terminalCommand || !iframeRef.current || isCommandInjected) {
      return;
    }

    const iframe = iframeRef.current;
    const checkAndInject = (attempts = 0) => {
      if (attempts > 40) {
        setTerminalError('Timed out while waiting for terminal to initialize.');
        return;
      }

      try {
        const win = iframe.contentWindow as TerminalWindow | null;
        if (win?.term) {
          const shouldUseDark = resolveShouldUseDarkTheme(
            resolvedTheme === 'light' || resolvedTheme === 'dark' ? resolvedTheme : 'auto',
            window.matchMedia('(prefers-color-scheme: dark)').matches,
          );
          applyThemeToTerminalWindow(
            win,
            shouldUseDark ? TERMINAL_THEME_DARK : TERMINAL_THEME_LIGHT,
          );
          win.term.paste(`${terminalCommand}\r`);
          setIsCommandInjected(true);
          setTerminalError(null);
          win.focus();
          return;
        }

        window.setTimeout(() => checkAndInject(attempts + 1), 300);
      } catch (error) {
        console.error('Failed to inject ad-hoc agent command into terminal iframe:', error);
        setTerminalError('Could not access ttyd terminal. Ensure ttyd is running and try again.');
      }
    };

    window.setTimeout(() => checkAndInject(), 500);
  }, [hasStartedTerminal, isCommandInjected, resolvedTheme, terminalCommand]);

  if (!isOpen) {
    return null;
  }

  const displayedProviders = agentProviders.length > 0
    ? agentProviders
    : SUPPORTED_AGENT_PROVIDERS.map((providerId) => ({
      id: providerId,
      label: providerLabel(providerId),
      description: '',
      available: true,
    }));

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-w-5xl p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-[#30363d]">
          <div>
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">{title}</h3>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-500 break-all">
              Repository: {workingDirectory}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={handleClose}
          >
            Close
          </button>
        </div>

        {!hasStartedTerminal ? (
          <div className="space-y-4 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Provider</span>
                <div className="relative">
                  <select
                    className="h-10 w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 pr-10 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-[#30363d] dark:bg-[#0d1117] dark:text-slate-100"
                    value={selectedProvider}
                    onChange={(event) => setSelectedProvider(normalizeProvider(event.target.value))}
                  >
                    {displayedProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-500" />
                </div>
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Model</span>
                <div className="relative">
                  <select
                    className="h-10 w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 pr-10 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-[#30363d] dark:bg-[#0d1117] dark:text-slate-100"
                    value={selectedModel}
                    onChange={(event) => setSelectedModel(event.target.value)}
                  >
                    {modelOptions.map((model) => (
                      <option key={model.id || 'default-model'} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-500" />
                </div>
                {selectedModelOption.description ? (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {selectedModelOption.description}
                  </span>
                ) : null}
              </label>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 dark:border-[#30363d] dark:bg-[#0d1117]/55">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {providerLabel(selectedProvider, agentProviders)}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {isLoadingStatus
                      ? 'Checking runtime status...'
                      : agentStatus
                        ? [
                          agentStatus.installed ? 'Installed' : 'Not installed',
                          agentStatus.loggedIn ? 'Logged in' : 'Login required',
                          agentStatus.version ? `v${agentStatus.version}` : null,
                        ].filter(Boolean).join(' • ')
                        : 'Runtime status unavailable'}
                  </div>
                  {agentStatus?.account?.email ? (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {agentStatus.account.email}
                      {agentStatus.account.planType ? ` • ${agentStatus.account.planType}` : ''}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#30363d] dark:bg-[#0d1117] dark:text-slate-200 dark:hover:bg-[#161b22]"
                  onClick={() => void fetchAgentStatus(selectedProvider)}
                  disabled={isLoadingStatus}
                >
                  Refresh
                </button>
              </div>
              {statusError ? (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
                  {statusError}
                </div>
              ) : null}
              {terminalError ? (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
                  {terminalError}
                </div>
              ) : null}
            </div>

            <div className="modal-action mt-0">
              <button className="btn" onClick={handleClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void handleStart()}
                disabled={isLaunching}
              >
                {isLaunching ? (
                  <>
                    <span className="loading loading-spinner loading-xs"></span>
                    Starting...
                  </>
                ) : confirmLabel}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {providerLabel(terminalProvider, agentProviders)}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Model: {terminalModel || 'Default model'}
                </div>
              </div>
            </div>

            {terminalError ? (
              <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
                {terminalError}
              </div>
            ) : null}

            <div className="h-[420px] overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-[#30363d] dark:bg-[#0d1117]">
              <iframe
                key={terminalSrc}
                ref={iframeRef}
                src={terminalSrc}
                className="h-full w-full border-none"
                allow="clipboard-read; clipboard-write"
                onLoad={handleTerminalLoad}
              />
            </div>

            <div className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              {isCommandInjected
                ? 'Agent command was sent to the terminal automatically.'
                : 'Waiting for terminal to initialize...'}
            </div>
          </div>
        )}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={handleClose}>close</button>
      </form>
    </dialog>
  );
}

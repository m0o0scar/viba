'use client';

import React, { useState, useEffect } from 'react';
import { FolderGit2, GitBranch as GitBranchIcon, Plus, X, ChevronRight, Check, Settings, FolderCog, Bot, Cpu, Trash2 } from 'lucide-react';
import FileBrowser from './FileBrowser';
import { checkIsGitRepo, getBranches, checkoutBranch, GitBranch, startTtydProcess, getStartupScript, listRepoFiles, saveAttachments } from '@/app/actions/git';
import { createSession, listSessions, SessionMetadata, deleteSession, saveSessionLaunchContext } from '@/app/actions/session';
import { getConfig, updateConfig, updateRepoSettings, Config } from '@/app/actions/config';
import { useRouter } from 'next/navigation';
import { Play } from 'lucide-react'; // Added Play icon for resume

import agentProvidersDataRaw from '@/data/agent-providers.json';

type Model = {
  id: string;
  label: string;
  description?: string;
};

type AgentProvider = {
  name: string;
  cli: string;
  description?: string;
  models: Model[];
};

const agentProvidersData = agentProvidersDataRaw as unknown as AgentProvider[];


export default function GitRepoSelector() {
  const [view, setView] = useState<'list' | 'details'>('list');
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [isSelectingRoot, setIsSelectingRoot] = useState(false);

  const [config, setConfig] = useState<Config | null>(null);

  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);

  const router = useRouter();

  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [currentBranchName, setCurrentBranchName] = useState<string>('');
  const [existingSessions, setExistingSessions] = useState<SessionMetadata[]>([]);
  const [allSessions, setAllSessions] = useState<SessionMetadata[]>([]);

  const [selectedProvider, setSelectedProvider] = useState<AgentProvider | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [startupScript, setStartupScript] = useState<string>('');
  const [devServerScript, setDevServerScript] = useState<string>('');
  const [showSessionAdvanced, setShowSessionAdvanced] = useState(false);

  const [loading, setLoading] = useState(false);
  const [deletingSessionName, setDeletingSessionName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load config and all sessions on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [cfg, sessions] = await Promise.all([
          getConfig(),
          listSessions()
        ]);
        setConfig(cfg);
        setAllSessions(sessions);
      } catch (e) {
        console.error('Failed to load data', e);
      } finally {
        setIsLoaded(true);
      }
    };
    loadData();
  }, []);

  const handleSelectRepo = async (
    path: string,
    options?: { navigateToDetails?: boolean }
  ) => {
    const navigateToDetails = options?.navigateToDetails ?? true;
    setLoading(true);
    setError(null);
    try {
      const isValid = await checkIsGitRepo(path);
      if (!isValid) {
        setError('Selected directory is not a valid git repository.');
        setLoading(false);
        return;
      }

      const currentConfig = config || await getConfig();
      let newRecent = [...currentConfig.recentRepos];
      if (!newRecent.includes(path)) {
        newRecent.unshift(path);
      } else {
        // Move to top
        newRecent = [path, ...newRecent.filter(r => r !== path)];
      }

      // Update config
      const newConfig = await updateConfig({ recentRepos: newRecent });
      setConfig(newConfig);

      setIsBrowsing(false);

      if (!navigateToDetails) {
        return;
      }

      setSelectedRepo(path);
      setView('details');

      // Load saved provider/model
      await loadSavedAgentSettings(path);

      // Load branches
      await loadBranches(path);

      // Load sessions
      const sessions = await listSessions(path);
      setExistingSessions(sessions);

      // Also refresh all sessions to keep the list view count accurate
      const allSess = await listSessions();
      setAllSessions(allSess);

    } catch (err) {
      console.error(err);
      setError('Failed to open repository.');
    } finally {
      setLoading(false);
    }
  };

  const loadSavedAgentSettings = async (repoPath: string) => {
    // Refresh config to ensure we have latest settings?
    // We can just rely on current config state if we assume single user or minimal concurrency.
    // Or we can refetch.
    const currentConfig = config || await getConfig();
    if (!config) setConfig(currentConfig);

    const settings = currentConfig.repoSettings[repoPath] || {};

    const savedProviderCli = settings.agentProvider;
    const savedModel = settings.agentModel;
    const savedStartupScript = settings.startupScript;
    const savedDevServerScript = settings.devServerScript;

    if (savedProviderCli) {
      const provider = agentProvidersData.find(p => p.cli === savedProviderCli);
      if (provider) {
        setSelectedProvider(provider);
        if (savedModel && provider.models.some(m => m.id === savedModel)) {
          setSelectedModel(savedModel);
        } else {
          setSelectedModel(provider.models[0].id);
        }
      } else {
        // Default if saved one is invalid
        setSelectedProvider(agentProvidersData[0]);
        setSelectedModel(agentProvidersData[0].models[0].id);
      }
    } else {
      // Default
      setSelectedProvider(agentProvidersData[0]);
      setSelectedModel(agentProvidersData[0].models[0].id);
    }

    if (savedStartupScript !== undefined && savedStartupScript !== null) {
      setStartupScript(savedStartupScript);
    } else {
      // Determine default based on repo content
      const defaultScript = await getStartupScript(repoPath);
      setStartupScript(defaultScript);
    }

    if (savedDevServerScript !== undefined && savedDevServerScript !== null) {
      setDevServerScript(savedDevServerScript);
    } else {
      setDevServerScript('');
    }
  };

  const handleSetDefaultRoot = async (path: string) => {
    const newConfig = await updateConfig({ defaultRoot: path });
    setConfig(newConfig);
    setIsSelectingRoot(false);
  };

  const loadBranches = async (repoPath: string) => {
    try {
      const data = await getBranches(repoPath);
      setBranches(data);

      const currentConfig = config || await getConfig();
      const settings = currentConfig.repoSettings[repoPath] || {};
      const lastPicked = settings.lastBranch;

      // Check current checked out branch
      const currentCheckedOut = data.find(b => b.current)?.name;

      if (lastPicked && data.some(b => b.name === lastPicked)) {
        setCurrentBranchName(lastPicked);
        if (lastPicked !== currentCheckedOut) {
          try {
            await checkoutBranch(repoPath, lastPicked);
            const updatedData = await getBranches(repoPath);
            setBranches(updatedData);
          } catch (e) {
            console.warn("Could not auto-checkout to remembered branch", e);
            if (currentCheckedOut) setCurrentBranchName(currentCheckedOut);
          }
        }
      } else {
        if (currentCheckedOut) setCurrentBranchName(currentCheckedOut);
      }
    } catch (e) {
      console.error("Failed to load branches", e);
      setError("Failed to load branches.");
    }
  };

  const handleBranchChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newBranch = e.target.value;
    if (!selectedRepo) return;

    setLoading(true);
    try {
      await checkoutBranch(selectedRepo, newBranch);
      setCurrentBranchName(newBranch);

      const newConfig = await updateRepoSettings(selectedRepo, { lastBranch: newBranch });
      setConfig(newConfig);

      const data = await getBranches(selectedRepo);
      setBranches(data);
    } catch (e) {
      setError(`Failed to checkout branch ${newBranch}`);
    } finally {
      setLoading(false);
    }
  };

  const handleProviderChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const cli = e.target.value;
    const provider = agentProvidersData.find(p => p.cli === cli);
    if (provider && selectedRepo) {
      setSelectedProvider(provider);
      // Default to first model
      const defaultModel = provider.models[0].id;
      setSelectedModel(defaultModel);

      const newConfig = await updateRepoSettings(selectedRepo, {
        agentProvider: provider.cli,
        agentModel: defaultModel
      });
      setConfig(newConfig);
    }
  };

  const handleModelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const model = e.target.value;
    setSelectedModel(model);
    if (selectedRepo) {
      const newConfig = await updateRepoSettings(selectedRepo, { agentModel: model });
      setConfig(newConfig);
    }
  };

  const handleStartupScriptChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const script = e.target.value;
    setStartupScript(script);
    // Debounce saving? Or just save on blur/change?
    // For simplicity, I'll save on change but it triggers server action every keystroke which is bad.
    // Better to save on blur or debounce.
    // Or just save when starting session?
    // The previous code saved on every change to localStorage.
    // Let's rely on saving when starting session? No, we want to persist even if not started.
    // I'll save on blur for now, or just save here and accept the cost.
    // Given the "async" nature, let's just save. But it might be laggy.
    // Actually, let's just update local state here, and use `onBlur` to save.
  };

  const saveStartupScript = async () => {
    if (selectedRepo) {
      const newConfig = await updateRepoSettings(selectedRepo, { startupScript });
      setConfig(newConfig);
    }
  }

  const handleDevServerScriptChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDevServerScript(e.target.value);
  };

  const saveDevServerScript = async () => {
    if (selectedRepo) {
      const newConfig = await updateRepoSettings(selectedRepo, { devServerScript });
      setConfig(newConfig);
    }
  };

  const [initialMessage, setInitialMessage] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [attachments, setAttachments] = useState<File[]>([]);

  // Suggestion state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionList, setSuggestionList] = useState<string[]>([]);
  const [, setSuggestionQuery] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Cache filtered files
  const [repoFilesCache, setRepoFilesCache] = useState<string[]>([]);

  const updateSuggestions = (query: string, files: string[], currentAttachments: File[]) => {
    const lowerQ = query.toLowerCase();

    const attachmentNames = currentAttachments.map(f => f.name);
    // prioritize attachments
    const matchedAttachments = attachmentNames.filter(n => n.toLowerCase().includes(lowerQ));
    const matchedFiles = files.filter(f => f.toLowerCase().includes(lowerQ)).slice(0, 20);

    const newList = [...matchedAttachments, ...matchedFiles];
    setSuggestionList(newList);
    setSelectedIndex(0); // Reset selection
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd+Enter to submit
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleStartSession();
      return;
    }

    if (showSuggestions && suggestionList.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : suggestionList.length - 1)); // Wrap around
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev < suggestionList.length - 1 ? prev + 1 : 0)); // Wrap around
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelectSuggestion(suggestionList[selectedIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
      }
    }
  };

  const handleMessageChange = async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    setInitialMessage(val);
    setCursorPosition(pos);

    // Check for @ mention
    const textBeforeCursor = val.substring(0, pos);
    const lastAt = textBeforeCursor.lastIndexOf('@');

    if (lastAt !== -1) {
      const query = textBeforeCursor.substring(lastAt + 1);
      if (!/\s/.test(query)) {
        setSuggestionQuery(query);
        setShowSuggestions(true);

        if (selectedRepo) {
          let files = repoFilesCache;
          if (repoFilesCache.length === 0) {
            files = await listRepoFiles(selectedRepo);
            setRepoFilesCache(files);
          }
          updateSuggestions(query, files, attachments);
        }
        return;
      }
    }

    setShowSuggestions(false);
  };

  const handleSelectSuggestion = (suggestion: string) => {
    const textBeforeCursor = initialMessage.substring(0, cursorPosition);
    const lastAt = textBeforeCursor.lastIndexOf('@');

    if (lastAt !== -1) {
      const prefix = initialMessage.substring(0, lastAt);
      const suffix = initialMessage.substring(cursorPosition);

      const newValue = `${prefix}@${suggestion} ${suffix}`;
      setInitialMessage(newValue);
      setShowSuggestions(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachments(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };


  const handleRemoveRecent = async (e: React.MouseEvent, repo: string) => {
    e.stopPropagation();
    if (config) {
      const newRecent = config.recentRepos.filter(r => r !== repo);
      const newConfig = await updateConfig({ recentRepos: newRecent });
      setConfig(newConfig);
    }
  };

  const handleStartSession = async () => {
    if (!selectedRepo) return;
    setLoading(true);

    // Also save startup script if changed
    await saveStartupScript();
    await saveDevServerScript();

    try {
      // 1. Start TTYD if needed
      const ttydResult = await startTtydProcess();
      if (!ttydResult.success) {
        setError(ttydResult.error || "Failed to start ttyd");
        setLoading(false);
        return;
      }

      // 2. Create Session Worktree
      // Use current selected branch as base
      const baseBranch = currentBranchName || 'main'; // Fallback to main if empty, though shouldn't happen

      const wtResult = await createSession(selectedRepo, baseBranch, {
        agent: selectedProvider?.cli || 'agent',
        model: selectedModel || '',
        title: title,
        devServerScript: devServerScript || undefined
      });

      if (wtResult.success && wtResult.sessionName && wtResult.worktreePath && wtResult.branchName) {
        // NEW: Upload attachments
        if (attachments.length > 0) {
          const formData = new FormData();
          attachments.forEach(file => formData.append(file.name, file)); // Use filename as key or just 'files'
          // Backend iterates entries [name, file].
          await saveAttachments(wtResult.worktreePath, formData);
        }

        // NEW: Process initial message mentions
        let processedMessage = initialMessage;

        // Helper to match replacement
        processedMessage = processedMessage.replace(/@(\S+)/g, (match, name) => {
          if (attachments.some(a => a.name === name)) {
            return `${wtResult.worktreePath}-attachments/${name}`;
          }
          // Assume repo file - keep relative path as we run in worktree root
          return name;
        });

        // 3. Persist launch context for the new session
        const launchContextResult = await saveSessionLaunchContext(wtResult.sessionName, {
          title: title || undefined,
          initialMessage: processedMessage || undefined,
          startupScript: startupScript || undefined,
          attachmentNames: attachments.map(file => file.name),
          agentProvider: selectedProvider?.cli || 'agent',
          model: selectedModel || '',
        });

        if (!launchContextResult.success) {
          setError(launchContextResult.error || 'Failed to save session context');
          setLoading(false);
          return;
        }

        // 4. Navigate to session page by path only
        const dest = `/session/${wtResult.sessionName}`;
        router.push(dest);
        setLoading(false);

        // No need to refresh sessions as we are navigating away
      } else {
        setError(wtResult.error || "Failed to create session worktree");
        setLoading(false);
      }

    } catch (e) {
      console.error(e);
      setError("Failed to start session");
      setLoading(false);
    }
  };

  const handleResumeSession = async (session: SessionMetadata) => {
    if (!selectedRepo) return;
    setLoading(true);

    try {
      // 1. Start TTYD
      const ttydResult = await startTtydProcess();
      if (!ttydResult.success) {
        setError(ttydResult.error || "Failed to start ttyd");
        setLoading(false);
        return;
      }

      // 2. Navigate — session already has initialized=true so SessionPageClient will resume
      const dest = `/session/${session.sessionName}`;
      router.push(dest);
      setLoading(false);

    } catch (e) {
      console.error(e);
      setError("Failed to resume session");
      setLoading(false);
    }
  };

  const handleDeleteSession = async (session: SessionMetadata) => {
    if (!selectedRepo) return;

    const confirmed = confirm(
      `Delete session "${session.sessionName}"?\n\nThis will remove the worktree, branch, and session metadata.`
    );
    if (!confirmed) return;

    setDeletingSessionName(session.sessionName);
    setError(null);

    try {
      const result = await deleteSession(session.sessionName);
      if (!result.success) {
        setError(result.error || 'Failed to delete session');
        return;
      }

      const sessions = await listSessions(selectedRepo);
      setExistingSessions(sessions);

      // Also refresh all sessions
      const allSess = await listSessions();
      setAllSessions(allSess);
    } catch (e) {
      console.error(e);
      setError('Failed to delete session');
    } finally {
      setDeletingSessionName(null);
    }
  };

  return (
    <>
      {view === 'list' && (
        <div className="card w-full max-w-2xl bg-base-200 shadow-xl">
          <div className="card-body">
            <h2 className="card-title flex justify-between items-center">
              <div className="flex items-center gap-2">
                <FolderGit2 className="w-6 h-6 text-primary" />
                Git Repository Selector
              </div>
            </h2>

            {error && <div className="alert alert-error text-sm py-2 px-3 mt-2">{error}</div>}

            <div className="mt-4 space-y-4">
              <div className="flex justify-end gap-2">
                <button
                  className="btn btn-ghost btn-sm gap-2"
                  onClick={() => setIsSelectingRoot(true)}
                  title={config?.defaultRoot ? `Default: ${config.defaultRoot}` : "Set default browsing folder"}
                >
                  <FolderCog className="w-4 h-4" />
                  {config?.defaultRoot ? "Change Default" : "Set Default Root"}
                </button>
                <button className="btn btn-primary btn-sm gap-2" onClick={() => setIsBrowsing(true)}>
                  <Plus className="w-4 h-4" /> Open Local Repo
                </button>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold opacity-70 uppercase tracking-wide">Recent Repositories</h3>
                {!isLoaded ? (
                  <div className="flex items-center justify-center py-8 bg-base-100 rounded-lg">
                    <span className="loading loading-spinner loading-md"></span>
                  </div>
                ) : (!config || config.recentRepos.length === 0) ? (
                  <div className="text-center py-8 text-base-content/40 italic bg-base-100 rounded-lg">
                    No recent repositories found.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {config.recentRepos.map(repo => {
                      const sessionCount = allSessions.filter(s => s.repoPath === repo).length;
                      return (
                        <div
                          key={repo}
                          onClick={() => handleSelectRepo(repo)}
                          className="flex items-center justify-between p-3 bg-base-100 hover:bg-base-300 rounded-md cursor-pointer group transition-all border border-base-300"
                        >
                          <div className="flex items-center gap-3 overflow-hidden shrink min-w-0">
                            <FolderGit2 className="w-5 h-5 text-secondary shrink-0" />
                            <div className="flex flex-col overflow-hidden">
                              <span className="font-medium truncate">{repo.split('/').pop()}</span>
                              <span className="text-xs opacity-50 truncate">{repo}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {sessionCount > 0 && (
                              <div className="badge badge-secondary badge-sm gap-1 opacity-80" title={`${sessionCount} on-going sessions`}>
                                <Bot className="w-3 h-3" />
                                {sessionCount}
                              </div>
                            )}
                            <button
                              onClick={(e) => handleRemoveRecent(e, repo)}
                              className="btn btn-circle btn-ghost btn-xs opacity-0 group-hover:opacity-100 text-error"
                              title="Remove from history"
                            >
                              <X className="w-3 h-3" />
                            </button>
                            <ChevronRight className="w-4 h-4 opacity-30" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {view === 'details' && selectedRepo && (
        <div className="w-full max-w-6xl space-y-4">
          {error && <div className="alert alert-error text-sm py-2 px-3">{error}</div>}
          <div className="flex flex-col gap-4 w-full">
            <div className="card w-full bg-base-200 shadow-xl">
              <div className="card-body">
                <h2 className="card-title flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <FolderGit2 className="w-6 h-6 text-primary" />
                    Git Repository Selector
                  </div>
                  <button className="btn btn-sm btn-ghost" onClick={() => setView('list')}>
                    Change Repo
                  </button>
                </h2>

                <div className="mt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-base-100 p-4 rounded-lg border border-base-300 flex flex-col justify-center">
                      <div className="text-xs opacity-50 uppercase tracking-widest mb-1">Current Repository</div>
                      <div className="flex items-center gap-2 font-mono text-sm break-all">
                        <FolderGit2 className="w-4 h-4 text-primary shrink-0" />
                        {selectedRepo}
                      </div>
                    </div>

                    {/* Branch Selection */}
                    <div className="bg-base-100 p-4 rounded-lg border border-base-300 space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-sm font-medium opacity-70 uppercase tracking-widest">Current Branch</label>
                        {loading && <span className="loading loading-spinner loading-xs"></span>}
                      </div>

                      <div className="join w-full">
                        <div className="join-item bg-base-300 flex items-center px-3 border border-base-content/20 border-r-0">
                          <GitBranchIcon className="w-4 h-4" />
                        </div>
                        <select
                          className="select select-bordered join-item w-full font-mono focus:outline-none"
                          value={currentBranchName}
                          onChange={handleBranchChange}
                          disabled={loading}
                        >
                          {branches.map(branch => (
                            <option key={branch.name} value={branch.name}>
                              {branch.name} {branch.current ? '(checked out)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="text-[10px] opacity-50 px-1 italic">
                        Switching branches updates the working directory.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Continue Existing Session Card */}
            {existingSessions.length > 0 && (
              <div className="card w-full bg-base-200 shadow-xl">
                <div className="card-body">
                  <h2 className="card-title flex items-center gap-2">
                    <Play className="w-6 h-6 text-success" />
                    Continue Existing Session
                  </h2>
                  <div className="flex flex-col gap-2 mt-4 max-h-64 overflow-y-auto">
                    {existingSessions.map((session) => (
                      <div key={session.sessionName} className="flex flex-col gap-2 p-3 bg-base-100 rounded-md border border-base-300">
                        <div className="flex justify-between items-start">
                          <div>
                            {session.title && <div className="font-semibold">{session.title}</div>}
                            <div className="text-xs opacity-60 font-mono">{session.sessionName}</div>
                            <div className="text-xs opacity-60 mt-1">
                              Agent: {session.agent} • Model: {session.model}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              className="btn btn-sm btn-success btn-outline gap-2"
                              onClick={() => handleResumeSession(session)}
                              disabled={loading || deletingSessionName === session.sessionName}
                            >
                              <Play className="w-3 h-3" /> Resume
                            </button>
                            <button
                              className="btn btn-sm btn-error btn-outline gap-2"
                              onClick={() => handleDeleteSession(session)}
                              disabled={loading || deletingSessionName === session.sessionName}
                            >
                              <Trash2 className="w-3 h-3" />
                              {deletingSessionName === session.sessionName ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Start New Session Card */}
            <div className="card w-full bg-base-200 shadow-xl">
              <div className="card-body">
                <h2 className="card-title flex items-center gap-2">
                  <Bot className="w-6 h-6 text-secondary" />
                  Start New Session
                </h2>

                <div className="mt-4 space-y-6">
                  <div className="space-y-3">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm px-2 h-auto min-h-0 normal-case justify-start gap-2"
                      onClick={() => setShowSessionAdvanced(prev => !prev)}
                    >
                      <ChevronRight className={`w-4 h-4 transition-transform ${showSessionAdvanced ? 'rotate-90' : ''}`} />
                      {showSessionAdvanced ? 'Hide Session Setup' : 'Show Session Setup'}
                    </button>

                    {showSessionAdvanced && (
                      <>
                        {/* Agent Selection */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium opacity-70">Agent Provider</label>
                            <div className="join w-full">
                              <div className="join-item bg-base-300 flex items-center px-3 border border-base-content/20 border-r-0">
                                <Bot className="w-4 h-4" />
                              </div>
                              <select
                                className="select select-bordered join-item w-full focus:outline-none"
                                value={selectedProvider?.cli || ''}
                                onChange={handleProviderChange}
                                disabled={loading}
                              >
                                {agentProvidersData.map(provider => (
                                  <option key={provider.cli} value={provider.cli}>
                                    {provider.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {selectedProvider?.description && (
                              <p className="text-[10px] opacity-60 mt-1 pl-1 italic leading-tight">
                                {selectedProvider.description}
                              </p>
                            )}
                          </div>

                          <div className="space-y-2">
                            <label className="text-sm font-medium opacity-70">Model</label>
                            <div className="join w-full">
                              <div className="join-item bg-base-300 flex items-center px-3 border border-base-content/20 border-r-0">
                                <Cpu className="w-4 h-4" />
                              </div>
                              <select
                                className="select select-bordered join-item w-full focus:outline-none"
                                value={selectedModel}
                                onChange={handleModelChange}
                                disabled={loading || !selectedProvider}
                              >
                                {selectedProvider?.models.map(model => (
                                  <option key={model.id} value={model.id}>
                                    {model.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {selectedProvider?.models.find(m => m.id === selectedModel)?.description && (
                              <p className="text-[10px] opacity-60 mt-1 pl-1 italic leading-tight">
                                {selectedProvider.models.find(m => m.id === selectedModel)?.description}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium opacity-70">Start up script (Optional)</label>
                          <input
                            type="text"
                            className="input input-bordered w-full font-mono text-sm"
                            placeholder="npm i"
                            value={startupScript}
                            onChange={handleStartupScriptChange}
                            onBlur={saveStartupScript}
                            onKeyDown={(e) => {
                              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                e.preventDefault();
                                handleStartSession();
                              }
                            }}
                            disabled={loading}
                          />
                          <div className="text-xs opacity-50 px-1">
                            Script to run in the terminal agent iframe upon startup.
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium opacity-70">Dev server script (Optional)</label>
                          <input
                            type="text"
                            className="input input-bordered w-full font-mono text-sm"
                            placeholder="npm run dev"
                            value={devServerScript}
                            onChange={handleDevServerScriptChange}
                            onBlur={saveDevServerScript}
                            onKeyDown={(e) => {
                              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                e.preventDefault();
                                handleStartSession();
                              }
                            }}
                            disabled={loading}
                          />
                          <div className="text-xs opacity-50 px-1">
                            Script for the Session View Start Dev Server button in the right terminal.
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="divider"></div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium opacity-70">Title (Optional)</label>
                    <input
                      type="text"
                      className="input input-bordered w-full font-mono text-sm"
                      placeholder="Task Title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                          e.preventDefault();
                          handleStartSession();
                        }
                      }}
                      disabled={loading}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium opacity-70">Initial Message (Optional)</label>
                    <div className="relative">
                      <textarea
                        className="textarea textarea-bordered w-full h-64 font-mono text-sm leading-tight resize-none"
                        placeholder="Describe what you want the agent to do... Type @ to mention files."
                        value={initialMessage}
                        onChange={handleMessageChange}
                        onKeyDown={handleKeyDown}
                        onClick={(e) => {
                          setCursorPosition(e.currentTarget.selectionStart);
                          setShowSuggestions(false); // Hide on click? Or re-val?
                        }}
                        onKeyUp={(e) => setCursorPosition(e.currentTarget.selectionStart)}
                        disabled={loading}
                      ></textarea>
                      {showSuggestions && suggestionList.length > 0 && (
                        <div className="absolute left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto bg-base-100 border border-base-300 rounded-md shadow-lg">
                          {suggestionList.map((s, idx) => (
                            <button
                              key={s}
                              className={`w-full text-left px-3 py-2 text-xs border-b border-base-200 last:border-0 truncate ${idx === selectedIndex ? 'bg-primary text-primary-content' : 'hover:bg-primary/10'
                                }`}
                              onMouseDown={(e) => {
                                e.preventDefault(); // Prevent blur
                                handleSelectSuggestion(s);
                              }}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium opacity-70">Attachments (Optional)</label>
                    <input
                      type="file"
                      multiple
                      className="file-input file-input-bordered w-full"
                      onChange={handleFileSelect}
                      disabled={loading}
                    />
                    {attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {attachments.map((file, idx) => (
                          <span key={idx} className="badge badge-neutral gap-2 p-3">
                            {file.name}
                            <button onClick={() => removeAttachment(idx)} className="btn btn-ghost btn-xs btn-circle text-error">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="card-actions justify-end mt-4">
                    <button
                      className="btn btn-primary btn-wide shadow-lg"
                      onClick={handleStartSession}
                      disabled={loading}
                    >
                      {loading ? <span className="loading loading-spinner"></span> : "Start Session"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}



      {isBrowsing && (
        <FileBrowser
          initialPath={config?.defaultRoot || undefined}
          onSelect={(path) => handleSelectRepo(path, { navigateToDetails: false })}
          onCancel={() => setIsBrowsing(false)}
          checkRepo={checkIsGitRepo}
        />
      )}

      {isSelectingRoot && (
        <FileBrowser
          initialPath={config?.defaultRoot || undefined}
          onSelect={handleSetDefaultRoot}
          onCancel={() => setIsSelectingRoot(false)}
        />
      )}
    </>
  );
}

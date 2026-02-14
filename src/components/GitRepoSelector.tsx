'use client';

import React, { useState, useEffect } from 'react';
import { FolderGit2, GitBranch as GitBranchIcon, Plus, X, ChevronRight, Check, Settings, FolderCog, Bot, Cpu } from 'lucide-react';
import FileBrowser from './FileBrowser';
import { checkIsGitRepo, getBranches, checkoutBranch, GitBranch, startTtydProcess, createSessionWorktree, getStartupScript, listRepoFiles, saveAttachments } from '@/app/actions/git';
import { useRouter } from 'next/navigation';

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

interface GitRepoSelectorProps {
  onStartSession?: (sessionDetails: {
    repo: string;
    worktree: string;
    branch: string;
    sessionName: string;
    agent: string;
    model: string;
    startupScript: string;
    initialMessage: string;
    attachments: File[];
  }) => void;
}

export default function GitRepoSelector({ onStartSession }: GitRepoSelectorProps) {
  const [view, setView] = useState<'list' | 'details'>('list');
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [isSelectingRoot, setIsSelectingRoot] = useState(false);
  const [recentRepos, setRecentRepos] = useState<string[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [defaultRoot, setDefaultRoot] = useState<string>('');

  const router = useRouter();

  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [currentBranchName, setCurrentBranchName] = useState<string>('');

  const [selectedProvider, setSelectedProvider] = useState<AgentProvider | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [startupScript, setStartupScript] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load recent repos and default root on mount
  useEffect(() => {
    const savedRepos = localStorage.getItem('viba_recent_repos');
    if (savedRepos) {
      try {
        setRecentRepos(JSON.parse(savedRepos));
      } catch (e) {
        console.error('Failed to parse recent repos', e);
      }
    }

    const savedRoot = localStorage.getItem('viba_default_root');
    if (savedRoot) {
      setDefaultRoot(savedRoot);
    }
    setIsLoaded(true);
  }, []);

  // Save recent repos whenever changed, but only after initial load
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('viba_recent_repos', JSON.stringify(recentRepos));
    }
  }, [recentRepos, isLoaded]);

  const handleSelectRepo = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const isValid = await checkIsGitRepo(path);
      if (!isValid) {
        setError('Selected directory is not a valid git repository.');
        setLoading(false);
        // Do not close browser if invalid, let user try again
        return;
      }

      // Add to recent if not exists
      let newRecent = [...recentRepos];
      if (!newRecent.includes(path)) {
        newRecent.unshift(path);
      } else {
        // Move to top
        newRecent = [path, ...newRecent.filter(r => r !== path)];
      }
      setRecentRepos(newRecent);

      setSelectedRepo(path);
      setIsBrowsing(false);
      setView('details');

      // Load saved provider/model
      await loadSavedAgentSettings(path);

      // Load branches
      await loadBranches(path);

    } catch (err) {
      console.error(err);
      setError('Failed to open repository.');
    } finally {
      setLoading(false);
    }
  };

  const loadSavedAgentSettings = async (repoPath: string) => {
    const savedProviderCli = localStorage.getItem(`viba_agent_provider_${repoPath}`);
    const savedModel = localStorage.getItem(`viba_agent_model_${repoPath}`);
    const savedStartupScript = localStorage.getItem(`viba_startup_script_${repoPath}`);

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

    if (savedStartupScript !== null) {
      // If it was explicitly saved (even as empty string), use it
      setStartupScript(savedStartupScript);
    } else {
      // Determine default based on repo content
      const defaultScript = await getStartupScript(repoPath);
      setStartupScript(defaultScript);
    }
  };

  const handleSetDefaultRoot = (path: string) => {
    setDefaultRoot(path);
    localStorage.setItem('viba_default_root', path);
    setIsSelectingRoot(false);
  };

  const loadBranches = async (repoPath: string) => {
    try {
      const data = await getBranches(repoPath);
      setBranches(data);

      // 1. Check local storage for last picked
      const lastPicked = localStorage.getItem(`viba_branch_${repoPath}`);

      // 2. Check current checked out branch
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
      localStorage.setItem(`viba_branch_${selectedRepo}`, newBranch);

      const data = await getBranches(selectedRepo);
      setBranches(data);
    } catch (e) {
      setError(`Failed to checkout branch ${newBranch}`);
    } finally {
      setLoading(false);
    }
  };

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const cli = e.target.value;
    const provider = agentProvidersData.find(p => p.cli === cli);
    if (provider && selectedRepo) {
      setSelectedProvider(provider);
      // Default to first model
      const defaultModel = provider.models[0].id;
      setSelectedModel(defaultModel);

      localStorage.setItem(`viba_agent_provider_${selectedRepo}`, provider.cli);
      localStorage.setItem(`viba_agent_model_${selectedRepo}`, defaultModel);
    }
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const model = e.target.value;
    setSelectedModel(model);
    if (selectedRepo) {
      localStorage.setItem(`viba_agent_model_${selectedRepo}`, model);
    }
  };

  const handleStartupScriptChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const script = e.target.value;
    setStartupScript(script);
    if (selectedRepo) {
      localStorage.setItem(`viba_startup_script_${selectedRepo}`, script);
    }
  };

  const [initialMessage, setInitialMessage] = useState<string>('');
  const [attachments, setAttachments] = useState<File[]>([]);

  // Suggestion state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionList, setSuggestionList] = useState<string[]>([]);
  const [, setSuggestionQuery] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0); // NEW

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
      // Focus logic could go here if we had ref
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


  const handleRemoveRecent = (e: React.MouseEvent, repo: string) => {
    e.stopPropagation();
    setRecentRepos(prev => prev.filter(r => r !== repo));
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
                  title={defaultRoot ? `Default: ${defaultRoot}` : "Set default browsing folder"}
                >
                  <FolderCog className="w-4 h-4" />
                  {defaultRoot ? "Change Default" : "Set Default Root"}
                </button>
                <button className="btn btn-primary btn-sm gap-2" onClick={() => setIsBrowsing(true)}>
                  <Plus className="w-4 h-4" /> Open Local Repo
                </button>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold opacity-70 uppercase tracking-wide">Recent Repositories</h3>
                {recentRepos.length === 0 ? (
                  <div className="text-center py-8 text-base-content/40 italic bg-base-100 rounded-lg">
                    No recent repositories found.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {recentRepos.map(repo => (
                      <div
                        key={repo}
                        onClick={() => handleSelectRepo(repo)}
                        className="flex items-center justify-between p-3 bg-base-100 hover:bg-base-300 rounded-md cursor-pointer group transition-all border border-base-300"
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                          <FolderGit2 className="w-5 h-5 text-secondary" />
                          <div className="flex flex-col overflow-hidden">
                            <span className="font-medium truncate">{repo.split('/').pop()}</span>
                            <span className="text-xs opacity-50 truncate">{repo}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
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
                    ))}
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:items-start w-full">
            <div className="card w-full bg-base-200 shadow-xl lg:h-full">
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

                <div className="mt-4 space-y-6">
                  <div className="bg-base-100 p-4 rounded-lg border border-base-300">
                    <div className="text-xs opacity-50 uppercase tracking-widest mb-1">Current Repository</div>
                    <div className="flex items-center gap-2 font-mono text-sm break-all">
                      <FolderGit2 className="w-4 h-4 text-primary shrink-0" />
                      {selectedRepo}
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Branch Selection */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-sm font-medium opacity-70">Current Branch</label>
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
                      <div className="text-xs opacity-50 px-1">
                        Switching branches will update your working directory.
                      </div>
                    </div>

                    <div className="divider"></div>

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
                        disabled={loading}
                      />
                      <div className="text-xs opacity-50 px-1">
                        Script to run in the terminal agent iframe upon startup.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Card: Agent Context */}
            <div className="card w-full bg-base-200 shadow-xl lg:h-full">
              <div className="card-body">
                <h2 className="card-title flex items-center gap-2">
                  <Bot className="w-6 h-6 text-secondary" />
                  Agent Context
                </h2>

                <div className="space-y-4 mt-2">
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
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedRepo && view === 'details' && (
        <div className="flex justify-center mt-8 pb-8">
          <button
            className="btn btn-primary btn-lg btn-wide shadow-lg"
            onClick={async () => {
              setLoading(true);
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

                const wtResult = await createSessionWorktree(selectedRepo, baseBranch);

                if (wtResult.success && wtResult.worktreePath && wtResult.branchName) {
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
                    // Assume repo file
                    return `${wtResult.worktreePath}/${name}`;
                  });

                  // 3. Navigate to session page with new params OR call onStartSession
                  if (onStartSession) {
                    onStartSession({
                      repo: selectedRepo, // Keep original repo for context if needed
                      worktree: wtResult.worktreePath,
                      branch: wtResult.branchName,
                      sessionName: wtResult.sessionName || '',
                      agent: selectedProvider?.cli || '',
                      model: selectedModel || '',
                      startupScript: startupScript || '',
                      initialMessage: processedMessage,
                      attachments: attachments || []
                    });
                  } else {
                    const params = new URLSearchParams({
                      repo: selectedRepo, // Keep original repo for context if needed
                      worktree: wtResult.worktreePath,
                      branch: wtResult.branchName,
                      session: wtResult.sessionName || '',
                      agent: selectedProvider?.cli || '',
                      model: selectedModel || '',
                      startup_script: startupScript || '',
                      // params url too long for attachments/message probably, but generic fallback
                    });

                    // For long messages passed via URL, we might hit limits.
                    // Ideally we should persist creating session state on server or use localStorage.
                    // But given existing architecture passes via URL or callback, we stick to it.
                    // If callback is used (which is true in main page), it's fine.
                    // If direct navigation, msg might be lost if too long. 
                    // But GitRepoSelector is used inside Home page which provides onStartSession.

                    router.push(`/session?${params.toString()}`);
                  }
                } else {
                  setError(wtResult.error || "Failed to create session worktree");
                  setLoading(false);
                }

              } catch (e) {
                console.error(e);
                setError("Failed to start session");
                setLoading(false);
              }
            }}
            disabled={loading}
          >
            {loading ? <span className="loading loading-spinner"></span> : "Start Session"}
          </button>
        </div>
      )}

      {isBrowsing && (
        <FileBrowser
          initialPath={defaultRoot || undefined}
          onSelect={(path) => handleSelectRepo(path)}
          onCancel={() => setIsBrowsing(false)}
          checkRepo={checkIsGitRepo}
        />
      )}

      {isSelectingRoot && (
        <FileBrowser
          initialPath={defaultRoot || undefined}
          onSelect={handleSetDefaultRoot}
          onCancel={() => setIsSelectingRoot(false)}
        />
      )}
    </>
  );
}

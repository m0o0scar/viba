'use client';

import React, { useState, useEffect } from 'react';
import { FolderGit2, GitBranch as GitBranchIcon, Plus, X, ChevronRight, Check, Settings, FolderCog, Bot, Cpu } from 'lucide-react';
import FileBrowser from './FileBrowser';
import { checkIsGitRepo, getBranches, checkoutBranch, GitBranch, startTtydProcess, createSessionWorktree } from '@/app/actions/git';
import { useRouter } from 'next/navigation';

import agentProvidersData from '@/data/agent-providers.json';

type AgentProvider = {
  name: string;
  cli: string;
  models: string[];
};

export default function GitRepoSelector() {
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
      loadSavedAgentSettings(path);

      // Load branches
      await loadBranches(path);

    } catch (err) {
      console.error(err);
      setError('Failed to open repository.');
    } finally {
      setLoading(false);
    }
  };

  const loadSavedAgentSettings = (repoPath: string) => {
    const savedProviderCli = localStorage.getItem(`viba_agent_provider_${repoPath}`);
    const savedModel = localStorage.getItem(`viba_agent_model_${repoPath}`);

    if (savedProviderCli) {
      const provider = agentProvidersData.find(p => p.cli === savedProviderCli);
      if (provider) {
        setSelectedProvider(provider);
        if (savedModel && provider.models.includes(savedModel)) {
          setSelectedModel(savedModel);
        } else {
          setSelectedModel(provider.models[0]);
        }
      } else {
        // Default if saved one is invalid
        setSelectedProvider(agentProvidersData[0]);
        setSelectedModel(agentProvidersData[0].models[0]);
      }
    } else {
      // Default
      setSelectedProvider(agentProvidersData[0]);
      setSelectedModel(agentProvidersData[0].models[0]);
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
      const defaultModel = provider.models[0];
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

  const handleRemoveRecent = (e: React.MouseEvent, repo: string) => {
    e.stopPropagation();
    setRecentRepos(prev => prev.filter(r => r !== repo));
  };

  return (
    <>
      <div className="card w-full max-w-2xl bg-base-200 shadow-xl">
        <div className="card-body">
          <h2 className="card-title flex justify-between items-center">
            <div className="flex items-center gap-2">
              <FolderGit2 className="w-6 h-6 text-primary" />
              Git Repository Selector
            </div>
            {view === 'details' && (
              <button className="btn btn-sm btn-ghost" onClick={() => setView('list')}>
                Change Repo
              </button>
            )}
          </h2>

          {error && <div className="alert alert-error text-sm py-2 px-3 mt-2">{error}</div>}

          {view === 'list' && (
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
          )}

          {view === 'details' && selectedRepo && (
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
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedRepo && view === 'details' && (
        <div className="flex justify-center mt-4">
          <button
            className="btn btn-primary btn-wide"
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
                  // 3. Navigate to session page with new params
                  const params = new URLSearchParams({
                    repo: selectedRepo, // Keep original repo for context if needed
                    worktree: wtResult.worktreePath,
                    branch: wtResult.branchName,
                    session: wtResult.sessionName || '',
                    agent: selectedProvider?.cli || '',
                    model: selectedModel || ''
                  });

                  router.push(`/session?${params.toString()}`);
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

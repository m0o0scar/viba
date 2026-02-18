'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
// import { useRouter } from 'next/navigation';
import {
    deleteSession,
    getSessionDivergence,
    getSessionUncommittedFileCount,
    listSessionBaseBranches,
    mergeSessionToBase,
    rebaseSessionOntoBase,
    updateSessionBaseBranch
} from '@/app/actions/session';
import { getConfig, updateConfig } from '@/app/actions/config';
import { Trash2, ExternalLink, Play, GitCommitHorizontal, GitMerge, GitPullRequestArrow, ArrowUp, ArrowDown, FolderOpen, ChevronLeft } from 'lucide-react';
import SessionFileBrowser from './SessionFileBrowser';
import { getBaseName } from '@/lib/path';

const SUPPORTED_IDES = [
    { id: 'vscode', name: 'VS Code', protocol: 'vscode' },
    { id: 'cursor', name: 'Cursor', protocol: 'cursor' },
    { id: 'windsurf', name: 'Windsurf', protocol: 'windsurf' },
    { id: 'antigravity', name: 'Antigravity', protocol: 'antigravity' },
];

type TerminalWindow = Window & {
    term?: {
        paste: (text: string) => void;
        options: {
            theme?: Record<string, string>;
            [key: string]: unknown;
        };
    };
};

type CleanupPhase = 'idle' | 'running' | 'error';

export interface SessionViewProps {
    repo: string;
    worktree: string;
    branch: string;
    baseBranch?: string;
    sessionName: string;
    agent?: string;
    model?: string;
    startupScript?: string;
    devServerScript?: string;
    initialMessage?: string;
    title?: string;
    attachmentNames?: string[];
    onExit: (force?: boolean) => void;
    isResume?: boolean;
    onSessionStart?: () => void;
}

export function SessionView({
    repo,
    worktree,
    branch,
    baseBranch,
    sessionName,
    agent,
    model,
    startupScript,
    devServerScript,
    initialMessage,
    title,
    attachmentNames,
    onExit,
    isResume,
    onSessionStart
}: SessionViewProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const terminalRef = useRef<HTMLIFrameElement>(null);

    const [feedback, setFeedback] = useState<string>('Initializing...');
    const [cleanupPhase, setCleanupPhase] = useState<CleanupPhase>('idle');
    const [cleanupError, setCleanupError] = useState<string | null>(null);
    const [isStartingDevServer, setIsStartingDevServer] = useState(false);
    const [isRequestingCommit, setIsRequestingCommit] = useState(false);
    const [isMerging, setIsMerging] = useState(false);
    const [isRebasing, setIsRebasing] = useState(false);
    const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);
    const [isInsertingFilePaths, setIsInsertingFilePaths] = useState(false);
    const [currentBaseBranch, setCurrentBaseBranch] = useState(baseBranch?.trim() || '');
    const [baseBranchOptions, setBaseBranchOptions] = useState<string[]>([]);
    const [isLoadingBaseBranches, setIsLoadingBaseBranches] = useState(false);
    const isLoadingBaseBranchesRef = useRef(false);
    const [isUpdatingBaseBranch, setIsUpdatingBaseBranch] = useState(false);
    const [divergence, setDivergence] = useState({ ahead: 0, behind: 0 });
    const [uncommittedFileCount, setUncommittedFileCount] = useState(0);

    const [isTerminalMinimized, setIsTerminalMinimized] = useState(true);

    // IDE Selection
    const [selectedIde, setSelectedIde] = useState<string>('vscode');

    useEffect(() => {
        const trimmedTitle = title?.trim();
        if (trimmedTitle) {
            document.title = `${trimmedTitle} | Viba`;
            return () => {
                document.title = 'Viba';
            };
        }

        document.title = 'Viba';
        return undefined;
    }, [title]);

    useEffect(() => {
        const loadConfig = async () => {
            const config = await getConfig();
            if (config.selectedIde && SUPPORTED_IDES.some(ide => ide.id === config.selectedIde)) {
                setSelectedIde(config.selectedIde);
            }
        };
        loadConfig();
    }, []);

    useEffect(() => {
        setCurrentBaseBranch(baseBranch?.trim() || '');
        setBaseBranchOptions([]);
    }, [baseBranch, sessionName]);

    const handleIdeChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = e.target.value;
        setSelectedIde(value);
        await updateConfig({ selectedIde: value });
    };

    const handleOpenIde = () => {
        if (!worktree) return;
        const ide = SUPPORTED_IDES.find(i => i.id === selectedIde);
        if (!ide) return;

        const uri = `${ide.protocol}://file/${encodeURI(worktree)}`;
        window.open(uri, '_blank');
    };

    const handleCleanup = async () => {
        const unloadSessionIframes = () => {
            for (const frame of [iframeRef.current, terminalRef.current]) {
                if (!frame) continue;
                try {
                    frame.onload = null;
                    frame.src = 'about:blank';
                } catch (error) {
                    console.error('Failed to unload iframe during cleanup:', error);
                }
            }
        };

        if (!repo || !worktree || !branch) return;
        if (!confirm('Are you sure you want to delete this session? This will remove the branch and worktree.')) return;

        setCleanupError(null);
        setCleanupPhase('running');
        setFeedback('Cleaning up session...');
        unloadSessionIframes();

        try {
            const result = await deleteSession(sessionName);
            if (result.success) {
                onExit(true);
            } else {
                const message = result.error || 'Failed to clean up session';
                setCleanupError(message);
                setFeedback(`Cleanup failed: ${message}`);
                setCleanupPhase('error');
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Unexpected cleanup error';
            setCleanupError(message);
            setFeedback(`Cleanup failed: ${message}`);
            setCleanupPhase('error');
        }
    };

    const sendPromptToAgentIframe = useCallback((prompt: string, action: string): Promise<boolean> => {
        return new Promise((resolve) => {
            const iframe = iframeRef.current;
            if (!iframe) {
                resolve(false);
                return;
            }

            const checkAndSend = (attempts = 0) => {
                if (attempts > 30) {
                    resolve(false);
                    return;
                }

                try {
                    const win = iframe.contentWindow as TerminalWindow | null;
                    if (!win) {
                        setTimeout(() => checkAndSend(attempts + 1), 300);
                        return;
                    }

                    win.postMessage(
                        {
                            type: 'viba:agent-request',
                            action,
                            prompt,
                            sessionName,
                            branch,
                            baseBranch: currentBaseBranch || undefined,
                            timestamp: Date.now(),
                        },
                        '*'
                    );

                    if (!win.term) {
                        setTimeout(() => checkAndSend(attempts + 1), 300);
                        return;
                    }

                    win.term.paste(prompt);

                    const textarea = iframe.contentDocument?.querySelector("textarea.xterm-helper-textarea");
                    if (textarea) {
                        textarea.dispatchEvent(new KeyboardEvent('keypress', {
                            bubbles: true,
                            cancelable: true,
                            charCode: 13,
                            keyCode: 13,
                            key: 'Enter',
                            view: win
                        }));
                        (textarea as HTMLElement).focus();
                    } else {
                        win.term.paste('\r');
                    }

                    win.focus();
                    resolve(true);
                } catch (e) {
                    console.error('Failed to send prompt to agent iframe:', e);
                    setTimeout(() => checkAndSend(attempts + 1), 300);
                }
            };

            checkAndSend();
        });
    }, [branch, currentBaseBranch, sessionName]);

    const handleCommit = async () => {
        setIsRequestingCommit(true);
        setFeedback('Requesting commit from agent...');

        const prompt = 'Please create a git commit with the current changes in this worktree.';
        const sent = await sendPromptToAgentIframe(prompt, 'commit');

        setFeedback(sent ? 'Commit request sent to agent' : 'Failed to send commit request to agent');
        setIsRequestingCommit(false);
    };

    const pasteIntoAgentIframe = useCallback((text: string): Promise<boolean> => {
        return new Promise((resolve) => {
            const iframe = iframeRef.current;
            if (!iframe) {
                resolve(false);
                return;
            }

            const checkAndPaste = (attempts = 0) => {
                if (attempts > 30) {
                    resolve(false);
                    return;
                }

                try {
                    const win = iframe.contentWindow as TerminalWindow | null;
                    if (!win || !win.term) {
                        setTimeout(() => checkAndPaste(attempts + 1), 300);
                        return;
                    }

                    win.term.paste(text);

                    const textarea = iframe.contentDocument?.querySelector("textarea.xterm-helper-textarea");
                    if (textarea) {
                        (textarea as HTMLElement).focus();
                    }
                    win.focus();
                    resolve(true);
                } catch (e) {
                    console.error('Failed to paste into agent iframe:', e);
                    setTimeout(() => checkAndPaste(attempts + 1), 300);
                }
            };

            checkAndPaste();
        });
    }, []);

    const handleInsertFilePaths = useCallback(async (paths: string[]) => {
        if (paths.length === 0) return;

        setIsInsertingFilePaths(true);
        const textToInsert = `${paths.join(' ')} `;
        const inserted = await pasteIntoAgentIframe(textToInsert);
        setFeedback(
            inserted
                ? `Inserted ${paths.length} file path${paths.length === 1 ? '' : 's'} into agent input`
                : 'Failed to insert file paths into agent input'
        );
        setIsInsertingFilePaths(false);
    }, [pasteIntoAgentIframe]);

    const loadBaseBranchOptions = useCallback(async () => {
        if (!sessionName) return;
        if (isLoadingBaseBranchesRef.current) return;

        isLoadingBaseBranchesRef.current = true;
        setIsLoadingBaseBranches(true);

        try {
            const result = await listSessionBaseBranches(sessionName);
            if (result.success) {
                setBaseBranchOptions(result.branches ?? []);
                setCurrentBaseBranch(result.baseBranch?.trim() || '');
            } else if (result.error) {
                setFeedback(`Failed to load branches: ${result.error}`);
            }
        } catch (e) {
            console.error('Failed to load base branches:', e);
        } finally {
            isLoadingBaseBranchesRef.current = false;
            setIsLoadingBaseBranches(false);
        }
    }, [sessionName]);

    useEffect(() => {
        if (!sessionName) return;
        void loadBaseBranchOptions();
    }, [loadBaseBranchOptions, sessionName]);

    const loadSessionDivergence = useCallback(async () => {
        if (!sessionName) return;

        try {
            const result = await getSessionDivergence(sessionName);
            if (result.success && typeof result.ahead === 'number' && typeof result.behind === 'number') {
                setDivergence({ ahead: result.ahead, behind: result.behind });
            }
        } catch (e) {
            console.error('Failed to load branch divergence:', e);
        }
    }, [sessionName]);

    useEffect(() => {
        if (!sessionName || !currentBaseBranch) {
            setDivergence({ ahead: 0, behind: 0 });
            return;
        }

        void loadSessionDivergence();
        const timer = window.setInterval(() => {
            void loadSessionDivergence();
        }, 60000);

        return () => window.clearInterval(timer);
    }, [currentBaseBranch, loadSessionDivergence, sessionName]);

    const handleBaseBranchChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        if (!sessionName) return;

        const nextBaseBranch = e.target.value.trim();
        if (!nextBaseBranch || nextBaseBranch === currentBaseBranch) return;

        setIsUpdatingBaseBranch(true);
        setFeedback(`Updating base branch to ${nextBaseBranch}...`);

        try {
            const result = await updateSessionBaseBranch(sessionName, nextBaseBranch);
            if (result.success && result.baseBranch) {
                setCurrentBaseBranch(result.baseBranch);
                setFeedback(`Base branch updated to ${result.baseBranch}`);
                await loadBaseBranchOptions();
                await loadSessionDivergence();
            } else {
                setFeedback(`Failed to update base branch: ${result.error}`);
            }
        } catch (error) {
            console.error('Failed to update base branch:', error);
            setFeedback('Failed to update base branch');
        } finally {
            setIsUpdatingBaseBranch(false);
        }
    };

    const loadUncommittedFileCount = useCallback(async () => {
        if (!sessionName) return;

        try {
            const result = await getSessionUncommittedFileCount(sessionName);
            if (result.success && typeof result.count === 'number') {
                setUncommittedFileCount(result.count);
            }
        } catch (e) {
            console.error('Failed to load uncommitted file count:', e);
        }
    }, [sessionName]);

    useEffect(() => {
        if (!sessionName) return;

        void loadUncommittedFileCount();
        const timer = window.setInterval(() => {
            void loadUncommittedFileCount();
        }, 10000);

        return () => window.clearInterval(timer);
    }, [loadUncommittedFileCount, sessionName]);

    const handleMerge = async () => {
        if (!sessionName) return;
        if (!currentBaseBranch) return;
        if (!confirm(`Merge ${branch} into ${currentBaseBranch}?`)) return;

        setIsMerging(true);
        setFeedback('Merging session branch...');

        try {
            const result = await mergeSessionToBase(sessionName);
            if (result.success) {
                setFeedback(`Merged ${result.branchName} into ${result.baseBranch}`);
                void loadSessionDivergence();
            } else {
                setFeedback(`Merge failed: ${result.error}`);
            }
        } catch (e) {
            console.error('Merge request failed:', e);
            setFeedback('Merge failed');
        } finally {
            setIsMerging(false);
        }
    };

    const handleRebase = async () => {
        if (!sessionName) return;
        if (!currentBaseBranch) return;
        if (!confirm(`Rebase ${branch} onto ${currentBaseBranch}?`)) return;

        setIsRebasing(true);
        setFeedback('Rebasing session branch...');

        try {
            const result = await rebaseSessionOntoBase(sessionName);
            if (result.success) {
                setFeedback(`Rebased ${result.branchName} onto ${result.baseBranch}`);
                void loadSessionDivergence();
            } else {
                setFeedback(`Rebase failed: ${result.error}`);
            }
        } catch (e) {
            console.error('Rebase request failed:', e);
            setFeedback('Rebase failed');
        } finally {
            setIsRebasing(false);
        }
    };

    const handleStartDevServer = () => {
        const script = devServerScript?.trim();
        if (!script || !terminalRef.current) return;

        const iframe = terminalRef.current;
        setIsStartingDevServer(true);
        setFeedback('Starting dev server...');

        const checkAndInject = (attempts = 0) => {
            if (attempts > 30) {
                setFeedback('Failed to start dev server: terminal is not ready');
                setIsStartingDevServer(false);
                return;
            }

            try {
                const win = iframe.contentWindow as TerminalWindow | null;
                if (win && win.term) {
                    win.term.paste(script);

                    const textarea = iframe.contentDocument?.querySelector("textarea.xterm-helper-textarea");
                    if (textarea) {
                        textarea.dispatchEvent(new KeyboardEvent('keypress', {
                            bubbles: true,
                            cancelable: true,
                            charCode: 13,
                            keyCode: 13,
                            key: 'Enter',
                            view: win
                        }));
                    } else {
                        win.term.paste('\r');
                    }

                    win.focus();
                    if (textarea) (textarea as HTMLElement).focus();

                    setFeedback('Dev server start command sent');
                    setIsStartingDevServer(false);
                } else {
                    setTimeout(() => checkAndInject(attempts + 1), 300);
                }
            } catch (e) {
                console.error('Dev server injection error', e);
                setFeedback('Failed to start dev server');
                setIsStartingDevServer(false);
            }
        };

        checkAndInject();
    };

    const handleIframeLoad = () => {
        if (!iframeRef.current) return;
        const iframe = iframeRef.current;

        // Safety check for Same-Origin to avoid errors if proxy isn't working
        try {
            // Just accessing contentWindow to see if it throws
            const _ = iframe.contentWindow;
        } catch (e) {
            setFeedback("Error: Cross-Origin access blocked. Ensure proxy is working.");
            return;
        }

        if (iframe.contentWindow) {
            // Attempt to nullify the internal ttyd handler
            iframe.contentWindow.onbeforeunload = null;

            // Or add a high-priority listener that stops the popup
            iframe.contentWindow.addEventListener('beforeunload', (event) => {
                event.stopImmediatePropagation();
            }, true);
        }

        console.log('Iframe loaded, starting injection check...');
        setFeedback('Connecting to terminal...');

        const checkAndInject = (attempts = 0) => {
            if (attempts > 30) {
                setFeedback('Timeout waiting for terminal to be ready');
                return;
            }

            try {
                const win = iframe.contentWindow as TerminalWindow | null;
                if (win && win.term) {
                    const term = win.term;
                    console.log('Terminal instance found');

                    // Set selection highlight color via xterm.js 5 theme API (canvas renderer)
                    try {
                        term.options.theme = {
                            ...(term.options.theme || {}),
                            selectionBackground: 'rgba(59, 130, 246, 0.4)',
                        };
                    } catch { /* ignore if API unavailable */ }

                    // Attempt injection

                    // User instructions:
                    // 1. paste cd command
                    // 2. dispatch keypress 13

                    const targetPath = worktree || repo; // Fallback to repo if no worktree
                    const cmd = `cd "${targetPath}"`;
                    // Send cd command
                    term.paste(cmd);

                    // Helper to press enter
                    const pressEnter = () => {
                        const textarea = iframe.contentDocument?.querySelector("textarea.xterm-helper-textarea");
                        if (textarea) {
                            textarea.dispatchEvent(new KeyboardEvent('keypress', {
                                bubbles: true,
                                cancelable: true,
                                charCode: 13,
                                keyCode: 13,
                                key: 'Enter',
                                view: win
                            }));
                        } else {
                            term.paste('\r');
                        }
                    };

                    pressEnter();

                    // Inject agent command if present
                    if (agent) {
                        setTimeout(() => {
                            let agentCmd = '';

                            if (isResume) {
                                // Resume Logic
                                if (agent.toLowerCase().includes('gemini')) {
                                    agentCmd = `gemini --resume latest`;
                                } else if (agent.toLowerCase().includes('codex')) {
                                    agentCmd = `codex resume --last`;
                                } else if (agent.toLowerCase() === 'agent' || agent.toLowerCase().includes('cursor')) {
                                    agentCmd = `agent resume`;
                                } else {
                                    // Fallback for others? assuming generic resume
                                    agentCmd = `${agent} resume`;
                                }
                            } else {
                                // Normal Start Logic
                                let fullMessage = title ? `${title}\n\n${initialMessage || ''}` : (initialMessage || '');
                                if (attachmentNames && attachmentNames.length > 0) {
                                    const attachmentBasePath = `${worktree || repo}-attachments`;
                                    const attachmentSection = [
                                        'Attachments:',
                                        ...attachmentNames.map(name => `- ${attachmentBasePath}/${name}`)
                                    ].join('\n');
                                    fullMessage = fullMessage ? `${fullMessage}\n\n${attachmentSection}` : attachmentSection;
                                }
                                const safeMessage = fullMessage ? ` "${fullMessage.replace(/"/g, '\\"')}"` : '';

                                if (agent.toLowerCase().includes('codex')) {
                                    // Codex: codex --model gpt-5.3-codex --sandbox danger-full-access --ask-for-approval on-request --search
                                    agentCmd = `codex --model ${model || 'gpt-5.3-codex'} --sandbox danger-full-access --ask-for-approval on-request --search${safeMessage}`;
                                } else if (agent.toLowerCase().includes('gemini')) {
                                    // Gemini: gemini --model gemini-3-pro-preview --yolo
                                    agentCmd = `gemini --model ${model || 'gemini-3-pro-preview'} --yolo${safeMessage}`;
                                } else if (agent.toLowerCase() === 'agent' || agent.toLowerCase().includes('cursor')) {
                                    // Cursor: agent --model opus-4.6-thinking
                                    agentCmd = `agent --model ${model || 'opus-4.6-thinking'}${safeMessage}`;
                                } else {
                                    // Generic fallback: <agent> --model <model>
                                    agentCmd = `${agent} --model ${model}${safeMessage}`;
                                }
                            }

                            if (agentCmd) {
                                console.log('Injecting agent command:', agentCmd);
                                term.paste(agentCmd);
                                pressEnter();
                                setFeedback(isResume ? `Resumed session with ${agent}` : `Session started with ${agent}`);

                                if (!isResume && onSessionStart) {
                                    onSessionStart();
                                }
                            }
                        }, 500); // Wait a bit for cd to finish
                    } else {
                        setFeedback(`Session started ${worktree ? '(Worktree)' : ''}`);
                        if (!isResume && onSessionStart) {
                            onSessionStart();
                        }
                    }

                    // Focus the iframe
                    win.focus();
                    const textarea = iframe.contentDocument?.querySelector("textarea.xterm-helper-textarea");
                    if (textarea) (textarea as HTMLElement).focus();

                } else {
                    // Not ready yet
                    setTimeout(() => checkAndInject(attempts + 1), 500);
                }
            } catch (e) {
                console.error("Access error during injection:", e);
                setFeedback('Error accessing terminal: ' + String(e));
            }
        };

        // Small delay to allow scripts to run
        setTimeout(() => checkAndInject(), 1000);
    };

    const handleTerminalLoad = () => {
        if (!terminalRef.current) return;
        const iframe = terminalRef.current;
        console.log('Secondary terminal loaded');

        // Safety check
        try {
            const _ = iframe.contentWindow;
        } catch (e) {
            console.error("Secondary terminal: Cross-Origin access blocked.");
            return;
        }

        if (iframe.contentWindow) {
            // Attempt to nullify the internal ttyd handler
            iframe.contentWindow.onbeforeunload = null;

            // Or add a high-priority listener that stops the popup
            iframe.contentWindow.addEventListener('beforeunload', (event) => {
                event.stopImmediatePropagation();
            }, true);
        }

        const checkAndInject = (attempts = 0) => {
            if (attempts > 30) {
                console.log('Timeout waiting for secondary terminal');
                return;
            }

            try {
                const win = iframe.contentWindow as TerminalWindow | null;
                if (win && win.term) {
                    const term = win.term;
                    console.log('Secondary terminal instance found');

                    // Set selection highlight color via xterm.js 5 theme API (canvas renderer)
                    try {
                        term.options.theme = {
                            ...(term.options.theme || {}),
                            selectionBackground: 'rgba(59, 130, 246, 0.4)',
                        };
                    } catch { /* ignore if API unavailable */ }

                    const targetPath = worktree || repo;
                    const cmd = `cd "${targetPath}"`;
                    term.paste(cmd);

                    const pressEnter = () => {
                        const textarea = iframe.contentDocument?.querySelector("textarea.xterm-helper-textarea");
                        if (textarea) {
                            textarea.dispatchEvent(new KeyboardEvent('keypress', {
                                bubbles: true,
                                cancelable: true,
                                charCode: 13,
                                keyCode: 13,
                                key: 'Enter',
                                view: win
                            }));
                        } else {
                            term.paste('\r');
                        }
                    };
                    pressEnter();

                    // Check for startup script
                    if (startupScript && !isResume) {
                        setTimeout(() => {
                            console.log('Injecting startup script:', startupScript);
                            term.paste(startupScript);
                            pressEnter();
                        }, 500);
                    }

                    // Focus
                    win.focus();
                    const textarea = iframe.contentDocument?.querySelector("textarea.xterm-helper-textarea");
                    if (textarea) (textarea as HTMLElement).focus();
                } else {
                    setTimeout(() => checkAndInject(attempts + 1), 500);
                }
            } catch (e) {
                console.error("Secondary terminal injection error", e);
            }
        };

        setTimeout(() => checkAndInject(), 1000);
    };

    if (!repo) return <div className="p-4 text-error">No repository specified</div>;

    if (cleanupPhase === 'running') {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-base-100">
                <div className="flex flex-col items-center gap-4 text-center">
                    <span className="loading loading-spinner loading-lg text-primary"></span>
                    <p className="text-sm opacity-70">Cleaning up session and closing terminals...</p>
                </div>
            </div>
        );
    }

    if (cleanupPhase === 'error') {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-base-100">
                <div className="card w-96 bg-base-200 shadow-xl">
                    <div className="card-body items-center text-center">
                        <h2 className="card-title text-error">Cleanup failed</h2>
                        <p>{cleanupError || 'An unknown error occurred while cleaning up this session.'}</p>
                        <div className="card-actions justify-end">
                            <button className="btn btn-primary" onClick={() => onExit()}>Back to Home</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const selectableBaseBranches = Array.from(new Set([
        ...(currentBaseBranch ? [currentBaseBranch] : []),
        ...baseBranchOptions
    ])).filter((branchOption) => branchOption !== branch || branchOption === currentBaseBranch);

    return (
        <div className="relative h-screen w-full overflow-hidden bg-base-100">
            <div className="absolute left-0 right-0 top-0 z-20 bg-base-300/95 p-2 text-xs flex justify-between px-4 font-mono select-none items-center shadow-md backdrop-blur-sm">
                <div className="flex items-center gap-4">
                    <button
                        className="btn btn-ghost btn-xs h-6 min-h-6 px-1 hover:bg-base-content/10"
                        onClick={() => onExit()}
                        title="Back to Home"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                            <span className="opacity-50">Repo:</span>
                            <span className="font-bold">{getBaseName(repo)}</span>
                        </div>
                        {sessionName && (
                            <div className="flex items-center gap-2 text-[10px] opacity-70">
                                <span>Session:</span>
                                <span>{sessionName}</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center border border-base-content/20 rounded overflow-hidden">
                        <select
                            className="select select-xs h-6 min-h-6 bg-base-200 border-none focus:outline-none rounded-none pr-7"
                            value={selectedIde}
                            onChange={handleIdeChange}
                        >
                            {SUPPORTED_IDES.map(ide => (
                                <option key={ide.id} value={ide.id}>{ide.name}</option>
                            ))}
                        </select>
                        <div className="w-[1px] h-4 bg-base-content/20"></div>
                        <button
                            className="btn btn-ghost btn-xs rounded-none h-6 min-h-6 border-none hover:bg-base-content/10"
                            onClick={handleOpenIde}
                            title={`Open in ${SUPPORTED_IDES.find(i => i.id === selectedIde)?.name}`}
                        >
                            <ExternalLink className="w-3 h-3" />
                            Open
                        </button>
                    </div>

                    <button
                        className="btn btn-ghost btn-xs gap-1 h-6 min-h-6"
                        onClick={() => setIsFileBrowserOpen(true)}
                        disabled={isInsertingFilePaths}
                        title="Browse files and insert absolute paths into the agent input"
                    >
                        {isInsertingFilePaths ? <span className="loading loading-spinner loading-xs"></span> : <FolderOpen className="w-3 h-3" />}
                        Insert Files
                    </button>

                    {devServerScript?.trim() && (
                        <button
                            className="btn btn-ghost btn-xs gap-1 h-6 min-h-6"
                            onClick={handleStartDevServer}
                            disabled={isStartingDevServer}
                            title="Run dev server script in terminal"
                        >
                            {isStartingDevServer ? <span className="loading loading-spinner loading-xs"></span> : <Play className="w-3 h-3" />}
                            Start Dev Server
                        </button>
                    )}

                    <button
                        className="btn btn-ghost btn-xs gap-1 h-6 min-h-6"
                        onClick={handleCommit}
                        disabled={isRequestingCommit}
                        title="Ask agent to create a commit with current changes"
                    >
                        {isRequestingCommit ? <span className="loading loading-spinner loading-xs"></span> : <GitCommitHorizontal className="w-3 h-3" />}
                        Commit ({uncommittedFileCount})
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] opacity-70">Base</span>
                        <div className="relative w-40 shrink-0">
                            <select
                                className="select select-bordered select-xs w-full h-6 min-h-6 bg-base-200 pr-7"
                                value={currentBaseBranch}
                                onChange={handleBaseBranchChange}
                                onFocus={() => { void loadBaseBranchOptions(); }}
                                onMouseDown={() => { void loadBaseBranchOptions(); }}
                                disabled={isUpdatingBaseBranch || !sessionName}
                                title={currentBaseBranch ? `Current base branch: ${currentBaseBranch}` : 'Select base branch'}
                            >
                                {!currentBaseBranch && (
                                    <option value="" disabled>
                                        Select base branch
                                    </option>
                                )}
                                {selectableBaseBranches.map((branchOption) => (
                                    <option
                                        key={branchOption}
                                        value={branchOption}
                                        disabled={branchOption === currentBaseBranch}
                                        className={branchOption === currentBaseBranch ? 'text-base-content/50' : ''}
                                    >
                                        {branchOption}
                                    </option>
                                ))}
                            </select>
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-3 w-3 items-center justify-center">
                                {(isLoadingBaseBranches || isUpdatingBaseBranch) && (
                                    <span className="loading loading-spinner loading-xs"></span>
                                )}
                            </span>
                        </div>
                    </div>

                    <button
                        className="btn btn-ghost btn-xs gap-1 h-6 min-h-6"
                        onClick={handleMerge}
                        disabled={isMerging || isRebasing || isUpdatingBaseBranch || !currentBaseBranch}
                        title={currentBaseBranch ? `Merge ${branch} into ${currentBaseBranch}` : 'Base branch unavailable for this session'}
                    >
                        {isMerging ? <span className="loading loading-spinner loading-xs"></span> : <GitMerge className="w-3 h-3" />}
                        Merge
                    </button>

                    <button
                        className="btn btn-ghost btn-xs gap-1 h-6 min-h-6"
                        onClick={handleRebase}
                        disabled={isRebasing || isMerging || isUpdatingBaseBranch || !currentBaseBranch}
                        title={currentBaseBranch ? `Rebase ${branch} onto ${currentBaseBranch}` : 'Base branch unavailable for this session'}
                    >
                        {isRebasing ? <span className="loading loading-spinner loading-xs"></span> : <GitPullRequestArrow className="w-3 h-3" />}
                        Rebase
                    </button>

                    {currentBaseBranch && (
                        <div className="flex items-center gap-2 text-xs opacity-80" title={`Divergence against ${currentBaseBranch}`}>
                            <span className="inline-flex items-center gap-1">
                                <ArrowUp className="w-3 h-3" />
                                {divergence.ahead}
                            </span>
                            <span className="inline-flex items-center gap-1">
                                <ArrowDown className="w-3 h-3" />
                                {divergence.behind}
                            </span>
                        </div>
                    )}

                    <div className="w-[1px] h-4 bg-base-content/20 mx-2"></div>

                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${feedback.includes('Error') || feedback.includes('failed') ? 'bg-error' : feedback.includes('started') || feedback.includes('Merged') || feedback.includes('Rebased') || feedback.includes('sent') ? 'bg-success' : 'bg-warning'}`}></span>
                        <span>{feedback}</span>
                    </div>

                    {worktree && (
                        <button
                            className="btn btn-error btn-xs gap-1"
                            onClick={handleCleanup}
                            disabled={(cleanupPhase as string) === 'running'}
                        >
                            {(cleanupPhase as string) === 'running' ? <span className="loading loading-spinner loading-xs"></span> : <Trash2 className="w-3 h-3" />}
                            Clean Up & Exit
                        </button>
                    )}
                </div>
            </div>

            {/* coding agent iframe */}
            <iframe
                ref={iframeRef}
                src="/terminal"
                className="h-full w-full border-none dark:invert dark:brightness-90"
                allow="clipboard-read; clipboard-write"
                onLoad={handleIframeLoad}
            />

            {/* floating terminal panel */}
            <div
                className={`absolute bottom-4 right-4 z-30 w-[min(460px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-base-content/20 bg-base-200/95 shadow-2xl backdrop-blur-sm transition-all ${isTerminalMinimized ? 'h-10' : 'h-[min(320px,45vh)]'}`}
            >
                <button
                    className="flex h-10 w-full items-center justify-between px-3 text-xs font-mono hover:bg-base-content/10"
                    onClick={() => setIsTerminalMinimized((prev) => !prev)}
                    title={isTerminalMinimized ? 'Expand terminal' : 'Minimize terminal'}
                    type="button"
                >
                    <span>Terminal</span>
                    <span className="opacity-70">{isTerminalMinimized ? 'Show' : 'Hide'}</span>
                </button>
                <div className={isTerminalMinimized ? 'h-0 overflow-hidden' : 'h-[calc(100%-2.5rem)]'}>
                    <iframe
                        ref={terminalRef}
                        src="/terminal"
                        className="h-full w-full border-none dark:invert dark:brightness-90"
                        allow="clipboard-read; clipboard-write"
                        onLoad={handleTerminalLoad}
                    />
                </div>
            </div>

            {isFileBrowserOpen && (
                <SessionFileBrowser
                    initialPath={worktree || repo}
                    onConfirm={(paths) => {
                        setIsFileBrowserOpen(false);
                        void handleInsertFilePaths(paths);
                    }}
                    onCancel={() => setIsFileBrowserOpen(false)}
                />
            )}
        </div>
    );
}

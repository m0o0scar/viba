'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
// import { useRouter } from 'next/navigation';
import { deleteSession } from '@/app/actions/session';
import { getConfig, updateConfig } from '@/app/actions/config';
import { Trash2, ExternalLink, Play } from 'lucide-react';

const SUPPORTED_IDES = [
    { id: 'vscode', name: 'VS Code', protocol: 'vscode' },
    { id: 'cursor', name: 'Cursor', protocol: 'cursor' },
    { id: 'windsurf', name: 'Windsurf', protocol: 'windsurf' },
    { id: 'antigravity', name: 'Antigravity', protocol: 'antigravity' },
];

type TerminalWindow = Window & {
    term?: {
        paste: (text: string) => void;
    };
};

export interface SessionViewProps {
    repo: string;
    worktree: string;
    branch: string;
    sessionName: string;
    agent?: string;
    model?: string;
    startupScript?: string;
    devServerScript?: string;
    initialMessage?: string;
    title?: string;
    attachments?: File[];
    onExit: () => void;
    isResume?: boolean;
}

export function SessionView({
    repo,
    worktree,
    branch,
    sessionName,
    agent,
    model,
    startupScript,
    devServerScript,
    initialMessage,
    title,
    attachments,
    onExit,
    isResume
}: SessionViewProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const terminalRef = useRef<HTMLIFrameElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [feedback, setFeedback] = useState<string>('Initializing...');
    const [isCleaningUp, setIsCleaningUp] = useState(false);
    const [isStartingDevServer, setIsStartingDevServer] = useState(false);

    // Resize state
    const [agentWidth, setAgentWidth] = useState(66.666);
    const [isResizing, setIsResizing] = useState(false);
    const agentWidthRef = useRef(agentWidth);

    useEffect(() => {
        agentWidthRef.current = agentWidth;
    }, [agentWidth]);

    // IDE Selection
    const [selectedIde, setSelectedIde] = useState<string>('vscode');

    useEffect(() => {
        const loadConfig = async () => {
            const config = await getConfig();
            if (config.agentWidth) {
                setAgentWidth(config.agentWidth);
            }
            if (config.selectedIde && SUPPORTED_IDES.some(ide => ide.id === config.selectedIde)) {
                setSelectedIde(config.selectedIde);
            }
        };
        loadConfig();
    }, []);

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

    const startResizing = useCallback(() => {
        setIsResizing(true);
    }, []);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
        updateConfig({ agentWidth: agentWidthRef.current });
    }, []);

    const resize = useCallback((e: MouseEvent) => {
        if (isResizing && containerRef.current) {
            const containerRect = containerRef.current.getBoundingClientRect();
            const newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
            const clamped = Math.min(Math.max(newWidth, 20), 80);
            setAgentWidth(clamped);
        }
    }, [isResizing]);

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stopResizing);
        }
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [isResizing, resize, stopResizing]);

    const handleCleanup = async () => {
        if (!repo || !worktree || !branch) return;
        if (!confirm('Are you sure you want to delete this session? This will remove the branch and worktree.')) return;

        setIsCleaningUp(true);
        setFeedback('Cleaning up session...');

        try {
            // New: use deleteSession with sessionName
            // If sessionName is missing (legacy?), we might have issues.
            // But SessionView expects sessionName.
            const result = await deleteSession(sessionName);
            if (result.success) {
                onExit();
            } else {
                setFeedback('Cleanup failed: ' + result.error);
                setIsCleaningUp(false);
            }
        } catch (e) {
            setFeedback('Cleanup error');
            setIsCleaningUp(false);
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
                                const fullMessage = title ? `${title}\n\n${initialMessage || ''}` : initialMessage;
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
                            }
                        }, 500); // Wait a bit for cd to finish
                    } else {
                        setFeedback(`Session started ${worktree ? '(Worktree)' : ''}`);
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

    return (
        <div className="w-full h-screen flex flex-col bg-base-100">
            <div className="bg-base-300 p-2 text-xs flex justify-between px-4 font-mono select-none items-center shadow-md z-10">
                <div className="flex items-center gap-4">
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                            <span className="opacity-50">Repo:</span>
                            <span className="font-bold">{repo.split('/').pop()}</span>
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
                    <div className="flex items-center gap-2">
                        <select
                            className="select select-bordered select-xs w-auto h-6 min-h-6 bg-base-200"
                            value={selectedIde}
                            onChange={handleIdeChange}
                        >
                            {SUPPORTED_IDES.map(ide => (
                                <option key={ide.id} value={ide.id}>{ide.name}</option>
                            ))}
                        </select>
                        <button
                            className="btn btn-ghost btn-xs gap-1 h-6 min-h-6"
                            onClick={handleOpenIde}
                            title={`Open in ${SUPPORTED_IDES.find(i => i.id === selectedIde)?.name}`}
                        >
                            <ExternalLink className="w-3 h-3" />
                            Open
                        </button>
                    </div>

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

                    <div className="w-[1px] h-4 bg-base-content/20 mx-2"></div>

                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${feedback.includes('Error') || feedback.includes('failed') ? 'bg-error' : feedback.includes('started') ? 'bg-success' : 'bg-warning'}`}></span>
                        <span>{feedback}</span>
                    </div>

                    {worktree && (
                        <button
                            className="btn btn-error btn-xs gap-1"
                            onClick={handleCleanup}
                            disabled={isCleaningUp}
                        >
                            {isCleaningUp ? <span className="loading loading-spinner loading-xs"></span> : <Trash2 className="w-3 h-3" />}
                            Clean Up & Exit
                        </button>
                    )}
                </div>
            </div>

            <div
                className={`flex flex-row w-full flex-grow overflow-hidden ${isResizing ? 'select-none cursor-col-resize' : ''}`}
                ref={containerRef}
            >
                {/* coding agent iframe */}
                <div
                    className="h-full relative"
                    style={{ width: `${agentWidth}%` }}
                >
                    <iframe
                        ref={iframeRef}
                        src="/terminal"
                        className={`w-full h-full border-none dark:invert dark:brightness-90 ${isResizing ? 'pointer-events-none' : ''}`}
                        allow="clipboard-read; clipboard-write"
                        onLoad={handleIframeLoad}
                    />
                    {isResizing && <div className="absolute inset-0 z-50 bg-transparent" />}
                </div>

                {/* Resizer Handle */}
                <div
                    className="w-1 h-full cursor-col-resize bg-base-300 hover:bg-primary transition-colors flex items-center justify-center z-20"
                    onMouseDown={startResizing}
                >
                    <div className="w-[1px] h-4 bg-base-content opacity-20" />
                </div>

                {/* terminal iframe */}
                <div
                    className="h-full relative border-l border-base-300"
                    style={{ width: `${100 - agentWidth}%` }}
                >
                    <iframe
                        ref={terminalRef}
                        src="/terminal"
                        className={`w-full h-full border-none dark:invert dark:brightness-90 ${isResizing ? 'pointer-events-none' : ''}`}
                        allow="clipboard-read; clipboard-write"
                        onLoad={handleTerminalLoad}
                    />
                    {isResizing && <div className="absolute inset-0 z-50 bg-transparent" />}
                </div>
            </div>
        </div>
    );
}

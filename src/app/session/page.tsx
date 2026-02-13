'use client';

import React, { useRef, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { cleanUpSessionWorktree } from '@/app/actions/git';
import { ArrowLeft, Trash2 } from 'lucide-react';

function SessionContent() {
    const searchParams = useSearchParams();
    const repo = searchParams.get('repo');
    const worktree = searchParams.get('worktree');
    const branch = searchParams.get('branch');
    const sessionName = searchParams.get('session');

    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [feedback, setFeedback] = useState<string>('Initializing...');
    const [isCleaningUp, setIsCleaningUp] = useState(false);
    const router = useRouter();

    const handleBack = () => {
        // Navigating away will destroy the iframe component
        router.push('/');
    };

    const handleCleanup = async () => {
        if (!repo || !worktree || !branch) return;
        if (!confirm('Are you sure you want to delete this session? This will remove the branch and worktree.')) return;

        setIsCleaningUp(true);
        setFeedback('Cleaning up session...');

        try {
            const result = await cleanUpSessionWorktree(repo, worktree, branch);
            if (result.success) {
                router.push('/');
            } else {
                setFeedback('Cleanup failed: ' + result.error);
                setIsCleaningUp(false);
            }
        } catch (e) {
            setFeedback('Cleanup error');
            setIsCleaningUp(false);
        }
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
                const win = iframe.contentWindow as any;
                if (win && win.term) {
                    console.log('Terminal instance found');
                    // Attempt injection

                    // User instructions:
                    // 1. paste cd command
                    // 2. dispatch keypress 13

                    const targetPath = worktree || repo; // Fallback to repo if no worktree
                    const cmd = `cd "${targetPath}"`;
                    win.term.paste(cmd);

                    // Find textarea
                    const textarea = iframe.contentDocument?.querySelector("textarea.xterm-helper-textarea");
                    if (textarea) {
                        // Create and dispatch event
                        const event = new KeyboardEvent('keypress', {
                            bubbles: true,
                            cancelable: true,
                            charCode: 13,
                            keyCode: 13,
                            key: 'Enter',
                            view: win
                        });

                        textarea.dispatchEvent(event);
                        setFeedback(`Session started ${worktree ? '(Worktree)' : ''}`);
                    } else {
                        // Fallback: just send \r
                        console.warn("Textarea not found, sending \\r fallback");
                        win.term.paste('\r');
                        setFeedback('Session started (fallback mode)');
                    }

                    // Focus the iframe
                    win.focus();
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

    if (!repo) return <div className="p-4 text-error">No repository specified</div>;

    return (
        <div className="w-full h-screen flex flex-col bg-base-100">
            <div className="bg-base-300 p-2 text-xs flex justify-between px-4 font-mono select-none items-center">
                <div className="flex items-center gap-4">
                    <button
                        onClick={handleBack}
                        className="btn btn-ghost btn-xs btn-square"
                        title="Back to Home"
                    >
                        <ArrowLeft className="w-4 h-4" />
                    </button>

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
            <iframe
                ref={iframeRef}
                src="/terminal"
                className="w-full flex-grow border-none"
                allow="clipboard-read; clipboard-write"
                onLoad={handleIframeLoad}
            />
        </div>
    );
}

export default function SessionPage() {
    return (
        <Suspense fallback={<div className="p-4">Loading session...</div>}>
            <SessionContent />
        </Suspense>
    );
}

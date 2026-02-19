'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { SessionView } from '@/components/SessionView';
import { consumeSessionLaunchContext, getSessionMetadata, SessionMetadata, markSessionInitialized } from '@/app/actions/session';
import { startTtydProcess } from '@/app/actions/git';
import { CleanupExitBehavior, getConfig } from '@/app/actions/config';

type ExitIntent = 'back' | 'cleanup';

export default function SessionPage() {
    const params = useParams<{ sessionId: string }>();
    const sessionIdParam = params.sessionId;
    const sessionId = Array.isArray(sessionIdParam) ? sessionIdParam[0] : sessionIdParam;
    const router = useRouter();

    const [metadata, setMetadata] = useState<SessionMetadata | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Startup params — only populated on first open (initialized === false)
    const [initialMessage, setInitialMessage] = useState<string | undefined>(undefined);
    const [startupScript, setStartupScript] = useState<string | undefined>(undefined);
    const [attachmentNames, setAttachmentNames] = useState<string[]>([]);
    const [contextTitle, setContextTitle] = useState<string | undefined>(undefined);
    const [contextAgentProvider, setContextAgentProvider] = useState<string | undefined>(undefined);
    const [contextModel, setContextModel] = useState<string | undefined>(undefined);

    // True = send --resume to agent; False = send fresh start params
    const [isResume, setIsResume] = useState<boolean>(true);
    const [cleanupExitBehavior, setCleanupExitBehavior] = useState<CleanupExitBehavior>('back_to_home');

    useEffect(() => {
        if (!sessionId) return;

        const loadSession = async () => {
            try {
                // Ensure ttyd is running
                const ttydResult = await startTtydProcess();
                if (!ttydResult.success) {
                    setError('Failed to start terminal service');
                    setLoading(false);
                    return;
                }

                const data = await getSessionMetadata(sessionId);
                if (!data) {
                    setError('Session not found');
                    setLoading(false);
                    return;
                }

                const currentConfig = await getConfig();
                setCleanupExitBehavior(currentConfig.cleanupExitBehavior);
                setMetadata(data);

                // Determine fresh start vs resume purely from the initialized flag:
                // - initialized === false  → first open, send startup params
                // - initialized === true   → already started before, resume
                // - initialized === undefined → legacy session (no flag), treat as resume
                const isFirstOpen = data.initialized === false;

                if (isFirstOpen) {
                    // Consume the launch context (startup params) written by GitRepoSelector
                    const contextResult = await consumeSessionLaunchContext(sessionId);
                    if (contextResult.success && contextResult.context) {
                        const ctx = contextResult.context;
                        setInitialMessage(ctx.initialMessage);
                        setStartupScript(ctx.startupScript);
                        setAttachmentNames(ctx.attachmentNames || []);
                        setContextTitle(ctx.title);
                        setContextAgentProvider(ctx.agentProvider);
                        setContextModel(ctx.model);
                    }
                    // Whether or not we got context, this is a fresh start
                    setIsResume(false);
                } else {
                    // Already initialized (or legacy) — resume
                    setIsResume(true);
                }

                setLoading(false);
            } catch (e) {
                console.error('Failed to load session:', e);
                setError('Failed to load session');
                setLoading(false);
            }
        };

        loadSession();
    }, [sessionId]);

    const handleExit = (intent: ExitIntent = 'back') => {
        if (intent === 'cleanup' && cleanupExitBehavior === 'close_tab') {
            window.close();

            // Some browsers block `window.close()` when the tab was not script-opened.
            window.setTimeout(() => {
                if (!window.closed) {
                    window.location.href = '/';
                }
            }, 150);
            return;
        }

        if (intent === 'cleanup') {
            // Force a full page navigation — used after cleanup where
            // router.push can get stuck due to iframe teardown state
            window.location.href = '/';
            return;
        }

        router.push('/');
    };

    // Called by SessionView once the agent command has been sent for the first time
    const handleSessionStart = async () => {
        if (sessionId) {
            await markSessionInitialized(sessionId);
        }
    };

    if (loading) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-base-100">
                <div className="flex flex-col items-center gap-4">
                    <span className="loading loading-spinner loading-lg text-primary"></span>
                    <p className="opacity-60">Loading session...</p>
                </div>
            </div>
        );
    }

    if (error || !metadata) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-base-100">
                <div className="card w-96 bg-base-200 shadow-xl">
                    <div className="card-body items-center text-center">
                        <h2 className="card-title text-error">Error</h2>
                        <p>{error || 'Session not found'}</p>
                        <div className="card-actions justify-end">
                            <button className="btn btn-primary" onClick={() => handleExit()}>Back to Home</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <SessionView
            repo={metadata.repoPath}
            worktree={metadata.worktreePath}
            branch={metadata.branchName}
            baseBranch={metadata.baseBranch}
            sessionName={metadata.sessionName}
            agent={contextAgentProvider || metadata.agent}
            model={contextModel || metadata.model}
            startupScript={startupScript}
            devServerScript={metadata.devServerScript}
            initialMessage={initialMessage}
            title={contextTitle || metadata.title}
            attachmentNames={attachmentNames}
            onExit={handleExit}
            isResume={isResume}
            onSessionStart={handleSessionStart}
        />
    );
}

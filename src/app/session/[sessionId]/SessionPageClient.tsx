'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { SessionView } from '@/components/SessionView';
import { consumeSessionLaunchContext, getSessionMetadata, SessionMetadata, markSessionInitialized } from '@/app/actions/session';
import { startTtydProcess } from '@/app/actions/git';

export default function SessionPage() {
    const params = useParams<{ sessionId: string }>();
    const sessionIdParam = params.sessionId;
    const sessionId = Array.isArray(sessionIdParam) ? sessionIdParam[0] : sessionIdParam;
    const router = useRouter();

    const [metadata, setMetadata] = useState<SessionMetadata | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [initialMessage, setInitialMessage] = useState<string | undefined>(undefined);
    const [startupScript, setStartupScript] = useState<string | undefined>(undefined);
    const [attachmentNames, setAttachmentNames] = useState<string[]>([]);
    const [contextTitle, setContextTitle] = useState<string | undefined>(undefined);
    const [contextAgentProvider, setContextAgentProvider] = useState<string | undefined>(undefined);
    const [contextModel, setContextModel] = useState<string | undefined>(undefined);
    const [isResumeParam, setIsResumeParam] = useState<boolean>(false);

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
                if (data) {
                    setMetadata(data);

                    // Logic to determine if we should resume or start fresh
                    // Old sessions (initialized undefined) are considered initialized.
                    // New sessions (initialized false) are not.
                    const isAlreadyInitialized = data.initialized !== false;

                    let context = undefined;
                    let shouldResume = isAlreadyInitialized;

                    if (!isAlreadyInitialized) {
                        const contextResult = await consumeSessionLaunchContext(sessionId);
                        if (contextResult.success && contextResult.context) {
                            context = contextResult.context;
                            // If context says resume (e.g. from "resume session" button), then resume.
                            if (context.isResume) {
                                shouldResume = true;
                            } else {
                                shouldResume = false;
                                // We have a new session context.
                                // We will mark it initialized via callback from SessionView.
                            }
                        } else {
                            // Failed to load context (file missing/deleted).
                            // Assume it was already consumed or lost. Treat as resume.
                            shouldResume = true;
                        }
                    } else {
                         // Already initialized, so we resume.
                         shouldResume = true;
                    }

                    if (context) {
                        setInitialMessage(context.initialMessage);
                        setStartupScript(context.startupScript);
                        setAttachmentNames(context.attachmentNames || []);
                        setContextTitle(context.title);
                        setContextAgentProvider(context.agentProvider);
                        setContextModel(context.model);
                    }

                    setIsResumeParam(shouldResume);
                    setLoading(false);
                } else {
                    // Session not found - redirect to home
                    router.push('/');
                    // Keep loading as true to avoid showing error card during redirect
                }
            } catch (e) {
                console.error('Failed to load session:', e);
                setError('Failed to load session');
                setLoading(false);
            }
        };

        loadSession();
    }, [sessionId, router]);

    // Prevent browser back/forward navigation
    useEffect(() => {
        // Push a dummy state to history
        window.history.pushState(null, '', window.location.href);

        const handlePopState = () => {
            // When back is pressed, push state again to stay on page
            window.history.pushState(null, '', window.location.href);
        };

        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    }, []);

    const handleExit = () => {
        router.push('/');
    };

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
                            <button className="btn btn-primary" onClick={handleExit}>Back to Home</button>
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
            isResume={isResumeParam || (!initialMessage && !startupScript)} // If no init action, treat as resume
            onSessionStart={handleSessionStart}
        />
    );
}

'use client';

import { useState, useEffect } from 'react';
import GitRepoSelector from "@/components/GitRepoSelector";
import { SessionView } from "@/components/SessionView";

type SessionState = {
  repo: string;
  worktree: string;
  branch: string;
  sessionName: string;
  agent: string;
  model: string;
  startupScript: string;
  initialMessage: string;
  title?: string;
  attachments: File[];
  isResume?: boolean;
};

export default function Home() {
  const [session, setSession] = useState<SessionState | null>(null);

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

  if (session) {
    return (
      <SessionView
        repo={session.repo}
        worktree={session.worktree}
        branch={session.branch}
        sessionName={session.sessionName}
        agent={session.agent}
        model={session.model}
        startupScript={session.startupScript}
        onExit={() => setSession(null)}
        initialMessage={session.initialMessage}
        title={session.title}
        attachments={session.attachments}
        isResume={session.isResume}
      />
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-base-100 p-4 md:p-24">
      <GitRepoSelector onStartSession={setSession} />
    </main>
  );
}

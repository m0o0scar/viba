# Viba

Viba is a local session manager for AI coding agents. It lets you pick a Git repository, start an isolated worktree session, launch an agent CLI in a browser terminal, and manage the session lifecycle from one UI.

## Major Features

- Repository picker with local filesystem browsing and Git repo validation.
- Isolated session worktrees using `git worktree`, with per-session branch naming (`viba/<session>`).
- Start new sessions or resume existing sessions for a repository.
- Multi-agent setup with provider/model selection (Codex, Gemini, Cursor Agent data included).
- Dual terminal workspace:
  - Left terminal for agent execution.
  - Right terminal for startup/dev scripts.
- Session prompt tooling:
  - Optional title and initial message.
  - `@` file suggestions from tracked repo files.
  - File attachments saved per session.
- Session operations in the active view:
  - Ask agent to create a commit.
  - Merge session branch into base branch.
  - Rebase session branch onto base branch.
  - Live ahead/behind divergence and uncommitted file count.
- IDE deep-links for opening the session worktree (VS Code, Cursor, Windsurf, Antigravity).
- Persistent local config and session metadata under `~/.viba`.

## Tech Stack

- Next.js (App Router) + React + TypeScript
- Tailwind CSS + DaisyUI
- `simple-git` for Git/worktree operations
- `ttyd` as the web terminal backend (proxied at `/terminal`)

## Prerequisites

- Node.js and npm
- `ttyd` installed and available in `PATH`
- At least one supported agent CLI installed (for example `codex`, `gemini`, or `agent`)

## Getting Started

Install dependencies and start development:

```bash
npm install
npm run dev
```

The app picks an available port starting at `3200` in development.

Open the local URL printed in your terminal, then:

1. Select a local Git repository.
2. Pick branch/agent/model and optional scripts.
3. Start a session and work inside the generated worktree.

## Run with npx

```bash
npx viba-cli
```

This starts Viba on an available local port (default `3200`).  
You can also pass options:

```bash
npx viba-cli --port 3300
npx viba-cli --dev
```

Published npm packages are expected to include a prebuilt `.next` output, so `npx viba-cli` does not build on the end user's machine.

## Build and Run

```bash
npm run build
npm run start
```

Production start uses port `3200` by default.

Useful package scripts:

```bash
npm run cli          # run the packaged launcher locally
npm run pack:preview # preview files that will be published
```

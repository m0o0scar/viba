'use client';

import GitRepoSelector from "@/components/GitRepoSelector";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-base-100 p-4 md:p-24">
      <GitRepoSelector mode="home" />
    </main>
  );
}

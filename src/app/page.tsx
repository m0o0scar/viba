'use client';

import Image from "next/image";
import GitRepoSelector from "@/components/GitRepoSelector";

export default function Home() {
  return (
    <>
      <a
        href="https://github.com/m0o0scar/viba"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open Viba GitHub repository"
        className="fixed top-0 right-0 z-50 h-20 w-20 border-l border-b border-base-300 bg-base-100/95 shadow-sm backdrop-blur-sm transition-colors hover:bg-base-200/95"
        style={{ clipPath: "polygon(100% 0, 0 0, 100% 100%)" }}
      >
        <span className="absolute top-2 right-2">
          <Image src="/github.png" alt="GitHub" width={22} height={22} priority />
        </span>
      </a>
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-100 p-4 md:p-24">
        <GitRepoSelector mode="home" />
      </main>
    </>
  );
}

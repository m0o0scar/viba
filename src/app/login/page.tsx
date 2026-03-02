import { Suspense } from 'react';
import LoginPageClient from './LoginPageClient';

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-[#f6f6f8] p-6 dark:bg-[#0d1117]"><span className="loading loading-spinner loading-lg text-primary" aria-label="Loading" /></main>}>
      <LoginPageClient />
    </Suspense>
  );
}

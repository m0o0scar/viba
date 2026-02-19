import GitRepoSelector from '@/components/GitRepoSelector';

type NewSessionPageProps = {
  searchParams: Promise<{ repo?: string | string[]; prefillFromSession?: string | string[] }>;
};

export default async function NewSessionPage({ searchParams }: NewSessionPageProps) {
  const params = await searchParams;
  const repoParam = params.repo;
  const prefillParam = params.prefillFromSession;
  const repoPath = Array.isArray(repoParam) ? repoParam[0] : repoParam;
  const prefillFromSession = Array.isArray(prefillParam) ? prefillParam[0] : prefillParam;

  return (
    <main className="flex min-h-screen flex-col items-center bg-base-100 p-4 md:p-8">
      <GitRepoSelector mode="new" repoPath={repoPath ?? null} prefillFromSession={prefillFromSession ?? null} />
    </main>
  );
}

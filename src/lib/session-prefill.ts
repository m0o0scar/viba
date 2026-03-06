type SessionPrefillProjectContext = {
  projectPath?: string;
  repoPath?: string;
};

function normalizePathForComparison(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function doesSessionPrefillMatchProject(
  context: SessionPrefillProjectContext,
  selectedProjectPath: string,
): boolean {
  const normalizedSelectedProjectPath = normalizePathForComparison(selectedProjectPath.trim());
  if (!normalizedSelectedProjectPath) {
    return false;
  }

  const candidatePaths = [context.projectPath, context.repoPath]
    .map((pathValue) => pathValue?.trim() || '')
    .filter(Boolean)
    .map(normalizePathForComparison);

  return candidatePaths.includes(normalizedSelectedProjectPath);
}

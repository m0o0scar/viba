export const quoteShellArg = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

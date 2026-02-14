'use client';

import React, { useState, useEffect } from 'react';
import { listDirectories, getHomeDirectory } from '@/app/actions/git';
import { Folder, ArrowLeft, Check, GitBranch } from 'lucide-react';

interface FileSystemItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isGitRepo: boolean;
}

interface FileBrowserProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
  checkRepo?: (path: string) => Promise<boolean>;
}

export default function FileBrowser({ initialPath, onSelect, onCancel, checkRepo }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [items, setItems] = useState<FileSystemItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      // ... same
      if (initialPath) {
        setCurrentPath(initialPath);
      } else {
        // ... same
        const home = await getHomeDirectory();
        setCurrentPath(home);
      }
    };
    init();
  }, [initialPath]); // Added dependency

  useEffect(() => {
    // ... same logic for fetching items ...
    if (!currentPath) return;

    const fetchItems = async () => {
      setLoading(true);
      setError(null);
      try {
        const dirs = await listDirectories(currentPath);
        // ... same map to items
        const mapped: FileSystemItem[] = dirs.map(d => ({
          name: d.name,
          path: d.path,
          isDirectory: d.isDirectory,
          isGitRepo: d.isGitRepo
        }));
        setItems(mapped);
      } catch (err) {
        console.error(err);
        setError('Failed to load directory contents');
      } finally {
        setLoading(false);
      }
    };

    fetchItems();
  }, [currentPath]);

  // ... handleNavigate, handleGoUp ...

  const handleSelect = async () => {
    if (checkRepo) {
      const isValid = await checkRepo(currentPath);
      if (!isValid) {
        setError("Selected directory is not a valid git repository.");
        // Clear error after 3 seconds
        setTimeout(() => setError(null), 3000);
        return;
      }
    }
    onSelect(currentPath);
  };

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
  };

  const handleGoUp = () => {
    // Navigate up one directory
    // Basic implementation assuming unix/windows paths handled by server or string manipulation
    // Since we receive absolute paths, we can split by separator.
    // However, simplest way is to ask server for parent, or just manipulation.
    // Let's use simple string manipulation for now, assuming standard path separators.
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    // Handle root on windows/unix might need care, but for now '/' or 'C:\' logic
    // Actually, handling 'Go Up' robustly is better done by just taking the dirname
    // We don't have 'path.dirname' on client easily without polyfill.
    // But we know currentPath.
    // Let's just find the last separator.
    const lastSepIndex = currentPath.lastIndexOf('/');
    if (lastSepIndex > 0) {
      setCurrentPath(currentPath.substring(0, lastSepIndex));
    } else if (currentPath.length > 1) {
      // Handle root
      setCurrentPath('/');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-base-200 rounded-lg shadow-xl w-full max-w-3xl h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-base-300">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Folder className="w-5 h-5" />
            Browse Local Repository
          </h2>
          <button onClick={onCancel} className="btn btn-sm btn-ghost btn-circle">
            ✕
          </button>
        </div>

        {/* Current Path Bar */}
        <div className="flex items-center gap-2 p-3 bg-base-300">
          <button
            onClick={handleGoUp}
            className="btn btn-sm btn-square btn-ghost"
            title="Go Up"
            disabled={currentPath === '/' || !currentPath}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 overflow-x-auto whitespace-nowrap px-2 font-mono text-sm">
            {currentPath}
          </div>
          <button
            onClick={handleSelect}
            className="btn btn-sm btn-primary"
          >
            Select Current Folder
          </button>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex justify-center items-center h-full">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : error ? (
            <div className="alert alert-error">{error}</div>
          ) : items.length === 0 ? (
            <div className="text-center text-base-content/50 mt-10">Empty directory</div>
          ) : (
            <div className="grid grid-cols-1 gap-1">
              {items.map((item) => (
                <div
                  key={item.path}
                  className="flex items-center justify-between p-2 hover:bg-base-100 rounded-md cursor-pointer transition-colors"
                  onClick={() => handleNavigate(item.path)}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <Folder className={`w-5 h-5 ${item.isGitRepo ? 'text-primary' : 'text-base-content/70'}`} />
                    <span className="truncate">{item.name}</span>
                    {item.isGitRepo && (
                      <span className="badge badge-xs badge-primary">git</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-base-300 text-xs text-base-content/50 text-center">
          Navigate to a folder and click "Select Current Folder" to choose it.
        </div>
      </div>
    </div>
  );
}

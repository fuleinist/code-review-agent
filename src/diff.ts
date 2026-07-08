import { FileDiff, ReviewContext } from './types';
import { minimatch } from 'minimatch';

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java', kt: 'kotlin', scala: 'scala',
  rb: 'ruby',
  php: 'php',
  cs: 'csharp',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp',
  c: 'c',
  swift: 'swift', m: 'objc',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  sql: 'sql',
  html: 'html', htm: 'html',
  css: 'css', scss: 'css', sass: 'css', less: 'css',
  vue: 'vue', svelte: 'svelte',
  md: 'markdown', mdx: 'markdown',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml',
  dockerfile: 'dockerfile',
};

export function detectLanguage(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return 'text';
  return LANG_BY_EXT[lower.slice(dot + 1)] || 'text';
}

/**
 * Parse the GitHub PR Files API response into FileDiff objects.
 * Each file gets a language tag, addition/deletion counts, and the unified patch.
 */
export function parsePullRequestFiles(files: any[]): FileDiff[] {
  return files.map((f) => ({
    filename: f.filename,
    status: (f.status as FileDiff['status']) || 'modified',
    language: detectLanguage(f.filename),
    patch: f.patch,
    additions: f.additions || 0,
    deletions: f.deletions || 0,
  }));
}

/**
 * Count changed lines in a unified diff patch (additions + deletions).
 */
export function countChangedLines(patch: string | undefined): number {
  if (!patch) return 0;
  return patch
    .split('\n')
    .filter((l) => l.startsWith('+') || l.startsWith('-'))
    .filter((l) => !l.startsWith('+++') && !l.startsWith('---'))
    .length;
}

/**
 * Extract added lines and their line numbers from a unified diff.
 * Returns a list of (lineNumber, lineContent) for each + line.
 */
export function extractAddedLines(patch: string | undefined): Array<{ line: number; content: string }> {
  const out: Array<{ line: number; content: string }> = [];
  if (!patch) return out;
  let currentLine = 0;
  let inHunk = false;
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = raw.match(/\+(\d+)/);
      currentLine = m ? parseInt(m[1], 10) - 1 : 0;
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith('+')) {
      currentLine++;
      out.push({ line: currentLine, content: raw.slice(1) });
    } else if (raw.startsWith('-')) {
      // deleted line — no new line number advance
    } else if (raw.startsWith(' ')) {
      currentLine++;
    } else {
      // boundary line
      inHunk = false;
    }
  }
  return out;
}

export function buildReviewContext(event: any): ReviewContext {
  const pr = event.pull_request;
  return {
    owner: event.repository.owner.login,
    repo: event.repository.name,
    prNumber: pr.number,
    prTitle: pr.title,
    prBody: pr.body || '',
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
  };
}

/**
 * Drop files whose repo-relative path matches any glob in `patterns`.
 * Returns the input unchanged when `patterns` is empty. Cross-platform
 * path separators are normalised to forward slashes before matching.
 */
export function filterIgnoredPaths(files: FileDiff[], patterns: string[]): FileDiff[] {
  if (patterns.length === 0) return files;
  return files.filter((f) => {
    const path = f.filename.replace(/\\/g, '/');
    return !patterns.some((pattern) => minimatch(path, pattern, { dot: true }));
  });
}

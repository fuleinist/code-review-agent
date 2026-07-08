import * as core from '@actions/core';

export type Verbosity = 'quiet' | 'normal' | 'detailed';
export type CommentMode = 'inline' | 'summary';

export interface Config {
  apiUrl: string;
  model: string;
  apiKey: string;
  maxFiles: number;
  maxTokens: number;
  verbosity: Verbosity;
  customRules: string;
  skipLabel: string;
  commentMode: CommentMode;
  githubToken: string;
  ignorePaths: string[];
}

export function loadConfig(): Config {
  const verbosity = core.getInput('verbosity', { required: false }) as Verbosity;
  const commentMode = core.getInput('comment-mode', { required: false }) as CommentMode;

  const validVerbosities: Verbosity[] = ['quiet', 'normal', 'detailed'];
  const validModes: CommentMode[] = ['inline', 'summary'];

  if (!validVerbosities.includes(verbosity)) {
    throw new Error(`Invalid verbosity: ${verbosity}. Must be one of: ${validVerbosities.join(', ')}`);
  }
  if (!validModes.includes(commentMode)) {
    throw new Error(`Invalid comment-mode: ${commentMode}. Must be one of: ${validModes.join(', ')}`);
  }

  const maxFiles = parseInt(core.getInput('max-files', { required: false }) || '30', 10);
  const maxTokens = parseInt(core.getInput('max-tokens', { required: false }) || '4096', 10);

  if (isNaN(maxFiles) || maxFiles < 1 || maxFiles > 200) {
    throw new Error(`max-files must be a number between 1 and 200, got: ${maxFiles}`);
  }
  if (isNaN(maxTokens) || maxTokens < 256 || maxTokens > 32768) {
    throw new Error(`max-tokens must be a number between 256 and 32768, got: ${maxTokens}`);
  }

  const apiUrl = core.getInput('api-url', { required: false }) || 'http://localhost:11434/v1';
  if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
    throw new Error(`api-url must start with http:// or https://, got: ${apiUrl}`);
  }

  const ignorePathsRaw = core.getInput('ignore-paths', { required: false }) || '';
  const ignorePaths = ignorePathsRaw
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return {
    apiUrl,
    model: core.getInput('model', { required: false }) || 'qwen2.5-coder:7b',
    apiKey: core.getInput('api-key', { required: false }),
    maxFiles,
    maxTokens,
    verbosity,
    customRules: core.getInput('custom-rules', { required: false }),
    skipLabel: core.getInput('skip-label', { required: false }) || 'skip-review',
    commentMode,
    githubToken: core.getInput('github-token', { required: false }),
    ignorePaths,
  };
}
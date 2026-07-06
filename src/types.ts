export type Severity = 'critical' | 'warning' | 'suggestion' | 'nitpick';

export type Category =
  | 'logic'
  | 'security'
  | 'performance'
  | 'style'
  | 'testing'
  | 'docs'
  | 'api-misuse';

export interface Finding {
  file: string;
  line?: number;
  severity: Severity;
  category: Category;
  message: string;
  suggestion?: string;
}

export interface ReviewResponse {
  findings: Finding[];
  summary?: string;
}

export interface FileDiff {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  language: string;
  patch?: string;
  additions: number;
  deletions: number;
  /** Full content of the new file (only fetched for small files). */
  content?: string;
}

export interface ReviewContext {
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prBody: string;
  baseSha: string;
  headSha: string;
}
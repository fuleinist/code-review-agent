import * as github from '@actions/github';
import { Finding, FileDiff, ReviewContext } from './types';

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🚨',
  warning: '⚠️',
  suggestion: '💡',
  nitpick: '🔍',
};

const CATEGORY_EMOJI: Record<string, string> = {
  logic: '🐛',
  security: '🔒',
  performance: '⚡',
  style: '🎨',
  testing: '🧪',
  docs: '📝',
  'api-misuse': '📚',
};

/**
 * Decide the commit status state + description for a set of findings.
 * Pure function, easy to test.
 *   - critical findings present → 'failure'
 *   - otherwise                  → 'success'
 */
export function commitStatusFor(findings: Finding[]): { state: 'success' | 'failure'; description: string } {
  const critical = findings.filter((f) => f.severity === 'critical').length;
  if (critical > 0) {
    return { state: 'failure', description: `${critical} critical issue${critical === 1 ? '' : 's'}` };
  }
  if (findings.length === 0) {
    return { state: 'success', description: 'No issues found' };
  }
  return {
    state: 'success',
    description: `${findings.length} non-critical finding${findings.length === 1 ? '' : 's'}`,
  };
}

function formatFindingBody(f: Finding): string {
  const lines: string[] = [];
  lines.push(`${SEVERITY_EMOJI[f.severity] || '•'} **${f.severity.toUpperCase()}** — ${CATEGORY_EMOJI[f.category] || '•'} _${f.category}_`);
  lines.push('');
  lines.push(f.message);
  if (f.suggestion) {
    lines.push('');
    lines.push('**Suggestion:**');
    lines.push('```');
    lines.push(f.suggestion);
    lines.push('```');
  }
  return lines.join('\n');
}

export class GitHubClient {
  private octokit: ReturnType<typeof github.getOctokit>;
  private context: ReviewContext;
  private dryRun: boolean;

  constructor(token: string, context: ReviewContext, dryRun = false) {
    this.octokit = github.getOctokit(token);
    this.context = context;
    this.dryRun = dryRun;
  }

  /**
   * Check if the PR has the skip label.
   */
  async hasSkipLabel(label: string): Promise<boolean> {
    try {
      const { data: pr } = await this.octokit.rest.pulls.get({
        owner: this.context.owner,
        repo: this.context.repo,
        pull_number: this.context.prNumber,
      });
      return (pr.labels || []).some((l: any) => l.name === label);
    } catch (err) {
      return false;
    }
  }

  /**
   * Post a single inline review comment on a specific file/line.
   * Falls back to summary if line is missing or invalid.
   */
  async postInlineComment(finding: Finding, commitId: string): Promise<boolean> {
    if (this.dryRun) {
      console.log(`[dry-run] would post on ${finding.file}:${finding.line}: ${finding.message}`);
      return true;
    }

    try {
      await this.octokit.rest.pulls.createReviewComment({
        owner: this.context.owner,
        repo: this.context.repo,
        pull_number: this.context.prNumber,
        commit_id: commitId,
        path: finding.file,
        line: finding.line || 1,
        body: formatFindingBody(finding),
      });
      return true;
    } catch (err: any) {
      console.warn(`Failed to post inline comment on ${finding.file}:${finding.line}: ${err.message}`);
      return false;
    }
  }

  /**
   * Set a commit status on the PR head SHA per SPEC §"Behavior" step 9.
   * `success` when no actionable findings, `failure` when critical issues present.
   */
  async postCommitStatus(state: 'success' | 'failure' | 'pending' | 'error', description: string): Promise<boolean> {
    if (this.dryRun) {
      console.log(`[dry-run] would set commit status: ${state} - ${description}`);
      return true;
    }
    try {
      await this.octokit.rest.repos.createCommitStatus({
        owner: this.context.owner,
        repo: this.context.repo,
        sha: this.context.headSha,
        state,
        description,
        context: 'code-review-agent',
      });
      return true;
    } catch (err: any) {
      console.warn(`Failed to set commit status: ${err.message}`);
      return false;
    }
  }

  /**
   * Post a single summary review with all findings.
   */
  async postSummaryReview(findings: Finding[], event: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES' = 'COMMENT'): Promise<string | null> {
    if (this.dryRun) {
      console.log(`[dry-run] would post summary review with ${findings.length} findings (event: ${event})`);
      return 'dry-run';
    }

    const body = this.formatSummaryBody(findings);
    try {
      const { data } = await this.octokit.rest.pulls.createReview({
        owner: this.context.owner,
        repo: this.context.repo,
        pull_number: this.context.prNumber,
        commit_id: this.context.headSha,
        body,
        event,
      });
      return data.id.toString();
    } catch (err: any) {
      console.warn(`Failed to post summary review: ${err.message}`);
      return null;
    }
  }

  /**
   * Post findings as either inline comments or a summary review.
   * Returns the review ID and the count of successfully posted findings.
   */
  async postFindings(
    findings: Finding[],
    mode: 'inline' | 'summary',
  ): Promise<{ reviewId: string | null; posted: number; criticalCount: number }> {
    let posted = 0;
    const criticalCount = findings.filter((f) => f.severity === 'critical').length;

    if (mode === 'summary' || findings.length === 0) {
      const reviewId = await this.postSummaryReview(
        findings,
        criticalCount > 0 ? 'REQUEST_CHANGES' : 'COMMENT',
      );
      return { reviewId, posted: findings.length, criticalCount };
    }

    // Inline mode
    for (const f of findings) {
      const ok = await this.postInlineComment(f, this.context.headSha);
      if (ok) posted++;
    }

    // Also post a summary comment for visibility
    const reviewId = await this.postSummaryReview(
      findings,
      criticalCount > 0 ? 'REQUEST_CHANGES' : 'COMMENT',
    );

    return { reviewId, posted, criticalCount };
  }

  private formatSummaryBody(findings: Finding[]): string {
    if (findings.length === 0) {
      return `## 🤖 Local LLM Code Review\n\n✅ No issues found. Reviewed with \`${process.env.MODEL_NAME || 'local LLM'}\`.`;
    }

    const lines: string[] = [];
    lines.push(`## 🤖 Local LLM Code Review`);
    lines.push('');
    lines.push(`Found **${findings.length}** issue${findings.length === 1 ? '' : 's'}:`);
    lines.push('');

    // Group by file
    const byFile = new Map<string, Finding[]>();
    for (const f of findings) {
      if (!byFile.has(f.file)) byFile.set(f.file, []);
      byFile.get(f.file)!.push(f);
    }

    for (const [file, fs] of byFile.entries()) {
      lines.push(`### \`${file}\``);
      lines.push('');
      for (const f of fs) {
        lines.push(formatFindingBody(f));
        lines.push('');
      }
    }

    lines.push('---');
    lines.push('_Reviewed privately using your local LLM. No code left your runner._');
    return lines.join('\n');
  }
}
import { FileDiff, ReviewContext } from './types';

export const SYSTEM_PROMPT = `You are a senior staff engineer reviewing a pull request.
Your job: find REAL issues — logic bugs, security vulnerabilities, broken APIs, missing tests, data loss risks, race conditions.
Do NOT comment on style, formatting, or trivial nits unless they hide a real bug.
Be terse. Prefer fewer high-quality findings over many weak ones.

Output strictly valid JSON matching this schema:
{
  "findings": [
    {
      "file":  "relative/path/to/file",
      "line":  42,                       // optional, must reference a line in the new file
      "severity": "critical" | "warning" | "suggestion" | "nitpick",
      "category": "logic" | "security" | "performance" | "style" | "testing" | "docs" | "api-misuse",
      "message":  "1-2 sentences describing the issue",
      "suggestion": "optional code snippet or fix hint"
    }
  ],
  "summary": "optional 1-line summary if no findings"
}

Severity guide:
- critical: will break prod / leak data / corrupt state. Always report.
- warning: real bug or design flaw. Report.
- suggestion: improvement that prevents future bugs. Report only if obvious win.
- nitpick: trivial. Skip unless truly egregious.

Only include findings for issues you can name concretely. If you cannot, return {"findings": []}.
No markdown outside the JSON. No prose before or after. Output JSON only.`;

/**
 * Build the user prompt for a single file diff.
 */
export function buildFilePrompt(ctx: ReviewContext, file: FileDiff, fullContent?: string): string {
  const lines: string[] = [];
  lines.push(`PR #${ctx.prNumber}: ${ctx.prTitle}`);
  if (ctx.prBody) {
    lines.push(`Description: ${ctx.prBody.slice(0, 500)}`);
  }
  lines.push('');
  lines.push(`File: ${file.filename} [${file.status}] (+${file.additions} -${file.deletions})`);
  lines.push(`Language: ${file.language}`);
  lines.push('');
  lines.push('Unified diff:');
  lines.push('```diff');
  lines.push(file.patch || '(empty patch)');
  lines.push('```');

  if (fullContent) {
    lines.push('');
    lines.push('Full file content for context:');
    lines.push(`\`\`\`${file.language}`);
    lines.push(fullContent);
    lines.push('\`\`\`');
  }

  lines.push('');
  lines.push('Review this diff. Return JSON with findings (or empty findings array).');
  return lines.join('\n');
}

/**
 * Build a combined prompt for multiple small files (saves round-trips).
 */
export function buildBatchPrompt(ctx: ReviewContext, files: FileDiff[]): string {
  const lines: string[] = [];
  lines.push(`PR #${ctx.prNumber}: ${ctx.prTitle}`);
  if (ctx.prBody) {
    lines.push(`Description: ${ctx.prBody.slice(0, 500)}`);
  }
  lines.push('');
  lines.push(`Reviewing ${files.length} files in this batch:`);
  lines.push('');

  for (const file of files) {
    lines.push(`=== ${file.filename} [${file.status}] (+${file.additions} -${file.deletions}) ===`);
    lines.push('```diff');
    lines.push(file.patch || '(empty patch)');
    lines.push('```');
    lines.push('');
  }

  lines.push('Return JSON with findings. The "file" field must match exactly one of the filenames above.');
  return lines.join('\n');
}

/**
 * Append user-supplied custom rules to the system prompt.
 */
export function applyCustomRules(base: string, customRules: string): string {
  if (!customRules || !customRules.trim()) return base;
  return `${base}\n\nAdditional project-specific rules (highest priority):\n${customRules.trim()}`;
}
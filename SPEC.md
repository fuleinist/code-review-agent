# code-review-agent — Specification

## Overview

Privacy-first GitHub Action for automated code review using **local LLMs** (Ollama, vLLM, llama.cpp, LM Studio — any OpenAI-compatible endpoint). No code leaves the runner. Designed for enterprises with compliance requirements who can't use CodeRabbit / GitHub Copilot code review / etc.

## Why?

Existing AI code review tools send code to third-party APIs. Compliance teams (SOC2, HIPAA, GDPR, internal data policies) block them. The remaining open-source alternatives are basic regex linters or noisy GPT wrappers.

**Differentiator:** runs against your own local model — no third-party data sharing. Tunable prompts for project-specific rules. Smart enough to catch real bugs, conservative enough not to spam.

## Architecture

```
code-review-agent/
├── action.yml                  # GitHub Action manifest
├── src/
│   ├── index.ts                # Entry point
│   ├── llm.ts                  # OpenAI-compatible client
│   ├── prompts.ts              # Prompt templates
│   ├── github.ts               # GitHub API helpers
│   ├── diff.ts                 # PR diff parsing
│   └── config.ts               # Config parsing + validation
├── dist/index.js               # Bundled output (committed)
├── package.json
├── tsconfig.json
├── example-workflow.yml        # Sample usage
└── README.md
```

## Phase 1 — MVP

### Inputs (action.yml)

| Input          | Required | Default                  | Description                              |
|----------------|----------|--------------------------|------------------------------------------|
| `api-url`      | Yes      | `http://localhost:11434` | OpenAI-compatible endpoint URL           |
| `model`        | No       | `qwen2.5-coder:7b`       | Model name                               |
| `api-key`      | No       | (empty)                  | Auth header value (for hosted endpoints) |
| `max-files`    | No       | `30`                     | Max files to review per PR               |
| `max-tokens`   | No       | `4096`                   | Max tokens for LLM response              |
| `verbosity`    | No       | `normal`                 | `quiet`, `normal`, `detailed`            |
| `custom-rules` | No       | (empty)                  | Extra instructions appended to prompt    |
| `skip-label`   | No       | `skip-review`            | PR label that opts out                   |
| `comment-mode` | No       | `inline`                 | `inline` (per-file comments) or `summary` |

### Behavior

1. Triggered on `pull_request` (opened, synchronize, reopened)
2. If PR has `${{ inputs.skip-label }}` → exit with note
3. Fetch PR diff via GitHub API
4. Group diff hunks by file (cap at `max-files`)
5. For each file, construct prompt:
   - System: code review expert persona + custom rules
   - User: language, filename, full file content (if small), diff hunks, "what changed"
6. Call LLM endpoint (streaming optional, default non-streaming)
7. Parse response into structured findings:
   ```json
   {
     "findings": [
       {
         "file": "src/api.ts",
         "line": 42,
         "severity": "warning",
         "category": "logic",
         "message": "...",
         "suggestion": "..."
       }
     ]
   }
   ```
8. Post findings as PR review comments (inline or summary)
9. Set commit status: success (no issues) / failure (critical issues)

### Findings Schema

```typescript
type Severity = 'critical' | 'warning' | 'suggestion' | 'nitpick'
type Category = 'logic' | 'security' | 'performance' | 'style' | 'testing' | 'docs' | 'api-misuse'

interface Finding {
  file: string
  line?: number          // line in the new file
  severity: Severity
  category: Category
  message: string        // 1-2 sentences
  suggestion?: string    // optional code suggestion
}
```

### Acceptance Criteria

1. Action runs in a GitHub workflow with only a `uses:` line + Ollama endpoint
2. Posts inline comments on specific lines when the LLM returns a valid finding with a `line`
3. Falls back to a summary comment if `line` is missing or invalid
4. Skips PRs with the opt-out label
5. Handles LLM errors gracefully (no workflow crash; logs an actionable error)
6. Works with Ollama, vLLM, llama.cpp server, LM Studio, OpenAI (hosted mode)
7. Token-efficient: only sends changed hunks + small file context
8. README has copy-paste workflow snippet

## Tech Stack

- **Runtime:** Node.js 20 (matches GitHub-hosted runners)
- **Language:** TypeScript 5
- **Deps:** `@actions/core`, `@actions/github`, `openai` (or thin fetch wrapper)
- **Build:** `@vercel/ncc` → single `dist/index.js` (committed)
- **License:** MIT

## Out of Scope (Phase 2)

- Incremental / streaming reviews
- Auto-fix suggestions via patch files
- Per-language specialized prompts
- Caching repeated prompts
- Slack/Discord notifications
- Multi-model ensemble (vote between models)

## Security

- No outbound HTTP besides the configured LLM endpoint and GitHub API
- No telemetry, no analytics, no phone-home
- All secrets via `secrets.*` (never logged)
- PR content not persisted to disk beyond the action's working directory
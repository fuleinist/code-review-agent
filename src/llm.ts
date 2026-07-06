import OpenAI from 'openai';
import { Config } from './config';
import { ReviewResponse } from './types';

/**
 * Thin wrapper around the OpenAI client that works against any OpenAI-compatible
 * endpoint (Ollama, vLLM, llama.cpp server, LM Studio, OpenAI itself).
 */
export class LLMClient {
  private client: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor(config: Config) {
    this.client = new OpenAI({
      apiKey: config.apiKey || 'no-key-needed',
      baseURL: config.apiUrl,
      defaultHeaders: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    });
    this.model = config.model;
    this.maxTokens = config.maxTokens;
  }

  /**
   * Send a chat completion request and parse the response as JSON.
   */
  async review(systemPrompt: string, userPrompt: string): Promise<ReviewResponse> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('LLM returned empty response');
    }

    return this.parseResponse(content);
  }

  /**
   * Parse the LLM response text into a ReviewResponse.
   * Tolerant: handles minor format variations.
   */
  parseResponse(text: string): ReviewResponse {
    // Try strict JSON first
    try {
      const parsed = JSON.parse(text);
      return this.validate(parsed);
    } catch {
      // Fallback: extract JSON from ```json ... ``` blocks
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        try {
          const parsed = JSON.parse(match[1].trim());
          return this.validate(parsed);
        } catch {
          // fall through
        }
      }
      throw new Error(`Could not parse LLM response as JSON: ${text.slice(0, 200)}...`);
    }
  }

  validate(obj: any): ReviewResponse {
    if (!obj || typeof obj !== 'object') {
      return { findings: [] };
    }
    const findings = Array.isArray(obj.findings) ? obj.findings : [];
    const validFindings = findings
      .filter((f: any) => f && typeof f === 'object' && typeof f.file === 'string')
      .map((f: any) => ({
        file: f.file,
        line: typeof f.line === 'number' && f.line > 0 ? f.line : undefined,
        severity: ['critical', 'warning', 'suggestion', 'nitpick'].includes(f.severity)
          ? f.severity
          : 'warning',
        category: ['logic', 'security', 'performance', 'style', 'testing', 'docs', 'api-misuse'].includes(
          f.category,
        )
          ? f.category
          : 'logic',
        message: typeof f.message === 'string' ? f.message : '',
        suggestion: typeof f.suggestion === 'string' ? f.suggestion : undefined,
      }))
      .filter((f: any) => f.message.length > 0);

    return {
      findings: validFindings,
      summary: typeof obj.summary === 'string' ? obj.summary : undefined,
    };
  }
}
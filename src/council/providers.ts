// ── LLM Provider Clients ─────────────────────────────────────────────
// Direct API calls to each provider for the Supreme Council.


interface CompletionResult {
  content: string;
  thinkingTokens?: number;
  completionTokens?: number;
}

// ── Anthropic (Claude Opus 4.6) ──────────────────────────────────────

async function callAnthropic(
  systemPrompt: string,
  messages: { role: string; content: string }[],
): Promise<CompletionResult> {
  // Support both standard API key and Claude Code OAuth token
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

  if (!apiKey && !oauthToken) {
    throw new Error('Neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set');
  }

  // Build headers based on auth type
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };

  if (apiKey) {
    // Standard API key auth
    headers['x-api-key'] = apiKey;
  } else if (oauthToken) {
    // OAuth token auth (Claude Code token)
    headers['Authorization'] = `Bearer ${oauthToken}`;
    headers['anthropic-beta'] = 'oauth-2025-04-20';
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { output_tokens?: number };
  };
  const textBlock = data.content?.find((b) => b.type === 'text');
  return {
    content: textBlock?.text || '',
    completionTokens: data.usage?.output_tokens,
  };
}

// ── OpenAI (GPT-5.2 Codex) ──────────────────────────────────────────
// Note: GPT-5.3-Codex is in phased API rollout. Using gpt-5.2-codex
// as the primary model with gpt-5.2 as fallback for broad API access.

const OPENAI_MODELS = ['gpt-5.2-codex', 'gpt-5.2'] as const;

async function callOpenAI(
  systemPrompt: string,
  messages: { role: string; content: string }[],
): Promise<CompletionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  // Try models in order of preference (most capable first)
  let lastError: Error | null = null;

  for (const model of OPENAI_MODELS) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: 8192,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        // If model not found, try next model
        if (res.status === 404) {
          lastError = new Error(`OpenAI model ${model} not available: ${err}`);
          continue;
        }
        throw new Error(`OpenAI API error ${res.status}: ${err}`);
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { completion_tokens?: number };
      };
      return {
        content: data.choices?.[0]?.message?.content || '',
        completionTokens: data.usage?.completion_tokens,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Only continue to next model for model-not-found errors
      if (!String(err).includes('404')) throw err;
    }
  }

  throw lastError || new Error('All OpenAI models failed');
}

// ── Google (Gemini 3 Pro) ────────────────────────────────────────────
// Model ID: gemini-3-pro-preview (the GA alias gemini-3-pro may not work
// on all API versions)

const GEMINI_MODELS = ['gemini-3-pro-preview', 'gemini-2.5-pro'] as const;

async function callGoogle(
  systemPrompt: string,
  messages: { role: string; content: string }[],
): Promise<CompletionResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set');

  // Build Gemini conversation format
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  let lastError: Error | null = null;

  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
              maxOutputTokens: 8192,
              temperature: 0.8,
            },
          }),
        },
      );

      if (!res.ok) {
        const err = await res.text();
        if (res.status === 404) {
          lastError = new Error(`Google model ${model} not available: ${err}`);
          continue;
        }
        throw new Error(`Google AI API error ${res.status}: ${err}`);
      }

      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { candidatesTokenCount?: number };
      };
      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return {
        content: text,
        completionTokens: data.usageMetadata?.candidatesTokenCount,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!String(err).includes('404')) throw err;
    }
  }

  throw lastError || new Error('All Google models failed');
}

// ── Provider Router ──────────────────────────────────────────────────

const providerMap: Record<
  string,
  (
    systemPrompt: string,
    messages: { role: string; content: string }[],
  ) => Promise<CompletionResult>
> = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  google: callGoogle,
};

export async function callAdmiral(
  provider: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
): Promise<CompletionResult> {
  const fn = providerMap[provider];
  if (!fn) throw new Error(`Unknown provider: ${provider}`);
  return fn(systemPrompt, messages);
}

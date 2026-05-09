/**
 * Tiny, dependency-injectable wrapper around the OpenAI Chat Completions
 * API. Lives behind a small interface so that:
 *
 *  - the dual-view adapter can call it without knowing about `fetch`,
 *  - tests can inject a mock client without touching the real network,
 *  - the API key never leaks into logs, the DB, or the `SkillInvocation`
 *    record (the adapter only ever passes the key by reference, never by
 *    value, and never persists it).
 *
 * No SDK is added on purpose — `fetch` is in Node 20+ and keeps the
 * runtime/build trivial.
 */

export type OpenAIChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenAIChatRequest = {
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  responseFormat?: "json_object" | "text";
};

export type OpenAIChatResponse = {
  content: string;
  model: string;
};

export interface OpenAIChatClient {
  chat(
    req: OpenAIChatRequest,
    opts: { apiKey: string; signal?: AbortSignal },
  ): Promise<OpenAIChatResponse>;
}

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

const defaultClient: OpenAIChatClient = {
  async chat(req, { apiKey, signal }) {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
    };
    if (typeof req.temperature === "number") body.temperature = req.temperature;
    if (req.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    }
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // Strip the body to a short, secret-free message.
      const safe = text.slice(0, 200).replace(/sk-[A-Za-z0-9_-]+/g, "sk-***");
      throw new Error(
        `OpenAI HTTP ${res.status} ${res.statusText}: ${safe || "geen body"}`,
      );
    }
    const json = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    if (!content) {
      throw new Error("OpenAI antwoord bevatte geen content");
    }
    return { content, model: json.model ?? req.model };
  },
};

let injected: OpenAIChatClient | null = null;

/**
 * Test seam: replace the OpenAI client with a fake. Pass `null` to
 * restore the default fetch-based implementation. Production code paths
 * never call this.
 */
export function setOpenAIChatClientForTesting(
  client: OpenAIChatClient | null,
): void {
  injected = client;
}

export function getOpenAIChatClient(): OpenAIChatClient {
  return injected ?? defaultClient;
}

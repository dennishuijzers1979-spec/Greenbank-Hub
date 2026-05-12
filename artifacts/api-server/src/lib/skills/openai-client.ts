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

/**
 * Structured-Outputs response-format spec. When passed, the request body
 * sets `response_format = { type: "json_schema", json_schema: { name,
 * schema, strict } }` per OpenAI Chat Completions API. The caller owns
 * the JSON schema object; this client does not validate or modify it.
 *
 * Only supported on `gpt-4o-2024-08-06+`, `gpt-4o-mini-2024-07-18+`,
 * and the o1 / 4.1 / 5-series models. Unsupported models return
 * HTTP 400 — callers should detect that and fall back to a less
 * strict format (e.g. "json_object").
 */
export type OpenAIJsonSchemaResponseFormat = {
  type: "json_schema";
  schema: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
};

export type OpenAIChatRequest = {
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  responseFormat?: "json_object" | "text" | OpenAIJsonSchemaResponseFormat;
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

/**
 * Error thrown by `defaultClient.chat` for non-2xx HTTP responses.
 * Carries the numeric `status` so callers (e.g. the kredietworkflow
 * adapter's structured-outputs path) can detect HTTP 400 from an
 * unsupported `response_format: json_schema` and retry with a less
 * strict format. Never carries the API key or full upstream body.
 */
export class OpenAIHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "OpenAIHttpError";
    this.status = status;
  }
}

/**
 * Pure function that builds the JSON body posted to OpenAI from an
 * `OpenAIChatRequest`. Exposed for tests so the structured-outputs
 * path can be asserted without a real network call.
 *
 * - `responseFormat === "json_object"` → `response_format = { type: "json_object" }`.
 * - `responseFormat = { type: "json_schema", schema: {...} }` →
 *   `response_format = { type: "json_schema", json_schema: { name,
 *   schema, strict: strict ?? true } }`.
 * - `responseFormat === "text"` or omitted → no `response_format`
 *   key (default OpenAI behaviour).
 */
export function buildOpenAIRequestBody(
  req: OpenAIChatRequest,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
  };
  if (typeof req.temperature === "number") body.temperature = req.temperature;
  if (req.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  } else if (
    typeof req.responseFormat === "object" &&
    req.responseFormat !== null &&
    req.responseFormat.type === "json_schema"
  ) {
    const { name, schema, strict } = req.responseFormat.schema;
    body.response_format = {
      type: "json_schema",
      json_schema: { name, schema, strict: strict ?? true },
    };
  }
  return body;
}

const defaultClient: OpenAIChatClient = {
  async chat(req, { apiKey, signal }) {
    const body = buildOpenAIRequestBody(req);
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
      throw new OpenAIHttpError(
        res.status,
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

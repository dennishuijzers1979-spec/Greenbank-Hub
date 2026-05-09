/**
 * Loads imported ChatGPT skill instructions (`SKILL.md`) from disk so the
 * adapter can use them as the OpenAI system prompt. The loader is
 * intentionally minimal:
 *
 *  - searches upward from `process.cwd()` for the repo-root `skills/`
 *    folder (the api-server is started from a few different cwds in
 *    dev/build/test);
 *  - allows an explicit `GEENBANK_SKILLS_DIR` override;
 *  - caches per-skill content in memory so we don't re-read on every
 *    dossier run.
 *
 * The loader never throws on import — it throws only when a missing
 * skill is actively requested, so the rest of the AI pipeline keeps
 * working in mock mode.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const cache = new Map<string, string>();
let cachedRoot: string | null = null;

function findSkillsRoot(): string {
  if (cachedRoot) return cachedRoot;
  const override = process.env.GEENBANK_SKILLS_DIR;
  if (override && existsSync(override)) {
    cachedRoot = resolve(override);
    return cachedRoot;
  }
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, "skills");
    if (existsSync(candidate)) {
      cachedRoot = candidate;
      return cachedRoot;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Last-resort default — readFileSync below will throw with a clear
  // message that the operator can act on.
  cachedRoot = resolve(process.cwd(), "skills");
  return cachedRoot;
}

/**
 * Read the imported `SKILL.md` for a skill pack from disk and return
 * its full text. Caches the result. Throws a Dutch error message if
 * the file is missing — the dual-view adapter catches this, records a
 * `fallbackReason`, and falls back to deterministic mock output.
 */
export function loadSkillMarkdown(slug: string): string {
  const cached = cache.get(slug);
  if (cached) return cached;
  const path = resolve(findSkillsRoot(), slug, "SKILL.md");
  if (!existsSync(path)) {
    throw new Error(
      `SKILL.md ontbreekt voor "${slug}" (verwacht op ${path}). ` +
        `Importeer het skill-pack of zet GEENBANK_SKILLS_DIR.`,
    );
  }
  const content = readFileSync(path, "utf8");
  if (!content.trim()) {
    throw new Error(`SKILL.md voor "${slug}" is leeg`);
  }
  cache.set(slug, content);
  return content;
}

/** Test seam: clear the in-memory cache so file changes are picked up. */
export function clearSkillMarkdownCacheForTesting(): void {
  cache.clear();
  cachedRoot = null;
}

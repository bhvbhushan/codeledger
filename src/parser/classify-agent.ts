/**
 * Classifies an agent as "user" (coding work) or "overhead" (background system/plugin).
 *
 * Detection is based on agentId prefix — a universal structural signal
 * present in all Claude Code versions.
 *
 * The agentId may come from:
 * - JSONL field: "acompact-7aad72" (raw prefix)
 * - Filename extraction: "agent-acompact-7aad72" (with agent- prefix)
 *
 * Overhead prefixes:
 * - acompact-*            -> plugin observer/compaction sidechains
 * - aprompt_suggestion-*  -> autocomplete system agents
 * - aside_question-*      -> side question UI feature
 *
 * Everything else -> user (explicitly spawned coding agents)
 */
const OVERHEAD_PREFIXES = [
  "acompact-",
  "aprompt_suggestion-",
  "aside_question-",
];

export function classifyAgentSource(agentId: string): "user" | "overhead" {
  // Strip "agent-" prefix if present (filename-derived IDs have it)
  const normalized = agentId.startsWith("agent-")
    ? agentId.slice(6)
    : agentId;

  for (const prefix of OVERHEAD_PREFIXES) {
    if (normalized.startsWith(prefix)) return "overhead";
  }
  return "user";
}

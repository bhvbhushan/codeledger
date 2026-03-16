/**
 * Classifies an agent as "user" (coding work) or "overhead" (background system/plugin).
 *
 * Detection is based on agentId prefix — a universal structural signal
 * present in all Claude Code versions:
 *
 * - acompact-*            -> overhead (plugin observer/compaction sidechains)
 * - aprompt_suggestion-*  -> overhead (autocomplete system agents)
 * - aside_question-*      -> overhead (side question UI feature)
 * - Pure hex (a{hex})     -> user (explicitly spawned coding agents)
 */
export function classifyAgentSource(agentId: string): "user" | "overhead" {
  if (agentId.startsWith("acompact-")) return "overhead";
  if (agentId.startsWith("aprompt_suggestion-")) return "overhead";
  if (agentId.startsWith("aside_question-")) return "overhead";
  return "user";
}

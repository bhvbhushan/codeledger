export interface ToolUseRef {
  name: string;
  id: string;
}

export interface AssistantData {
  messageId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  toolUses: ToolUseRef[];
  timestamp: string;
  stopReason: string | null;
}

export function extractAssistantData(line: any): AssistantData | null {
  if (line.type !== "assistant") return null;

  const msg = line.message;
  if (!msg) return null;

  // Skip synthetic/error messages
  if (msg.model === "<synthetic>" || line.isApiErrorMessage) return null;

  const usage = msg.usage ?? {};

  // Extract tool_use blocks from content
  const toolUses: ToolUseRef[] = [];
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === "tool_use" && block.name) {
        toolUses.push({ name: block.name, id: block.id ?? "" });
      }
    }
  }

  return {
    messageId: msg.id ?? "",
    model: msg.model ?? "unknown",
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreateTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    toolUses,
    timestamp: line.timestamp ?? "",
    stopReason: msg.stop_reason ?? null,
  };
}

export function deduplicateMessages(messages: AssistantData[]): AssistantData[] {
  const byId = new Map<string, AssistantData>();

  for (const msg of messages) {
    const existing = byId.get(msg.messageId);
    if (!existing) {
      byId.set(msg.messageId, msg);
    } else if (msg.stopReason !== null) {
      byId.set(msg.messageId, msg);
    }
  }

  return Array.from(byId.values());
}

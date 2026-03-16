import { describe, it, expect } from "vitest";
import {
  extractAssistantData,
  deduplicateMessages,
  type AssistantData,
} from "../../src/parser/message-extractor.js";

describe("message-extractor", () => {
  it("extracts tokens, model, and timestamp from assistant line", () => {
    const line = {
      type: "assistant",
      timestamp: "2026-03-15T10:00:00Z",
      message: {
        model: "claude-opus-4-6",
        id: "msg_001",
        stop_reason: "stop_sequence",
        content: [],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 30,
        },
      },
    };

    const data = extractAssistantData(line);
    expect(data).not.toBeNull();
    expect(data!.model).toBe("claude-opus-4-6");
    expect(data!.messageId).toBe("msg_001");
    expect(data!.inputTokens).toBe(100);
    expect(data!.outputTokens).toBe(50);
    expect(data!.cacheCreateTokens).toBe(200);
    expect(data!.cacheReadTokens).toBe(30);
  });

  it("skips synthetic model lines", () => {
    const line = {
      type: "assistant",
      timestamp: "2026-03-15T10:00:00Z",
      isApiErrorMessage: true,
      message: { model: "<synthetic>", id: "msg_err", stop_reason: null, content: [], usage: { input_tokens: 0, output_tokens: 0 } },
    };
    expect(extractAssistantData(line)).toBeNull();
  });

  it("extracts tool_use blocks from content", () => {
    const line = {
      type: "assistant",
      timestamp: "2026-03-15T10:00:00Z",
      message: {
        model: "claude-sonnet-4-5-20250514",
        id: "msg_002",
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "Let me read that." },
          { type: "tool_use", id: "toolu_001", name: "Read", input: { file_path: "/tmp/x" } },
          { type: "tool_use", id: "toolu_002", name: "Edit", input: {} },
        ],
        usage: { input_tokens: 50, output_tokens: 25, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    };

    const data = extractAssistantData(line);
    expect(data!.toolUses).toEqual([
      { name: "Read", id: "toolu_001" },
      { name: "Edit", id: "toolu_002" },
    ]);
  });

  it("deduplicates streamed messages by message.id", () => {
    const messages: AssistantData[] = [
      { messageId: "msg_001", model: "claude-opus-4-6", inputTokens: 10, outputTokens: 5, cacheCreateTokens: 0, cacheReadTokens: 0, toolUses: [], timestamp: "2026-03-15T10:00:00Z", stopReason: null },
      { messageId: "msg_001", model: "claude-opus-4-6", inputTokens: 10, outputTokens: 20, cacheCreateTokens: 0, cacheReadTokens: 0, toolUses: [], timestamp: "2026-03-15T10:00:01Z", stopReason: null },
      { messageId: "msg_001", model: "claude-opus-4-6", inputTokens: 10, outputTokens: 50, cacheCreateTokens: 100, cacheReadTokens: 0, toolUses: [{ name: "Read", id: "t1" }], timestamp: "2026-03-15T10:00:02Z", stopReason: "stop_sequence" },
      { messageId: "msg_002", model: "claude-opus-4-6", inputTokens: 20, outputTokens: 30, cacheCreateTokens: 0, cacheReadTokens: 0, toolUses: [], timestamp: "2026-03-15T10:00:03Z", stopReason: "stop_sequence" },
    ];

    const deduped = deduplicateMessages(messages);
    expect(deduped.length).toBe(2);
    expect(deduped[0].messageId).toBe("msg_001");
    expect(deduped[0].outputTokens).toBe(50); // from the final streamed line
    expect(deduped[0].stopReason).toBe("stop_sequence");
    expect(deduped[1].messageId).toBe("msg_002");
  });
});

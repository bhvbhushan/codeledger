import { describe, it, expect } from "vitest";
import { classifyAgentSource } from "../../src/parser/classify-agent.js";

describe("classifyAgentSource", () => {
  it("classifies acompact- agents as overhead", () => {
    expect(classifyAgentSource("acompact-7aad72")).toBe("overhead");
    expect(classifyAgentSource("acompact-33eb9bdd097be81e")).toBe("overhead");
  });

  it("classifies aprompt_suggestion- agents as overhead", () => {
    expect(classifyAgentSource("aprompt_suggestion-23e3e5")).toBe("overhead");
    expect(classifyAgentSource("aprompt_suggestion-abc123def456")).toBe("overhead");
  });

  it("classifies aside_question- agents as overhead", () => {
    expect(classifyAgentSource("aside_question-94d26433f3755c77")).toBe("overhead");
  });

  it("classifies regular hex agents as user", () => {
    expect(classifyAgentSource("ab3ccab")).toBe("user");
    expect(classifyAgentSource("a06f2dfd8d82513bd")).toBe("user");
    expect(classifyAgentSource("a1c89e8ee855bf90c")).toBe("user");
  });

  it("classifies unknown prefixes as user (safe default)", () => {
    expect(classifyAgentSource("something-unknown")).toBe("user");
    expect(classifyAgentSource("")).toBe("user");
  });
});

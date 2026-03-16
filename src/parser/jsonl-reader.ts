import { createReadStream } from "fs";
import { createInterface } from "readline";

export interface JsonlLine {
  type: string;
  [key: string]: unknown;
}

interface ReadOptions {
  types?: string[];
  maxLines?: number;
}

export async function readJsonlLines(
  filePath: string,
  options?: ReadOptions
): Promise<JsonlLine[]> {
  const lines: JsonlLine[] = [];

  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed) as JsonlLine;
      if (!parsed.type) continue;

      if (options?.types && !options.types.includes(parsed.type)) continue;

      lines.push(parsed);

      if (options?.maxLines && lines.length >= options.maxLines) break;
    } catch {
      // Skip malformed lines -- defensive parsing per spec requirement
      continue;
    }
  }

  return lines;
}

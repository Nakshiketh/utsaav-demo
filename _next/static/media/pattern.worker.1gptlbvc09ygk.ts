/// <reference lib="webworker" />
import { generatePattern, type PatternInput } from "@/core/patterns";

self.onmessage = (e: MessageEvent<{ key: string; input: PatternInput }>) => {
  const { key, input } = e.data;
  try {
    const result = generatePattern(input);
    (self as unknown as Worker).postMessage({ key, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ key, error: err instanceof Error ? err.message : String(err) });
  }
};

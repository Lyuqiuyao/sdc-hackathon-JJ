// Archived private-key transport. No production route imports this module.
// Kept for historical review only; never selected as a fallback.
import OpenAI from "openai";
import { instructions, OPENAI_MODEL, OPENAI_TIMEOUT_MS, type OpenAITransport } from "./ai-provider";
import { openaiJsonSchema } from "./ai-schema";
export function createLegacyOpenAITransport(apiKey: string, fetch?: typeof globalThis.fetch): OpenAITransport {
  return async (context, signal) => {
    const client = new OpenAI({ apiKey, baseURL: "https://api.openai.com/v1",
      timeout: OPENAI_TIMEOUT_MS, maxRetries: 0, ...(fetch ? { fetch } : {}) });
    const response = await client.responses.create({
      model: OPENAI_MODEL, instructions, input: JSON.stringify(context),
      store: false, max_output_tokens: 24000, reasoning: { effort: "minimal" },
      text: { format: { type: "json_schema", name: "collection_advice", strict: true, schema: openaiJsonSchema } },
    }, { signal });
    if (response.status !== "completed") throw new Error("Incomplete model response");
    return response.output_text ?? "";
  };
}

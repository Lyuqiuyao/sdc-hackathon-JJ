// Archived transport only. Not imported by production routes or provider selection.
// Retained for rollback reference; does not read credentials or issue requests on import.
import { GoogleGenAI, type HttpOptions } from "@google/genai";
import { instructions, type OpenAITransport } from "./ai-provider";
import { responseJsonSchema } from "./ai-schema";
export const GEMINI_MODEL = "gemini-3.8-flash";
export const GEMINI_TIMEOUT_MS = 45_000;
export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY?.trim());
export function createGeminiTransport(apiKey: string, fetch?: HttpOptions["fetch"]): OpenAITransport {
  return async (context, signal) => {
    const client = new GoogleGenAI({ apiKey,
      httpOptions: { timeout: GEMINI_TIMEOUT_MS, retryOptions: { attempts: 1 }, ...(fetch ? { fetch } : {}) } });
    const response = await client.models.generateContent({ model: GEMINI_MODEL, contents: JSON.stringify(context),
      config: { systemInstruction: instructions, responseMimeType: "application/json", responseJsonSchema,
        abortSignal: signal, maxOutputTokens: 24000 } });
    return response.text ?? "";
  };
}
export const officialGeminiTransport: OpenAITransport = (context, signal) =>
  createGeminiTransport(process.env.GEMINI_API_KEY!)(context, signal);

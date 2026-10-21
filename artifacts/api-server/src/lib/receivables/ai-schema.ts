import { z } from "zod/v4";

const prose = z.string().trim().min(15).max(2000);
export const adviceSchema = z.object({
  taskId: z.string().min(1).max(100),
  reasoning: prose,
  assumptions: z.array(prose).min(1).max(5),
  uncertainties: z.array(prose).min(1).max(5),
  esgEvidence: z.enum(["verified", "unknown"]),
  esgRating: z.enum(["A", "B", "C", "unknown"]),
  esgConsiderations: prose,
  strategies: z.array(z.object({
    kind: z.enum(["payment_full", "installments", "extension"]),
    proposal: prose,
    conditions: prose,
  }).strict()).length(3),
  noticeEn: z.string().trim().min(60).max(4000),
  noticeMs: z.string().trim().min(60).max(4000),
}).strict();

export const responseSchema = z.object({
  riskExplanation: z.string().trim().min(30).max(3000),
  tasks: z.array(adviceSchema).min(1).max(50),
}).strict();
export type AdviceResponse = z.infer<typeof responseSchema>;
// Local validation retains every original bound. Wire schema uses the OpenAI
// strict subset; unsupported length bounds stay enforced locally, never skipped.
export const responseJsonSchema = z.toJSONSchema(responseSchema);
function strictWireSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strictWireSchema);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !["$schema", "minLength", "maxLength", "minItems", "maxItems"].includes(key))
      .map(([key, child]) => [key, strictWireSchema(child)]));
  }
  return value;
}
export const openaiJsonSchema = strictWireSchema(responseJsonSchema) as Record<string, unknown>;

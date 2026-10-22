import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { CorrespondenceIntakeGroup, CorrespondenceLineSpan } from "@workspace/api-zod";
import { BusinessError } from "./model";

export interface RoutingCompany { id: string; name: string; collectionEmail?: string | null }
const segmentSchema = z.object({
  segments: z.array(z.object({
    startLine: z.number().int().min(1), endLine: z.number().int().min(1),
    companyId: z.string().nullable(),
  }).strict()).min(1).max(500),
}).strict();
export const companyRoutingJsonSchema = {
  type: "object", additionalProperties: false, required: ["segments"],
  properties: { segments: { type: "array", items: {
    type: "object", additionalProperties: false, required: ["startLine", "endLine", "companyId"],
    properties: { startLine: { type: "integer" }, endLine: { type: "integer" },
      companyId: { anyOf: [{ type: "string" }, { type: "null" }] } },
  } } },
};
type Segment = z.infer<typeof segmentSchema>["segments"][number];
export const textHash = (text: string) => createHash("sha256").update(text).digest("hex");
export const rosterSignature = (companies: RoutingCompany[]) => textHash(JSON.stringify(
  companies.map(company => [company.id, company.name, company.collectionEmail ?? ""]).sort((a, b) => a[0]!.localeCompare(b[0]!))));

export function splitIntakeLines(text: string) {
  let count = 1;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n" || text[index] === "\r") {
      if (text[index] === "\r" && text[index + 1] === "\n") index++;
      if (++count > 50_000) throw new BusinessError("Upload has too many lines. Split it into files with at most 50,000 lines.", 413);
    }
  }
  return text.split(/\r\n|\n|\r/);
}
export const groupSourceText = (lines: string[], spans: CorrespondenceLineSpan[]) =>
  spans.map(span => lines.slice(span.startLine - 1, span.endLine).join("\n")).join("\n");

function identifierPatterns(companies: RoutingCompany[]) {
  return companies.map(company => ({
    id: company.id,
    expressions: [company.id, company.name, company.collectionEmail].filter((value): value is string => !!value?.trim())
      .map(value => {
        const boundary = value.includes("@") ? "[^\\p{L}\\p{N}_@.+-]" : "[^\\p{L}\\p{N}_]";
        return new RegExp(`(^|${boundary})${value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?=$|${boundary})`, "iu");
      }),
  }));
}
function lineOwners(lines: string[], companies: RoutingCompany[]) {
  const patterns = identifierPatterns(companies);
  return lines.map(line => patterns.filter(company => company.expressions.some(expression => expression.test(line))).map(company => company.id));
}

export function buildRoutingGroups(lines: string[], companies: RoutingCompany[], segments: Segment[]): CorrespondenceIntakeGroup[] {
  const ids = new Set(companies.map(company => company.id));
  const owners = lineOwners(lines, companies);
  let nextLine = 1;
  const groups: CorrespondenceIntakeGroup[] = [];
  const matched = new Map<string, CorrespondenceIntakeGroup>();
  for (const segment of segments) {
    if (segment.startLine !== nextLine || segment.endLine < segment.startLine || segment.endLine > lines.length ||
      (segment.companyId !== null && !ids.has(segment.companyId))) throw new Error("Routing omitted, overlapped or invented source lines or companies");
    nextLine = segment.endLine + 1;
    const span = { startLine: segment.startLine, endLine: segment.endLine };
    const text = groupSourceText(lines, [span]);
    if (!text.trim()) continue;
    const evidence = new Set(owners.slice(span.startLine - 1, span.endLine).flat());
    // A model suggestion alone is never sufficient to silently file customer data.
    const unknownId = [...text.matchAll(/\bCUS-\d+\b/gi)].some(match => !companies.some(company => company.id.toLowerCase() === match[0].toLowerCase()));
    const contradictoryHeading = lines.slice(span.startLine - 1, span.endLine).some((line, index) =>
      /^\s*(?:company(?:\s+name)?|customer\s+company|client\s+company)\s*[:=]\s*\S/i.test(line) && !owners[span.startLine - 1 + index]!.length);
    const conflicting = evidence.size > 1 || ((unknownId || contradictoryHeading) && evidence.size > 0);
    const companyId = !conflicting && evidence.size === 1 && segment.companyId !== null &&
      evidence.has(segment.companyId) ? segment.companyId : null;
    const resolution = conflicting ? "conflicting" : companyId ? "matched" : "needs_confirmation";
    const existing = companyId ? matched.get(companyId) : undefined;
    if (existing) { existing.spans.push(span); continue; }
    const group: CorrespondenceIntakeGroup = {
      id: `GROUP-${groups.length + 1}`, resolution, companyId,
      suggestedCompanyId: conflicting ? null : segment.companyId,
      reason: conflicting ? "Multiple or contradictory company identifiers. Split this section and identify it again."
        : companyId ? "Company matched to an explicit company name, ID or collection email in the source."
        : "Company identity is not explicit or could not be verified. Confirm an existing company before archiving.",
      spans: [span],
    };
    groups.push(group);
    if (companyId) matched.set(companyId, group);
  }
  if (nextLine !== lines.length + 1 || !groups.length) throw new Error("Routing does not cover the source");
  if (groups.length > 100) throw new BusinessError("Too many unresolved sections. Split the file into smaller uploads.");
  return groups;
}

export function validateCompanyRouting(raw: string, lines: string[], companies: RoutingCompany[]) {
  if (raw.length > 100_000 || raw.includes("\ufffd")) throw new Error("Invalid routing response");
  return buildRoutingGroups(lines, companies, segmentSchema.parse(JSON.parse(raw)).segments);
}

export function rulesCompanyRouting(lines: string[], companies: RoutingCompany[]) {
  const owners = lineOwners(lines, companies);
  const segments: Segment[] = [];
  for (let index = 0; index < lines.length; index++) {
    // Do not infer that an unlabeled message belongs to a preceding customer.
    const companyId = owners[index]!.length === 1 ? owners[index]![0]! : null;
    const last = segments.at(-1);
    if (last && last.companyId === companyId) last.endLine = index + 1;
    else segments.push({ startLine: index + 1, endLine: index + 1, companyId });
  }
  return buildRoutingGroups(lines, companies, segments);
}

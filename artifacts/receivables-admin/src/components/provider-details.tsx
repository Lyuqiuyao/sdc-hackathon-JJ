import type { CollectionPlan } from '@workspace/api-client-react';
import { Tag } from '@/components/kit';
import { fmtDateTime } from '@/lib/arus';

const REASONS: Record<string, string> = {
  missing_api_key: 'Server key missing; bilingual rule templates used.',
  missing_managed_config: 'Replit managed configuration unavailable; bilingual rule templates used. No private-key fallback.',
  rules_selected: 'Rules mode selected; no model request.',
  pending_generation: 'Model generation not completed; rules templates remain available.',
  timeout: 'Model request timed out; rules templates used.',
  invalid_response: 'Response failed schema or evidence checks; rules templates used.',
  api_error: 'Model request failed; rules templates used.',
  context_limit: 'Plan exceeds the 50-task AI request limit; rules templates used.',
  validated_response: 'Model response validated; deterministic scores/ranks unchanged.',
  legacy_provider_retired: 'Gemini mode is retired. Select and save OpenAI or Rules in Settings.',
  missing_risk: 'Risk event missing; no model request was issued.',
  missing_invoice: 'Invoice missing; no model request was issued.',
  missing_customer: 'Customer missing; no model request was issued.',
  empty_tasks: 'No tasks; no model request was issued.',
  duplicate_task_id: 'Duplicate task identifiers; no model request was issued.',
  duplicate_invoice: 'Duplicate invoice tasks; no model request was issued.',
  invalid_association: 'Invalid task association; no model request was issued.',
  invalid_business_data: 'Invalid amount, currency, date or business data; no model request was issued.',
  stale_context: 'Plan or risk snapshot is stale; recalculate before generation.',
  plan_not_pending: 'This plan is not pending; no model request was issued.',
  plan_superseded: 'A newer version exists; no model request was issued.',
  human_modified: 'Human changes are protected; no model request was issued.',
  unsafe_content: 'Response failed content-safety checks; server rule templates retained.',
  missing_plan: 'Plan version is missing from the workspace; no model request was issued.',
};

export function ProviderDetails({ plan }: { plan: CollectionPlan }) {
  const provider = plan.providerMode ?? 'rules_fallback';
  const generation = plan.aiGeneration;
  return <div className="space-y-2 text-xs" data-testid="plan-provider-details">
    <div className="flex flex-wrap items-center gap-2">
      <Tag tone={provider === 'openai' || provider === 'gemini' ? 'green' : 'orange'}>{provider === 'gemini' ? 'gemini (historical)' : provider}</Tag>
      {generation ? <span>{generation.status} · {generation.model || 'No LLM'} · {fmtDateTime(generation.generatedAt)} · {generation.durationMs} ms</span>
        : <span>Legacy rules/template plan; not model output.</span>}
      {generation?.requestedProvider === 'openai' && <span>{generation.connectionMode === 'replit_managed'
        ? 'OpenAI (Replit managed)' : 'Historical OpenAI · connection unrecorded'}</span>}
    </div>
    {generation && <p className="text-muted-foreground">{REASONS[generation.reasonCode] ?? generation.reasonCode}</p>}
    {plan.aiRiskExplanation && <div><strong>{provider === 'gemini' ? 'Historical Gemini' : generation?.contentPolicy === 'server_controlled_v1' && plan.tasks.some(t => t.aiAdvice?.esgEvidence === 'unknown') ? 'Server-controlled' : 'OpenAI'} risk explanation</strong><p className="mt-1 whitespace-pre-wrap">{plan.aiRiskExplanation}</p></div>}
    {generation?.contentPolicy === 'server_controlled_v1' && <p className="text-muted-foreground">Server-controlled notices and ESG prose. Unknown ESG task prose and its global risk explanation are also server-controlled, not model-authored credit opinions.</p>}
    <p className="text-muted-foreground">Provider describes the original generation. Historical sources remain unchanged. Later human edits have per-language sources. AI never approves or executes.</p>
  </div>;
}

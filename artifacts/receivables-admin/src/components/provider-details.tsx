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
    {plan.aiRiskExplanation && <div><strong>{provider === 'gemini' ? 'Historical Gemini' : 'OpenAI'} risk explanation · 风险归因：</strong><p className="mt-1 whitespace-pre-wrap">{plan.aiRiskExplanation}</p></div>}
    <p className="text-muted-foreground">Provider describes original recommendations. Drafts may include later human edits; each language shows its own source. AI never approves or executes.</p>
  </div>;
}

import assert from "node:assert/strict";
import { seedState } from "../src/lib/receivables/seed";
import { generateAdvice, openaiConfigured } from "../src/lib/receivables/ai-provider";
import { workspace, generate } from "../src/lib/receivables/service";

globalThis.fetch = async () => { throw new Error("Network prohibited in startup probe"); };
// The parent supplies ONLY synthetic values; no real credentials are inherited.
assert.equal(openaiConfigured(),false);
const state=seedState(),plan=state.plans[0]!;
assert.equal(workspace(state).aiAvailable,false);
assert.equal((await generateAdvice(state,plan)).generation.reasonCode,"rules_selected");
state.settings.aiMode="openai";
assert.equal((await generateAdvice(state,plan)).generation.reasonCode,"missing_managed_config");
// Simulate configuration disappearing after a check but before lazy import.
assert.equal((await generateAdvice(state,generate(state,{}),{configured:true})).generation.reasonCode,"api_error");
state.settings.aiMode="rules";
assert.equal((await generateAdvice(state,plan)).generation.reasonCode,"rules_selected");
console.log(JSON.stringify({result:"PASS",applicationModulesLoad:true,initializationFailureContained:true,rulesUsable:true}));

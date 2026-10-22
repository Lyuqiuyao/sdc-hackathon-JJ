import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  GetWorkspaceResponse, DemoLoginResponse, RunRiskCheckResponse, GeneratePlanBody, GeneratePlanResponse,
  EditPlanParams, EditPlanBody, EditPlanResponse, DecidePlanParams, DecidePlanBody, DecidePlanResponse,
  ExecutePlanParams, ExecutePlanResponse, SaveSettingsBody, SaveSettingsResponse, ImportInvoicesBody,
  ImportInvoicesResponse, ViewDocumentParams, ViewDocumentResponse, ResetDemoBody, ResetDemoResponse,
} from "@workspace/api-zod";
import { readState, changeState } from "../lib/receivables/repository";
import { BusinessError } from "../lib/receivables/model";
import * as service from "../lib/receivables/service";
import { enrichPlan, enrichRiskDraft } from "../lib/receivables/ai-generation";
import { listAdviceSnapshots } from "../lib/receivables/advice-snapshots";
import { GetPlanAdviceSnapshotsParams, GetPlanAdviceSnapshotsResponse } from "@workspace/api-zod";
import { SaveCompanyProfileParams, SaveCompanyProfileBody, SaveCompanyProfileResponse,
  SubmitSedgParams, SubmitSedgBody, SubmitSedgResponse } from "@workspace/api-zod";
import { saveProfile, submitSedg } from "../lib/receivables/company";
import { GetCompanyCorrespondenceParams, GetCompanyCorrespondenceResponse,
  UploadCompanyCorrespondenceParams, UploadCompanyCorrespondenceResponse } from "@workspace/api-zod";
import { appendCorrespondence, listCorrespondence } from "../lib/receivables/correspondence";
import { executeWithSmtpSwitch } from "../lib/receivables/smtp-execution";
import { AnalyzeCompanyCorrespondenceParams, AnalyzeCompanyCorrespondenceResponse } from "@workspace/api-zod";
import { analyzeCompanyRecord } from "../lib/receivables/correspondence-analysis";

const router: IRouter = Router();
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.post("/company/:id/correspondence/:recordId/analyze", async (req, res): Promise<void> => {
  const { id, recordId } = AnalyzeCompanyCorrespondenceParams.parse(req.params);
  res.json(AnalyzeCompanyCorrespondenceResponse.parse(await analyzeCompanyRecord(id, recordId)));
});
router.get("/company/:id/correspondence", async (req, res): Promise<void> => {
  const { id } = GetCompanyCorrespondenceParams.parse(req.params);
  res.json(GetCompanyCorrespondenceResponse.parse(listCorrespondence(await readState(), id)));
});
router.post("/company/:id/correspondence", async (req, res): Promise<void> => {
  const { id } = UploadCompanyCorrespondenceParams.parse(req.params);
  res.status(201).json(await changeState(state =>
    UploadCompanyCorrespondenceResponse.parse(appendCorrespondence(state, id, req.body))));
});
router.put("/customers/:id/profile", async (req, res): Promise<void> => {
  const { id } = SaveCompanyProfileParams.parse(req.params), input = SaveCompanyProfileBody.parse(req.body);
  res.json(await changeState(state => SaveCompanyProfileResponse.parse(saveProfile(state, id, input))));
});
router.post("/customers/:id/sedg", async (req, res): Promise<void> => {
  const { id } = SubmitSedgParams.parse(req.params), input = SubmitSedgBody.parse(req.body);
  res.json(await changeState(state => SubmitSedgResponse.parse(submitSedg(state, id, input))));
});

router.get("/workspace", async (_req, res): Promise<void> => {
  res.json(GetWorkspaceResponse.parse(service.workspace(await readState())));
});
router.post("/demo-login", async (_req, res): Promise<void> => {
  res.json(await changeState(state => {
    service.audit(state, "Demo login", "Entered the shared Demo Admin sandbox. This is a demo role entry, not production identity authentication.");
    return DemoLoginResponse.parse({ message: "Demo Admin entered. This is not production authentication." });
  }));
});
router.post("/risk-checks", async (_req, res): Promise<void> => {
  const event = await changeState(state => RunRiskCheckResponse.parse(service.riskCheck(state)));
  await enrichRiskDraft(event.id);
  res.json(event);
});
router.post("/plans", async (req, res): Promise<void> => {
  const input = GeneratePlanBody.parse(req.body);
  const plan = await changeState(state => GeneratePlanResponse.parse(service.generate(state, input)));
  res.json(GeneratePlanResponse.parse(await enrichPlan(plan.id)));
});
router.patch("/plans/:id", async (req, res): Promise<void> => {
  const { id } = EditPlanParams.parse(req.params), input = EditPlanBody.parse(req.body);
  res.json(await changeState(state => EditPlanResponse.parse(service.edit(state, id, input))));
});
router.get("/plans/:id/advice-snapshots", async (req, res): Promise<void> => {
  const { id } = GetPlanAdviceSnapshotsParams.parse(req.params);
  res.json(GetPlanAdviceSnapshotsResponse.parse(listAdviceSnapshots(await readState(), id)));
});
router.post("/plans/:id/decision", async (req, res): Promise<void> => {
  const { id } = DecidePlanParams.parse(req.params), input = DecidePlanBody.parse(req.body);
  const plan = await changeState(state => DecidePlanResponse.parse(service.decide(state, id, input)));
  res.json(DecidePlanResponse.parse(input.decision === "defer" ? await enrichPlan(plan.id) : plan));
});
router.post("/plans/:id/execute", async (req, res): Promise<void> => {
  const { id } = ExecutePlanParams.parse(req.params);
  res.json(ExecutePlanResponse.parse(await executeWithSmtpSwitch(id)));
});
router.put("/settings", async (req, res): Promise<void> => {
  const input = SaveSettingsBody.parse(req.body);
  res.json(await changeState(state => SaveSettingsResponse.parse(service.settings(state, input))));
});
router.post("/imports", async (req, res): Promise<void> => {
  const input = ImportInvoicesBody.parse(req.body);
  res.json(await changeState(state => ImportInvoicesResponse.parse(service.importData(state, input))));
});
router.post("/documents/:id/view", async (req, res): Promise<void> => {
  const { id } = ViewDocumentParams.parse(req.params);
  res.json(await changeState(state => ViewDocumentResponse.parse(service.documentView(state, id))));
});
router.post("/demo-reset", async (req, res): Promise<void> => {
  const input = ResetDemoBody.parse(req.body);
  res.json(await changeState(state => ResetDemoResponse.parse(service.reset(state, input.confirm))));
});
router.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof BusinessError) {
    res.status(error.status).json({ error: error.message });
  } else if (error.name === "ZodError") {
    res.status(400).json({ error: "Validation failed. Check required fields, value types and allowed lengths." });
  } else {
    req.log.error({ err: error }, "Receivables operation failed");
    res.status(500).json({ error: "Operation failed. No incomplete business change was committed. Check server logs." });
  }
});
export default router;

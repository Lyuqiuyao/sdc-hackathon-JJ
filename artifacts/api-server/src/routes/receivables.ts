import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  GetWorkspaceResponse, DemoLoginResponse, RunRiskCheckResponse, GeneratePlanBody, GeneratePlanResponse,
  EditPlanParams, EditPlanBody, EditPlanResponse, DecidePlanParams, DecidePlanBody, DecidePlanResponse,
  ExecutePlanParams, ExecutePlanBody, ExecutePlanResponse, SaveSettingsBody, SaveSettingsResponse, ImportInvoicesBody,
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
import { saveProfile, submitSedg, auditedCompanyChange } from "../lib/receivables/company";
import { GetCompanyCorrespondenceParams, GetCompanyCorrespondenceResponse,
  UploadCompanyCorrespondenceParams, UploadCompanyCorrespondenceResponse } from "@workspace/api-zod";
import { correspondenceMetadata, correspondenceDetail, uploadCorrespondence } from "../lib/receivables/correspondence";
import { executeWithSmtpSwitch } from "../lib/receivables/smtp-execution";
import { AnalyzeCompanyCorrespondenceParams, AnalyzeCompanyCorrespondenceResponse } from "@workspace/api-zod";
import { analyzeCompanyRecord } from "../lib/receivables/correspondence-analysis";
import { GenerateCompanyPortraitParams, GenerateCompanyPortraitResponse } from "@workspace/api-zod";
import { generatePortrait } from "../lib/receivables/company-portrait";
import { GetCompanyCorrespondenceRecordParams, GetCompanyCorrespondenceRecordResponse, GetExecutionModeResponse } from "@workspace/api-zod";
import { smtpEnabled } from "../lib/receivables/smtp-config";
import { generateReviewedCustomerNotices } from "../lib/receivables/notice-generation";
import { planRecipients } from "../lib/receivables/email-recipients";
import { GetPlanRecipientsParams, GetPlanRecipientsResponse } from "@workspace/api-zod";
import { ArchiveCorrespondenceGroupParams } from "@workspace/api-zod";
import { identifyCorrespondence, archiveCorrespondenceGroup } from "../lib/receivables/correspondence-intake";
import { ApprovePlanCustomerParams, ApprovePlanCustomerBody, ApprovePlanCustomerResponse } from "@workspace/api-zod";
import { approveCustomerDispatch } from "../lib/receivables/customer-dispatch";

const router: IRouter = Router();
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.post("/correspondence/intakes", async (req, res): Promise<void> => {
  res.json(await identifyCorrespondence(req.body));
});
router.post("/correspondence/intakes/:id/archive", async (req, res): Promise<void> => {
  const { id } = ArchiveCorrespondenceGroupParams.parse(req.params);
  res.json(await archiveCorrespondenceGroup(id, req.body));
});
router.get("/execution-mode", (_req, res): void => {
  res.json(GetExecutionModeResponse.parse({ smtpEnabled: smtpEnabled() }));
});
router.post("/company/:id/portrait", async (req, res): Promise<void> => {
  const { id } = GenerateCompanyPortraitParams.parse(req.params);
  res.json(GenerateCompanyPortraitResponse.parse(await generatePortrait(id)));
});
router.post("/company/:id/correspondence/:recordId/analyze", async (req, res): Promise<void> => {
  const { id, recordId } = AnalyzeCompanyCorrespondenceParams.parse(req.params);
  res.json(AnalyzeCompanyCorrespondenceResponse.parse(await analyzeCompanyRecord(id, recordId)));
});
router.get("/company/:id/correspondence", async (req, res): Promise<void> => {
  const { id } = GetCompanyCorrespondenceParams.parse(req.params);
  res.json(GetCompanyCorrespondenceResponse.parse(await correspondenceMetadata(id)));
});
router.get("/company/:id/correspondence/:recordId", async (req, res): Promise<void> => {
  const { id, recordId } = GetCompanyCorrespondenceRecordParams.parse(req.params);
  res.json(GetCompanyCorrespondenceRecordResponse.parse(await correspondenceDetail(id, recordId)));
});
router.post("/company/:id/correspondence", async (req, res): Promise<void> => {
  const { id } = UploadCompanyCorrespondenceParams.parse(req.params);
  res.status(201).json(UploadCompanyCorrespondenceResponse.parse(await uploadCorrespondence(id, req.body)));
});
router.put("/customers/:id/profile", async (req, res): Promise<void> => {
  const { id } = SaveCompanyProfileParams.parse(req.params);
  res.json(await auditedCompanyChange(id, "Company information", state =>
    SaveCompanyProfileResponse.parse(saveProfile(state, id, SaveCompanyProfileBody.parse(req.body)))));
});
router.post("/customers/:id/sedg", async (req, res): Promise<void> => {
  const { id } = SubmitSedgParams.parse(req.params);
  res.json(await auditedCompanyChange(id, "SEDG submission", state =>
    SubmitSedgResponse.parse(submitSedg(state, id, SubmitSedgBody.parse(req.body)))));
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
  const plan = await changeState(state => EditPlanResponse.parse(service.edit(state, id, input)));
  res.json(EditPlanResponse.parse(input.customerReview
    ? await generateReviewedCustomerNotices(plan.id, input.customerReview.customerId) : plan));
});
router.post("/plans/:id/customers/:customerId/approval", async (req, res): Promise<void> => {
  const { id, customerId } = ApprovePlanCustomerParams.parse(req.params);
  const input = ApprovePlanCustomerBody.parse(req.body);
  const result = await changeState(state => {
    try {
      const candidate = structuredClone(state);
      const plan = approveCustomerDispatch(candidate, id, customerId, input.expectedVersion);
      Object.assign(state, candidate);
      return { plan };
    }
    catch (error) {
      // Discard any tentative batch/approval before persisting the rejection audit.
      if (!(error instanceof BusinessError)) throw error;
      service.audit(state, "Customer approval rejected", error.message, customerId, id, "", undefined, { result: "Rejected" });
      return { error: error.message, status: error.status };
    }
  });
  if ("error" in result) throw new BusinessError(result.error!, result.status);
  res.json(ApprovePlanCustomerResponse.parse(result.plan));
});
router.get("/plans/:id/recipients", async (req, res): Promise<void> => {
  const { id } = GetPlanRecipientsParams.parse(req.params);
  const state = await readState();
  res.set("Cache-Control", "no-store").json(GetPlanRecipientsResponse.parse(planRecipients(state, service.findPlan(state, id))));
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
  const input = ExecutePlanBody.parse(req.body ?? {});
  res.json(ExecutePlanResponse.parse(await executeWithSmtpSwitch(id, input.expectedSmtpEnabled, input.expectedRecipientsSignature)));
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

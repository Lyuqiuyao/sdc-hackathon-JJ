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

const router: IRouter = Router();
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

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
  res.json(await changeState(state => RunRiskCheckResponse.parse(service.riskCheck(state))));
});
router.post("/plans", async (req, res): Promise<void> => {
  const input = GeneratePlanBody.parse(req.body);
  res.json(await changeState(state => GeneratePlanResponse.parse(service.generate(state, input))));
});
router.patch("/plans/:id", async (req, res): Promise<void> => {
  const { id } = EditPlanParams.parse(req.params), input = EditPlanBody.parse(req.body);
  res.json(await changeState(state => EditPlanResponse.parse(service.edit(state, id, input))));
});
router.post("/plans/:id/decision", async (req, res): Promise<void> => {
  const { id } = DecidePlanParams.parse(req.params), input = DecidePlanBody.parse(req.body);
  res.json(await changeState(state => DecidePlanResponse.parse(service.decide(state, id, input))));
});
router.post("/plans/:id/execute", async (req, res): Promise<void> => {
  const { id } = ExecutePlanParams.parse(req.params);
  res.json(await changeState(state => ExecutePlanResponse.parse(service.execute(state, id))));
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
    res.status(400).json({ error: `Validation failed: ${error.message}` });
  } else {
    req.log.error({ err: error }, "Receivables operation failed");
    res.status(500).json({ error: "Operation failed. No incomplete business change was committed. Check server logs." });
  }
});
export default router;

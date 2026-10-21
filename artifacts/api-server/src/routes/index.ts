import { Router, type IRouter } from "express";
import healthRouter from "./health";
import receivablesRouter from "./receivables";

const router: IRouter = Router();

router.use(healthRouter);
router.use(receivablesRouter);

export default router;

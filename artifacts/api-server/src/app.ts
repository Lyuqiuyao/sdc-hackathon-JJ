import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { recordUploadFailure } from "./lib/receivables/correspondence";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Route-scoped allowance for JSON escaping of up to 10 MiB of raw text.
// All other routes retain their existing 2 MiB limit.
app.use("/api/company/:id/correspondence", express.json({ limit: "64mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use(async (error: Error & { type?: string }, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const uploadPath = req.path.match(/^\/api\/company\/([^/]+)\/correspondence\/?$/);
  if (req.method === "POST" && uploadPath && ["entity.too.large", "entity.parse.failed"].includes(error.type ?? "")) {
    try {
      await recordUploadFailure(uploadPath[1]!, error.type === "entity.too.large"
        ? "Upload request body exceeded the parser limit." : "Upload request contained invalid JSON.");
    } catch {
      res.status(503).json({ error: "Upload rejected, but its failure audit could not be saved. No upload was accepted." });
      return;
    }
  }
  if (error.type === "entity.too.large") {
    res.status(413).json({ error: "Request body exceeds the upload limit." });
  } else if (error.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON request body." });
  } else {
    next(error);
  }
});

export default app;

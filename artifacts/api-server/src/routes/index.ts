import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";

const router: IRouter = Router();

// Теперь все пути будут работать:
// /api/healthz (из health.ts)
// /api/auth/discord (из auth.ts)
// /api/auth/me (из auth.ts) и т.д.

router.use(healthRouter);
router.use("/auth", authRouter);

export default router;

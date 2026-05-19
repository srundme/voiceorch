import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import agentsRouter from "./agents.js";
import callsRouter from "./calls.js";
import providersRouter from "./providers.js";
import analyticsRouter from "./analytics.js";
import webhooksRouter from "./webhooks.js";
import widgetRouter from "./widget.js";
import knowledgeBaseRouter from "./knowledge-base.js";
import walletRouter from "./wallet.js";
import accountRouter from "./account.js";
import activityLogsRouter from "./activity-logs.js";
import phoneNumbersRouter from "./phone-numbers.js";
import { provisionUser } from "../middlewares/userProvisioning.js";

const router: IRouter = Router();

router.use(provisionUser);
router.use(healthRouter);
router.use(agentsRouter);
router.use(callsRouter);
router.use(providersRouter);
router.use(analyticsRouter);
router.use(webhooksRouter);
router.use(widgetRouter);
router.use(knowledgeBaseRouter);
router.use(walletRouter);
router.use(accountRouter);
router.use(activityLogsRouter);
router.use(phoneNumbersRouter);

export default router;

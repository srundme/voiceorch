import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import storageRouter from "./storage.js";
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
import webhookEndpointsRouter from "./webhook-endpoints.js";
import agentTemplatesRouter from "./agent-templates.js";
import onboardingRouter from "./onboarding.js";
import adminRouter from "./admin.js";
import adminVoicesRouter from "./admin-voices.js";
import wizardRouter from "./wizard.js";
import campaignsRouter from "./campaigns.js";
import campaignWebhookRouter from "./campaign-webhook.js";
import schedulingRouter from "./scheduling/index.js";
import kycRouter from "./kyc.js";
import { provisionUser } from "../middlewares/userProvisioning.js";

const router: IRouter = Router();

// Admin routes bypass user provisioning middleware
router.use(adminRouter);
router.use(adminVoicesRouter);

// Public campaign lead webhook — must be before provisionUser (no Clerk session needed)
router.use(campaignWebhookRouter);

router.use(storageRouter);
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
router.use(webhookEndpointsRouter);
router.use(agentTemplatesRouter);
router.use(onboardingRouter);
router.use(wizardRouter);
router.use(campaignsRouter);
router.use(schedulingRouter);
router.use(kycRouter);

export default router;

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
import adminUsageRouter from "./admin-usage.js";
import adminPromptTemplatesRouter from "./admin-prompt-templates.js";
import ambientSoundsRouter, { ambientSoundsUserRouter } from "./ambient-sounds.js";
import wizardRouter from "./wizard.js";
import campaignsRouter from "./campaigns.js";
import campaignBatchesRouter from "./campaign-batches.js";
import campaignWebhookRouter from "./campaign-webhook.js";
import campaignLeadsRouter from "./campaign-leads.js";
import campaignAnalyticsRouter from "./campaign-analytics.js";
import campaignOpsRouter from "./campaign-ops.js";
import agentVariablesRouter from "./agent-variables.js";
import batchImportRunsRouter from "./batch-import-runs.js";
import schedulingRouter from "./scheduling/index.js";
import kycRouter from "./kyc.js";
import assistantRouter from "./assistant.js";
import usageMeRouter from "./usage-me.js";
import userApiKeysRouter from "./user-api-keys.js";
import metaRouter from "./meta.js";
import callTransfersRouter from "./call-transfers.js";
import billingRouter from "./billing.js";
import utilsRouter from "./utils.js";
import webcallNotifyRouter from "./webcall-notify.js";
import voicesRouter from "./voices.js";
import testToolRouter from "./test-tool.js";
import { provisionUser } from "../middlewares/userProvisioning.js";

const router: IRouter = Router();

// Admin routes bypass user provisioning middleware
router.use(adminRouter);
router.use(adminVoicesRouter);
router.use(adminUsageRouter);
router.use(adminPromptTemplatesRouter);
router.use(ambientSoundsRouter);

// Public campaign lead webhook — must be before provisionUser (no Clerk session needed)
router.use(campaignWebhookRouter);

// Public utility routes — no auth required
router.use(voicesRouter);
router.use(utilsRouter);

router.use(storageRouter);
router.use(provisionUser);
router.use(ambientSoundsUserRouter);
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
router.use(campaignBatchesRouter);
router.use(campaignLeadsRouter);
router.use(campaignAnalyticsRouter);
router.use(campaignOpsRouter);
router.use(agentVariablesRouter);
router.use(batchImportRunsRouter);
router.use(schedulingRouter);
router.use(kycRouter);
router.use(assistantRouter);
router.use(usageMeRouter);
router.use(userApiKeysRouter);
router.use(metaRouter);
router.use(callTransfersRouter);
router.use(billingRouter);
router.use(webcallNotifyRouter);
router.use(testToolRouter);

export default router;

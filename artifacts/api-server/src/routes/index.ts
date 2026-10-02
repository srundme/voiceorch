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
import adminSystemPromptTemplatesRouter from "./admin-system-prompt-templates.js";
import adminUserMgmtRouter from "./admin-user-mgmt.js";
import adminPartnersRouter from "./admin-partners.js";
import adminDeploymentsRouter from "./admin-deployments.js";
import adminGenderServiceRouter from "./admin-gender-service.js";
import adminWhatsappRouter from "./admin-whatsapp.js";
import whatsappNativeRouter from "./whatsapp-native.js";
import whatsappExtrasRouter from "./whatsapp-extras.js";
import partnerRouter from "./partner.js";
import partnerPublicRouter from "./partner-public.js";
import adminEmailsRouter from "./admin-emails.js";
import adminFinanceAnalyticsRouter from "./admin-finance-analytics.js";
import adminBoardAnalyticsRouter from "./admin-board-analytics.js";
import adminCallAnalyticsRouter from "./admin-call-analytics.js";
import adminV2AnalyticsRouter from "./admin-v2-analytics.js";
import adminV2SaasRouter from "./admin-v2-saas.js";
import adminCostPricingRouter from "./admin-cost-pricing.js";
import adminManagedInfraRouter from "./admin-managed-infra.js";
import adminV2CustomersRouter from "./admin-v2-customers.js";
import adminV2OperationsRouter from "./admin-v2-operations.js";
import adminV2ProductRouter from "./admin-v2-product.js";
import adminV2VoiceRouter from "./admin-v2-voice.js";
import adminV2RevenueRouter from "./admin-v2-revenue.js";
import ambientSoundsRouter, { ambientSoundsUserRouter } from "./ambient-sounds.js";
import wizardRouter from "./wizard.js";
import vibeRouter from "./vibe.js";
import vibeSessionsRouter from "./vibe-sessions.js";
import agentTasksRouter from "./agent-tasks.js";
import campaignsRouter from "./campaigns.js";
import campaignDashboardRouter from "./campaign-dashboard.js";
import campaignBatchesRouter from "./campaign-batches.js";
import campaignWebhookRouter from "./campaign-webhook.js";
import landingLeadsRouter from "./landing-leads.js";
import campaignLeadsRouter from "./campaign-leads.js";
import campaignAnalyticsRouter from "./campaign-analytics.js";
import campaignLeadReportingRouter from "./campaign-lead-reporting.js";
import campaignReportsRouter from "./campaign-reports.js";
import campaignOpsRouter from "./campaign-ops.js";
import commandCenterRouter from "./command-center.js";
import liveQueueRouter from "./live-queue.js";
import campaignCallbacksRouter from "./campaign-callbacks.js";
import campaignIncomingRouter from "./campaign-incoming.js";
import campaignBookingsRouter from "./campaign-bookings.js";
import campaignTransfersRouter from "./campaign-transfers.js";
import batchWorkspaceRouter from "./batch-workspace.js";
import leadWorkspaceRouter from "./lead-workspace.js";
import platformAnalyticsRouter from "./platform-analytics.js";
import searchRouter from "./search.js";
import agentVariablesRouter from "./agent-variables.js";
import agentVersionsRouter from "./agent-versions.js";

import batchImportRunsRouter from "./batch-import-runs.js";
import schedulingRouter from "./scheduling/index.js";
import kycRouter from "./kyc.js";
import assistantRouter from "./assistant.js";
import usageMeRouter from "./usage-me.js";
import userApiKeysRouter from "./user-api-keys.js";
import teamRouter from "./team.js";
import metaRouter from "./meta.js";
import callTransfersRouter from "./call-transfers.js";
import billingRouter from "./billing.js";
import utilsRouter from "./utils.js";
import voicesRouter from "./voices.js";
import geminiLiveRouter from "./gemini-live.js";
import openaiRealtimeRouter from "./openai-realtime.js";
import testToolRouter from "./test-tool.js";
import authRouter from "./auth.js";
import dispositionRouter from "./disposition.js";
import docsRouter from "./docs.js";
import callbacksRouter from "./callbacks.js";
import connectionsRouter from "./connections.js";
import crmRouter from "./crm.js";
import bookRouter from "./book.js";
import workshopRouter from "./workshop.js";
import voiceathonPublicRouter from "./voiceathon-public.js";
import voiceathonEventsRouter from "./voiceathon-events.js";
import adminEventFeedbackRouter from "./admin-event-feedback.js";
import adminVoiceathonRouter from "./admin-voiceathon.js";
import adminTeamGuidesRouter from "./admin-team-guides.js";
import workflowsRouter from "./workflows.js";
import workflowsPublicRouter from "./workflows-public.js";
import journeysRouter from "./journeys.js";
import emailChannelsRouter from "./email-channels.js";
import sheetsRouter from "./sheets.js";
import sheetAutoCallsRouter from "./sheet-auto-calls.js";
import squadsRouter from "./squads.js";
import whatsappRouter from "./whatsapp.js";
import webcallLinksRouter from "./webcall-links.js";
import meetBotsRouter from "./meet-bots.js";
import meetCalendarRouter from "./meet-calendar.js";
import mcpRouter from "./mcp.js";
import { provisionUser } from "../middlewares/userProvisioning.js";

const router: IRouter = Router();

// Admin routes bypass user provisioning middleware.
// ambient-sounds audio endpoint must be mounted BEFORE adminRouter because it
// has its own query-token auth (for <audio src="...?token=...">), whereas
// adminRouter applies a blanket requireAdmin middleware on /admin that only
// looks at the x-admin-token header.
router.use(ambientSoundsRouter);
router.use(adminRouter);
router.use(adminVoicesRouter);
router.use(adminUsageRouter);
router.use(adminPromptTemplatesRouter);
router.use(adminSystemPromptTemplatesRouter);
router.use(adminUserMgmtRouter);
router.use(adminPartnersRouter);
router.use(adminDeploymentsRouter);
router.use(adminGenderServiceRouter);
router.use(adminEmailsRouter);
router.use(adminFinanceAnalyticsRouter);
router.use(adminBoardAnalyticsRouter);
router.use(adminCallAnalyticsRouter);
router.use(adminV2AnalyticsRouter);
router.use(adminV2SaasRouter);
router.use(adminCostPricingRouter);
router.use(adminManagedInfraRouter);
router.use(adminV2CustomersRouter);
router.use(adminV2OperationsRouter);
router.use(adminV2ProductRouter);
router.use(adminV2VoiceRouter);
router.use(adminV2RevenueRouter);
router.use(adminEventFeedbackRouter);
router.use(adminVoiceathonRouter);
router.use(adminTeamGuidesRouter);

// Public campaign lead webhook — must be before provisionUser (no Clerk session needed)
router.use(campaignWebhookRouter);
// Public WhatsApp Request-a-Call webhook (also mounts authenticated CRUD under /whatsapp/*)
router.use(whatsappRouter);
// Public webcall join metadata + authenticated link CRUD
router.use(webcallLinksRouter);

// Meeting bots (Recall.ai): public bot page (token-authed) + authed launch/status
router.use(meetBotsRouter);
// Recall Calendar V2: Google connect + opt-in event bots (webhook is public)
router.use(meetCalendarRouter);


// Hosted remote MCP + OAuth (Claude custom connectors) — before provisionUser
router.use(mcpRouter);

// Public docs routes — changelog API (no session required)
router.use(docsRouter);

// Public auth routes — Google login redirect + callback (no session required)
router.use(authRouter);

// Public utility routes — no auth required
router.use(voicesRouter);
router.use(geminiLiveRouter);
router.use(openaiRealtimeRouter);
router.use(utilsRouter);

// Public book progress routes — anonymous per-device, no session required
router.use(bookRouter);

// Public workshop feedback form — anonymous students, no session required
router.use(workshopRouter);

// Public landing-page partner form (CORS + optional API key)
router.use(landingLeadsRouter);

// Public Voice-a-thon registration / judge / verify — no session required
router.use(voiceathonPublicRouter);

// Public workflow trigger intake (website / Instagram form leads) — no session
router.use(workflowsPublicRouter);

// KYC callback/webhook are unauthenticated browser/provider hits. Must mount
// before any router that does `router.use(requireAuth)` (campaigns, etc.) —
// Express runs that middleware for every request that enters the router, so
// an unauthenticated VoBiz redirect would otherwise get 401 JSON and never
// reach /kyc/callback. Authed /kyc/status + /kyc/start keep their own requireAuth.
router.use(kycRouter);

// Google Sheets + Scheduling both receive unauthenticated browser hits (Google's
// OAuth redirect back to /sheets/google/callback and /scheduling/google/callback,
// plus the public booking pages). Same constraint as kycRouter above: they must
// be mounted before the campaign routers, whose blanket `router.use(requireAuth)`
// answers 401 for every request that reaches them. Their authenticated routes
// carry their own per-route requireAuth and read identity from attachSession.
router.use(sheetsRouter);
router.use(schedulingRouter);

// Partner login branding + logos — unauthenticated. Must sit before campaign
// routers (blanket requireAuth) or custom-domain /sign-in fetches 401 and the
// page falls back to SnapServe chrome.
router.use(partnerPublicRouter);

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
router.use(teamRouter);
router.use(activityLogsRouter);
router.use(phoneNumbersRouter);
router.use(webhookEndpointsRouter);
router.use(agentTemplatesRouter);
router.use(onboardingRouter);
router.use(wizardRouter);
router.use(vibeRouter);
router.use(vibeSessionsRouter);
router.use(agentTasksRouter);
router.use(campaignDashboardRouter);
router.use(campaignsRouter);
router.use(campaignBatchesRouter);
router.use(campaignLeadsRouter);
router.use(campaignAnalyticsRouter);
router.use(campaignLeadReportingRouter);
router.use(campaignReportsRouter);
router.use(campaignOpsRouter);
router.use(commandCenterRouter);
router.use(liveQueueRouter);
router.use(campaignCallbacksRouter);
router.use(campaignIncomingRouter);
router.use(campaignBookingsRouter);
router.use(campaignTransfersRouter);
router.use(batchWorkspaceRouter);
router.use(leadWorkspaceRouter);
router.use(platformAnalyticsRouter);
router.use(searchRouter);
router.use(agentVariablesRouter);
router.use(batchImportRunsRouter);
router.use(assistantRouter);
router.use(usageMeRouter);
router.use(userApiKeysRouter);
router.use(metaRouter);
router.use(callTransfersRouter);
router.use(billingRouter);
router.use(testToolRouter);
router.use(dispositionRouter);
router.use(agentVersionsRouter);
router.use(callbacksRouter);
router.use(connectionsRouter);
router.use(crmRouter);
router.use(workflowsRouter);
router.use(journeysRouter);
router.use(emailChannelsRouter);
router.use(sheetAutoCallsRouter);
router.use(squadsRouter);
router.use(voiceathonEventsRouter);
router.use(whatsappNativeRouter);
router.use(whatsappExtrasRouter);
// Partner (reseller) panel — authed partner routes + public logo endpoint
router.use(partnerRouter);
router.use(adminWhatsappRouter);
export default router;

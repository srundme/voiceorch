import { Router, type IRouter } from "express";
import healthRouter from "./health";
import agentsRouter from "./agents";
import callsRouter from "./calls";
import providersRouter from "./providers";
import analyticsRouter from "./analytics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(agentsRouter);
router.use(callsRouter);
router.use(providersRouter);
router.use(analyticsRouter);

export default router;

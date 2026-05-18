import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dossiersRouter from "./dossiers";
import documentsRouter from "./documents";
import aiRouter from "./ai";
import conditionsRouter from "./conditions";
import partnersRouter from "./partners";
import submissionsRouter from "./submissions";
import dashboardRouter from "./dashboard";
import activityRouter from "./activity";
import integrationsRouter from "./integrations";
import adminPilotRouter from "./admin-pilot";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dossiersRouter);
router.use(documentsRouter);
router.use(aiRouter);
router.use(conditionsRouter);
router.use(partnersRouter);
router.use(submissionsRouter);
router.use(dashboardRouter);
router.use(activityRouter);
router.use(integrationsRouter);
router.use(adminPilotRouter);

export default router;

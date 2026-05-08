import { Router, type IRouter } from "express";
import {
  pipedriveStatus,
  sendgridStatus,
  aiSkillsStatus,
  objectStorageStatus,
} from "../lib/integrations";

const router: IRouter = Router();

router.get("/integrations/status", (_req, res): void => {
  res.json({
    pipedrive: pipedriveStatus(),
    sendgrid: sendgridStatus(),
    aiSkills: aiSkillsStatus(),
    objectStorage: objectStorageStatus(),
  });
});

export default router;

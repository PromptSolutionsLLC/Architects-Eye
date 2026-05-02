import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aircraftRouter from "./aircraft";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aircraftRouter);

export default router;

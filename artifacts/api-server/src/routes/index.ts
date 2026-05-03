import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aircraftRouter from "./aircraft";
import tleRouter from "./tle";
import firesRouter from "./fires";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aircraftRouter);
router.use(tleRouter);
router.use(firesRouter);

export default router;

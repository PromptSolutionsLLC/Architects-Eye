import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aircraftRouter from "./aircraft";
import tleRouter from "./tle";
import firesRouter from "./fires";
import quakesRouter from "./quakes";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aircraftRouter);
router.use(tleRouter);
router.use(firesRouter);
router.use(quakesRouter);

export default router;

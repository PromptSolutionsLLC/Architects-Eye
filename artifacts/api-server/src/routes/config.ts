import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/config", (_req, res) => {
  res.json({
    cesiumToken: process.env["CESIUM_ION_TOKEN"] ?? "",
    googleMapsKey: process.env["GOOGLE_MAPS_API_KEY"] ?? "",
  });
});

export default router;

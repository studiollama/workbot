import { Router } from "express";
import { readLogs } from "../mcp-logger.js";

const router = Router();

router.get("/mcp", (req, res) => {
  const limit = parseInt(String(req.query.limit ?? "100"), 10);
  const offset = parseInt(String(req.query.offset ?? "0"), 10);
  const tool = req.query.tool ? String(req.query.tool) : undefined;

  const result = readLogs({ limit, offset, tool });
  res.json(result);
});

export default router;

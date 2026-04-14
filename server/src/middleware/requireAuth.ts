import type { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: "Authentication required" });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session?.authenticated && req.session.role === "admin") return next();
  res.status(403).json({ error: "Admin access required" });
}

/**
 * Middleware that allows admin OR the specific subagent user.
 * Use as: requireSubagentAccess("paramName") where paramName is the route param for subagent ID.
 */
export function requireSubagentAccess(paramName = "id") {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.authenticated) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (req.session.role === "admin") return next();
    if (req.session.role === "subagent" && req.session.subagentId === req.params[paramName]) {
      return next();
    }
    res.status(403).json({ error: "Access denied" });
  };
}

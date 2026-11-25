import type { Request, Response } from "express";
import * as githubService from "../services/github.service.js";

export const githubController = {
  async listPublicRepositories(_req: Request, res: Response) {
    const snapshot = await githubService.publicRepositories();
    // Browsers may reuse this for five minutes; the backend caches for ten.
    res.set("Cache-Control", "public, max-age=300");
    res.json(snapshot);
  },

  async refreshRepositories(_req: Request, res: Response) {
    res.json(await githubService.publicRepositories({ fresh: true }));
  },

  async uploadBlogImage(req: Request, res: Response) {
    res.status(201).json(await githubService.uploadBlogImage(req.file));
  },

  async refreshSite(_req: Request, res: Response) {
    res.json(await githubService.refreshSite());
  },
};

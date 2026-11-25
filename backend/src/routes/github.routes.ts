import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../lib/http.js";
import { requireEditor } from "../middleware/auth.js";
import { githubController } from "../controllers/github.controller.js";
import { MAX_BLOG_IMAGE_BYTES } from "../services/github.service.js";

export const githubPublicRouter = Router();

githubPublicRouter.get(
  "/repositories",
  asyncHandler(githubController.listPublicRepositories),
);

export const githubAdminRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BLOG_IMAGE_BYTES, files: 1 },
});

githubAdminRouter.post(
  "/blog-images",
  requireEditor,
  upload.single("file"),
  asyncHandler(githubController.uploadBlogImage),
);
githubAdminRouter.post(
  "/refresh-site",
  requireEditor,
  asyncHandler(githubController.refreshSite),
);
githubAdminRouter.post(
  "/refresh-repositories",
  requireEditor,
  asyncHandler(githubController.refreshRepositories),
);

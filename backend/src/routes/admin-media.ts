import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { requireEditor } from "../middleware/auth.js";
import { HttpError, asyncHandler } from "../lib/http.js";
import { IMAGE_EXTENSION, sniffImageType } from "../lib/image.js";

export const adminMediaRouter = Router();
adminMediaRouter.use(requireEditor);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 2 },
});

const mediaRoot = join(config.MEDIA_DIR, "members");

function publicURL(file: string): string {
  return `${config.PUBLIC_API_URL.replace(/\/$/, "")}/media/members/${file}`;
}

adminMediaRouter.post(
  "/member-photos",
  upload.fields([
    { name: "full", maxCount: 1 },
    { name: "thumb", maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const full = files?.full?.[0];
    const thumb = files?.thumb?.[0];

    if (!full || !thumb) {
      throw new HttpError(400, "Send both the full photo and its thumbnail.");
    }

    const fullType = sniffImageType(full.buffer);
    if (!fullType) {
      throw new HttpError(400, "Use a JPG, PNG or WebP image.");
    }
    if (sniffImageType(thumb.buffer) !== "image/png") {
      throw new HttpError(400, "The thumbnail must be a PNG image.");
    }

    await mkdir(mediaRoot, { recursive: true });

    const id = randomUUID();
    const fullName = `${id}.${IMAGE_EXTENSION[fullType]}`;
    const thumbName = `${id}-24.png`;

    await writeFile(join(mediaRoot, fullName), full.buffer, { mode: 0o644 });
    try {
      await writeFile(join(mediaRoot, thumbName), thumb.buffer, { mode: 0o644 });
    } catch (error) {
      await unlink(join(mediaRoot, fullName)).catch(() => undefined);
      throw error;
    }

    res.status(201).json({
      photo_url: publicURL(fullName),
      photo_thumb_url: publicURL(thumbName),
    });
  }),
);

adminMediaRouter.delete(
  "/member-photos",
  asyncHandler(async (req, res) => {
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    const prefix = `${config.PUBLIC_API_URL.replace(/\/$/, "")}/media/members/`;

    for (const url of urls) {
      if (typeof url !== "string" || !url.startsWith(prefix)) continue;
      const file = basename(decodeURIComponent(url.slice(prefix.length)));
      await unlink(join(mediaRoot, file)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }

    res.status(204).end();
  }),
);

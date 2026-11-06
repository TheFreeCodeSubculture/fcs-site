import { randomUUID } from "node:crypto";
import { Router } from "express";
import { config } from "../config.js";
import { requireEditor } from "../middleware/auth.js";
import { HttpError, asyncHandler } from "../lib/http.js";
import { MAX_BYTES, REPO } from "../integrations/medium/asset.js";
import { handleAction } from "../integrations/medium/importer.js";

export const integrationsRouter = Router();

const UA = "Mozilla/5.0 (compatible; fcs-site/1.0)";

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchBytes(url: string) {
  const response = await fetch(url, {
    headers: { "user-agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    type: response.headers.get("content-type") || "",
  };
}

async function putAsset(bytes: Uint8Array, _ext: string, path: string) {
  if (!config.GITHUB_ASSETS_TOKEN) {
    throw new Error("Image upload is not configured: set GITHUB_ASSETS_TOKEN.");
  }

  const response = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${config.GITHUB_ASSETS_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "fcs-site-asset-uploader",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: "asset: upload from Medium",
        content: Buffer.from(bytes).toString("base64"),
      }),
    },
  );

  if (response.status !== 201) {
    throw new Error(`GitHub PUT failed ${response.status}: ${(await response.text()).slice(0, 160)}`);
  }

  const data = (await response.json()) as { commit?: { sha?: string } };
  if (!data.commit?.sha) throw new Error("GitHub response missing commit sha");
  return { sha: data.commit.sha, path };
}

integrationsRouter.post(
  "/medium",
  requireEditor,
  asyncHandler(async (req, res) => {
    const action = req.body?.action;
    if (action === "import" && !config.GITHUB_ASSETS_TOKEN) {
      throw new HttpError(501, "Image upload is not configured: set GITHUB_ASSETS_TOKEN.");
    }

    const result = await handleAction(req.body, {
      fetchText,
      fetchBytes,
      putAsset,
      limit: 40,
      maxBytes: MAX_BYTES,
      now: new Date(),
      newID: () => randomUUID(),
    });

    if (action === "import") {
      res.setHeader("cache-control", "no-store");
    }
    res.status(result.status).json(result.body);
  }),
);

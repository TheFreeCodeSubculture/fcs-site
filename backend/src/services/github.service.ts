import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { HttpError } from "../lib/http.js";
import { IMAGE_EXTENSION, sniffImageType } from "../lib/image.js";

const ASSETS_REPO = "TheFreeCodeSubculture/fcs-assets";
const SITE_REPO = "TheFreeCodeSubculture/fcs-site";
const WORKFLOW = "pages.yml";
export const MAX_BLOG_IMAGE_BYTES = 2 * 1024 * 1024;

function assetPath(now: Date, id: string, extension: string): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `blog/${now.getUTCFullYear()}/${month}/${id}.${extension}`;
}

function cdnURL(sha: string, path: string): string {
  return `https://cdn.jsdelivr.net/gh/${ASSETS_REPO}@${sha}/${path}`;
}

async function github(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "fcs-backend",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
}

export async function uploadBlogImage(
  file: { size: number; buffer: Buffer } | undefined,
) {
  if (!config.GITHUB_ASSETS_TOKEN) {
    throw new HttpError(
      501,
      "Blog image upload is not configured: set GITHUB_ASSETS_TOKEN.",
    );
  }

  if (!file) throw new HttpError(400, "Send an image in the `file` field.");
  if (file.size > MAX_BLOG_IMAGE_BYTES) {
    throw new HttpError(400, "That image is over 2 MB. Shrink it and try again.");
  }

  const type = sniffImageType(file.buffer);
  if (!type) {
    throw new HttpError(400, "Use a JPG, PNG or WebP image.");
  }

  const id = randomUUID();
  const path = assetPath(new Date(), id, IMAGE_EXTENSION[type]);

  const response = await github(
    `/repos/${ASSETS_REPO}/contents/${path}`,
    config.GITHUB_ASSETS_TOKEN,
    {
      method: "PUT",
      body: JSON.stringify({
        message: `Add ${path}`,
        content: file.buffer.toString("base64"),
      }),
    },
  );

  if (response.status !== 201) {
    const detail = (await response.text()).slice(0, 200);
    throw new HttpError(
      502,
      `GitHub refused the image (${response.status}). Try again in a moment. ${detail}`,
    );
  }

  const data = (await response.json()) as { commit: { sha: string } };
  return { url: cdnURL(data.commit.sha, path) };
}

export async function refreshSite() {
  if (!config.GITHUB_DISPATCH_TOKEN) {
    throw new HttpError(
      501,
      "Refreshing is not configured: set GITHUB_DISPATCH_TOKEN.",
    );
  }

  const response = await github(
    `/repos/${SITE_REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    config.GITHUB_DISPATCH_TOKEN,
    {
      method: "POST",
      body: JSON.stringify({ ref: "master" }),
    },
  );

  if (response.status !== 204) {
    const detail = (await response.text()).slice(0, 200);
    throw new HttpError(
      502,
      `GitHub refused the deploy (${response.status}): ${detail}`,
    );
  }

  return { ok: true };
}

/* ---- public repositories --------------------------------------------- */

const REPOSITORY_CACHE_MS = 10 * 60 * 1000;
const REPOSITORY_RETRY_MS = 30 * 1000;

export interface PublicRepository {
  name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
  pushed_at: string | null;
  archived: boolean;
}

export interface RepositorySnapshot {
  fetched_at: string;
  org: string;
  repos: PublicRepository[];
  latest_commit_repo: string | null;
  latest_commit: {
    html_url: string;
    commit: {
      message: string;
      committer: { date: string } | null;
    };
  } | null;
}

interface GitHubRepository extends PublicRepository {
  private?: boolean;
}

interface GitHubCommit {
  html_url: string;
  commit: {
    message: string;
    committer: { date: string } | null;
  };
}

let repositoryCache: {
  snapshot: RepositorySnapshot;
  expiresAt: number;
} | null = null;
let repositoryLoad: Promise<RepositorySnapshot> | null = null;
let repositoryError: { error: unknown; until: number } | null = null;

/* Reads a public GitHub resource. GITHUB_READ_TOKEN is optional: with it
 * the limit is 5,000 requests an hour instead of 60. */
async function githubRead<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "fcs-backend",
  };
  if (config.GITHUB_READ_TOKEN) {
    headers.authorization = `Bearer ${config.GITHUB_READ_TOKEN}`;
  }

  let response: Response;
  try {
    response = await fetch(`https://api.github.com${path}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(
      502,
      "GitHub could not be reached. Try again in a moment.",
    );
  }

  if (!response.ok) {
    const limited = response.status === 403 || response.status === 429;
    throw new HttpError(
      502,
      limited
        ? "GitHub's hourly limit is used up. Try again in a few minutes."
        : `GitHub answered ${response.status}.`,
    );
  }

  return (await response.json()) as T;
}

async function fetchRepositorySnapshot(): Promise<RepositorySnapshot> {
  const org = config.GITHUB_ORG;
  // The organisation is expected to stay under 100 public repositories.
  const all = await githubRead<GitHubRepository[]>(
    `/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=updated&type=public`,
  );
  const repos = all
    .filter((repo) => !repo.private)
    .map(
      ({
        name,
        html_url,
        description,
        language,
        stargazers_count,
        updated_at,
        pushed_at,
        archived,
      }) => ({
        name,
        html_url,
        description,
        language,
        stargazers_count,
        updated_at,
        pushed_at,
        archived,
      }),
    );

  const latest = [...repos]
    .filter((repo) => repo.pushed_at)
    .sort(
      (a, b) =>
        new Date(b.pushed_at || 0).getTime() -
        new Date(a.pushed_at || 0).getTime(),
    )[0];

  let latest_commit: RepositorySnapshot["latest_commit"] = null;
  if (latest) {
    try {
      const commits = await githubRead<GitHubCommit[]>(
        `/repos/${encodeURIComponent(org)}/${encodeURIComponent(latest.name)}/commits?per_page=1`,
      );
      const commit = commits[0];
      if (commit) {
        latest_commit = {
          html_url: commit.html_url,
          commit: {
            message: commit.commit.message,
            committer: commit.commit.committer,
          },
        };
      }
    } catch {
      // The repository list is still useful without the newest commit.
    }
  }

  return {
    fetched_at: new Date().toISOString(),
    org,
    repos,
    latest_commit_repo: latest ? latest.name : null,
    latest_commit,
  };
}

/* Cached so visitors never spend GitHub's anonymous allowance. A failed
 * refresh keeps serving the last good snapshot; without one it retries
 * after a short pause instead of hammering GitHub on every request. */
export async function publicRepositories({
  fresh = false,
}: { fresh?: boolean } = {}): Promise<RepositorySnapshot> {
  const now = Date.now();

  if (!fresh) {
    if (repositoryCache && repositoryCache.expiresAt > now) {
      return repositoryCache.snapshot;
    }
    if (repositoryError && repositoryError.until > now) {
      if (repositoryCache) return repositoryCache.snapshot;
      throw repositoryError.error;
    }
  }

  if (!repositoryLoad) {
    repositoryLoad = fetchRepositorySnapshot()
      .then((snapshot) => {
        repositoryCache = {
          snapshot,
          expiresAt: Date.now() + REPOSITORY_CACHE_MS,
        };
        repositoryError = null;
        return snapshot;
      })
      .catch((error: unknown) => {
        repositoryError = { error, until: Date.now() + REPOSITORY_RETRY_MS };
        throw error;
      })
      .finally(() => {
        repositoryLoad = null;
      });
  }

  try {
    return await repositoryLoad;
  } catch (error) {
    if (repositoryCache) return repositoryCache.snapshot;
    throw error;
  }
}

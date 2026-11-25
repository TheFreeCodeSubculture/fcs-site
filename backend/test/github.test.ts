import type { Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repositories = [
  {
    name: "alpha",
    html_url: "https://github.com/TheFreeCodeSubculture/alpha",
    description: "Alpha project",
    language: "TypeScript",
    stargazers_count: 4,
    updated_at: "2026-11-20T10:00:00Z",
    pushed_at: "2026-11-21T10:00:00Z",
    archived: false,
    private: false,
  },
  {
    name: "beta",
    html_url: "https://github.com/TheFreeCodeSubculture/beta",
    description: null,
    language: null,
    stargazers_count: 0,
    updated_at: "2026-11-22T10:00:00Z",
    pushed_at: "2026-11-23T10:00:00Z",
    archived: false,
    private: false,
  },
];

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let app: Express;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/commits?")) {
      return json([
        {
          html_url: "https://github.com/TheFreeCodeSubculture/beta/commit/abc",
          commit: {
            message: "Ship it\n\nLong body",
            committer: { date: "2026-11-23T10:05:00Z" },
          },
        },
      ]);
    }
    return json(repositories);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/public/repositories", () => {
  it("returns the organisation snapshot from the backend cache", async () => {
    const first = await request(app).get("/api/public/repositories");

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      org: "TheFreeCodeSubculture",
      latest_commit_repo: "beta",
    });
    expect(first.body.repos.map((repo: { name: string }) => repo.name)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(first.body.latest_commit.commit.message).toBe("Ship it\n\nLong body");
    expect(first.body.fetched_at).toEqual(expect.any(String));
    expect(first.headers["cache-control"]).toBe("public, max-age=300");

    const second = await request(app).get("/api/public/repositories");

    expect(second.status).toBe(200);
    expect(second.body.repos).toHaveLength(2);
    // One org listing plus one latest-commit read, then memory only.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns 502 when GitHub is unavailable", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const response = await request(app).get("/api/public/repositories");

    expect(response.status).toBe(502);
    expect(response.body.error).toMatch(/GitHub could not be reached/);
  });

  it("keeps serving the last good snapshot after a failed refresh", async () => {
    await request(app).get("/api/public/repositories");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    fetchMock.mockRejectedValue(new Error("network down"));

    const response = await request(app).get("/api/public/repositories");

    expect(response.status).toBe(200);
    expect(response.body.repos).toHaveLength(2);
  });
});

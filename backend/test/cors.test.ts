import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("CORS", () => {
  it("allows PUT for admin updates", async () => {
    const response = await request(createApp())
      .options("/api/admin/repo-kinds/test")
      .set("origin", "http://localhost:8000")
      .set("access-control-request-method", "PUT");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");
  });
});

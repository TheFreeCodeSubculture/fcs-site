import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("GET /", () => {
  it("identifies the service", async () => {
    const response = await request(createApp()).get("/");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: "fcs-backend",
      status: "ok",
    });
  });
});

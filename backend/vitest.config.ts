import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      NODE_ENV: "test",
      // The tests that touch the database use this URL. CI starts Postgres.
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ||
        "postgres://fcs_app:test@127.0.0.1:5432/fcs_test",
      MEDIA_DIR: "./test-media",
      PUBLIC_API_URL: "http://localhost:5050",
    },
  },
});

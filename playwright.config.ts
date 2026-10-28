import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    // stripe-mock (Docker) : simule l'API Stripe, sans clé ni réseau.
    { command: "node scripts/stripe-mock.mjs run", url: "http://127.0.0.1:12111/v1/customers", reuseExistingServer: true, timeout: 120_000 },
    {
      command: process.env.E2E_DEV ? "npm run dev" : "npm run build && npm run start",
      url: "http://localhost:3000/login",
      reuseExistingServer: true,
      env: {
        ALLOW_DEV_CODE: "1", GEOCODER: "mock", E2E_ALLOW_MOCK_GEOCODER: "1", // géocodage déterministe, sans réseau
        ONBOARDING_REQUIRE_PLAN: "0", STRIPE_API_BASE: "http://127.0.0.1:12111", STRIPE_SECRET_KEY: "sk_test_mock", E2E_ALLOW_STRIPE_MOCK: "1", // Stripe simulé
        STRIPE_WEBHOOK_SECRET: "whsec_e2e_test_secret", STRIPE_PRICE_STARTER: "", STRIPE_PRICE_PRO: "", STRIPE_PRICE_BUSINESS: "",
      },
      timeout: 180_000,
    },
  ],
});

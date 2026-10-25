import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Stripe : toujours simulé en test (jamais de clé réelle ni de réseau).
process.env.STRIPE_API_BASE = "http://127.0.0.1:12111";
process.env.STRIPE_SECRET_KEY = "sk_test_mock";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_vitest_secret";
process.env.STRIPE_PRICE_STARTER = "";
process.env.STRIPE_PRICE_PRO = "";
process.env.STRIPE_PRICE_BUSINESS = "";

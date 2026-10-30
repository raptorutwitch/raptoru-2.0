import { createTestDb } from './helpers.js';
import { cosmeticShopSuite } from './cosmetic-shop.suite.js';

// Boutique cosmétique V1 on PGlite (the same suite runs on a real Postgres: cosmetic-shop.integration.test.ts).
cosmeticShopSuite(createTestDb);

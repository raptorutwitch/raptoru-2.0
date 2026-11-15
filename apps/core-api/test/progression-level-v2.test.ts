import { createTestDb } from './helpers.js';
import { levelV2Suite } from './progression-level-v2.suite.js';

// Level Up V2 on PGlite (the same suite runs on a real Postgres: progression-level-v2.integration.test.ts).
levelV2Suite(createTestDb);

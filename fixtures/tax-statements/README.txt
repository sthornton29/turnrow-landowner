Drop the three real 2024 statement PDFs here as 2024-lawrence.pdf, 2024-colbert.pdf, 2024-morgan.pdf.
Then run: TAX_FIXTURES_LIVE=1 npx vitest run lib/taxFixtures.live.test.ts (writes the .expected.json snapshots).
lib/taxFixtures.test.ts runs on the snapshots every time.

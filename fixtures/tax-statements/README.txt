Drop the three real 2024 statement PDFs here as 2024-lawrence.pdf, 2024-colbert.pdf, 2024-morgan.pdf.
Then run: TAX_FIXTURES_LIVE=1 npx vitest run lib/taxFixtures.live.test.ts (writes the .expected.json snapshots).
lib/taxFixtures.test.ts runs on the snapshots every time.
2026-colbert.pdf is the same Colbert account (1234, PPIN lines 2471 and 2661) a year later.
To add one statement without touching the other snapshots:
  TAX_FIXTURES_LIVE=1 TAX_FIXTURES_ONLY=2026-colbert npx vitest run lib/taxFixtures.live.test.ts
After ANY change to the reader's instructions (app/api/extract/taxTools.ts), re-run all of them and read the
git diff of the snapshots value by value, not only the test result: on 2026-11-19 one wording left Morgan's
appraised value blank and the tests of the day still passed.
To read statements that should not be committed (a customer's bill, a damaged copy), point at another folder;
the .expected.json files are written there beside the PDFs:
  TAX_FIXTURES_LIVE=1 TAX_FIXTURES_DIR=C:/some/folder npx vitest run lib/taxFixtures.live.test.ts

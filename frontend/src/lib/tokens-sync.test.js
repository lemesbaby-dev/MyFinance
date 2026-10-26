import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Fonte única: docs/design/tokens/tokens.css. frontend/src/tokens.css é cópia (npm run sync:tokens).
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('frontend/src/tokens.css é igual à fonte em docs/design/tokens (rode npm run sync:tokens)', () => {
  assert.equal(read('../tokens.css'), read('../../../docs/design/tokens/tokens.css'));
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { PROBES, findDshCheckout, runProbe } from '../scripts/dsh-integration-check.js';

/**
 * These probes execute the provider against a real DeepSeek Harness checkout: the real
 * skill registry, the real filesystem provider and the real consumer-facing snapshot
 * API. They are the only coverage of the integration boundary, because every other test
 * in this repository stubs the DSH host.
 *
 * They need a checkout on disk and are skipped without one, so a hermetic clone still
 * gets a green suite. Run them explicitly with `npm run dsh:verify`.
 */
const dshRoot = findDshCheckout();

const probeTest = (name) => {
  const probe = PROBES.find((entry) => entry.name === name);
  assert.ok(probe, `unknown probe ${name}`);

  test(`real DSH: ${probe.summary}`, { timeout: 300000 }, (t) => {
    if (dshRoot === undefined) {
      t.skip('no DeepSeek Harness checkout; set DSH_CHECKOUT to enable');
      return;
    }

    const outcome = runProbe(probe, { dshRoot });
    assert.ok(
      outcome.report !== undefined,
      `probe produced no JSON report\nstdout:\n${outcome.stdout}\nstderr:\n${outcome.stderr}`,
    );

    const failures = (outcome.report.detail ?? []).filter((entry) => entry.ok !== true);
    assert.deepEqual(
      failures,
      [],
      `${probe.name} diverged in ${failures.length} check(s): ${failures.map((entry) => `${entry.case ?? ''}.${entry.field ?? ''}`).join(', ')}`,
    );
    assert.equal(outcome.ok, true, outcome.stderr);
  });
};

probeTest('live-integration');
probeTest('frontmatter-conformance');

test('the integration gate honours an explicit checkout and never silently substitutes one', () => {
  // An explicit path is authoritative: if it is not a usable checkout the runner must
  // report unavailability rather than quietly probing a different one and passing.
  assert.equal(findDshCheckout('/nonexistent/deepseek-harness'), undefined);
  // With no explicit request, discovery falls back to the known relative layouts.
  assert.equal(findDshCheckout(''), dshRoot);
});

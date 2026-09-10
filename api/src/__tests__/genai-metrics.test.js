'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  errorType,
  DURATION_BUCKETS,
  TOKEN_BUCKETS,
} = require('../genai-metrics');

describe('bucket boundaries', () => {
  // These are lifted verbatim from the GenAI metrics conventions. Splunk's
  // AI overview charts percentiles off these histograms, and the OTel
  // defaults bucket nearly every LLM call together.
  it('uses the conventional duration boundaries, in seconds', () => {
    assert.deepEqual(DURATION_BUCKETS, [
      0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28,
      2.56, 5.12, 10.24, 20.48, 40.96, 81.92,
    ]);
  });

  it('uses the conventional token boundaries', () => {
    assert.deepEqual(TOKEN_BUCKETS, [
      1, 4, 16, 64, 256, 1024, 4096, 16384,
      65536, 262144, 1048576, 4194304, 16777216, 67108864,
    ]);
  });

  it('keeps both sets ascending, which the SDK requires', () => {
    for (const set of [DURATION_BUCKETS, TOKEN_BUCKETS]) {
      for (let i = 1; i < set.length; i += 1) {
        assert.ok(set[i] > set[i - 1], `${set[i]} must exceed ${set[i - 1]}`);
      }
    }
  });

  // A typical chat call is 1-3 seconds and a few hundred tokens. If those
  // land in the top or bottom bucket the percentiles are meaningless.
  it('puts typical LLM values in the middle of the range', () => {
    assert.ok(1.5 > DURATION_BUCKETS[0] && 1.5 < DURATION_BUCKETS[DURATION_BUCKETS.length - 1]);
    assert.ok(600 > TOKEN_BUCKETS[0] && 600 < TOKEN_BUCKETS[TOKEN_BUCKETS.length - 1]);
  });
});

describe('errorType', () => {
  // error.type is a CLASS of error, not a message. Putting the message
  // here would explode cardinality on a dimension Splunk groups by.
  it('prefers the error name', () => {
    const err = new TypeError('boom');
    assert.equal(errorType(err), 'TypeError');
  });

  it('falls back to a string code when the name is generic', () => {
    const err = new Error('boom');
    err.code = 'ECONNREFUSED';
    assert.equal(errorType(err), 'ECONNREFUSED');
  });

  it('returns unknown rather than a message for a plain Error', () => {
    assert.equal(errorType(new Error('some very unique message')), 'unknown');
  });

  it('handles a missing error', () => {
    assert.equal(errorType(null), 'unknown');
    assert.equal(errorType(undefined), 'unknown');
  });

  it('ignores a non-string code', () => {
    const err = new Error('boom');
    err.code = 500;
    assert.equal(errorType(err), 'unknown');
  });
});

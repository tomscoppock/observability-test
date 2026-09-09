'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  sessionAttributes,
  SESSION_ID_HEADER,
  ATTR_SESSION_ID,
  MAX_SESSION_ID_LENGTH,
} = require('../session-attributes');

describe('sessionAttributes', () => {
  it('returns the session.id attribute when the client sends the header', () => {
    assert.deepEqual(
      sessionAttributes({ [SESSION_ID_HEADER]: 'demo-alice-1788967971' }),
      { [ATTR_SESSION_ID]: 'demo-alice-1788967971' },
    );
  });

  it('uses the official semantic convention attribute name', () => {
    assert.equal(ATTR_SESSION_ID, 'session.id');
  });

  // The regression this whole module exists for. The previous implementation
  // generated a random UUID when the header was absent, so every unheadered
  // request (Docker healthchecks, Nginx upstream probes) looked like a
  // distinct user. Live data showed 3 real sessions against 307 phantoms.
  it('does NOT invent a session id when the header is absent', () => {
    assert.deepEqual(sessionAttributes({}), {});
  });

  it('returns no attributes for missing or malformed headers', () => {
    assert.deepEqual(sessionAttributes(undefined), {});
    assert.deepEqual(sessionAttributes(null), {});
    assert.deepEqual(sessionAttributes({ 'x-other': 'value' }), {});
  });

  it('ignores a header that is empty or only whitespace', () => {
    assert.deepEqual(sessionAttributes({ [SESSION_ID_HEADER]: '' }), {});
    assert.deepEqual(sessionAttributes({ [SESSION_ID_HEADER]: '   ' }), {});
    assert.deepEqual(sessionAttributes({ [SESSION_ID_HEADER]: '\t\n' }), {});
  });

  it('trims surrounding whitespace', () => {
    assert.deepEqual(
      sessionAttributes({ [SESSION_ID_HEADER]: '  demo-bob  ' }),
      { [ATTR_SESSION_ID]: 'demo-bob' },
    );
  });

  // Node represents a repeated header as an array.
  it('takes the first value when the header is repeated', () => {
    assert.deepEqual(
      sessionAttributes({ [SESSION_ID_HEADER]: ['first', 'second'] }),
      { [ATTR_SESSION_ID]: 'first' },
    );
  });

  it('returns no attributes for an empty header array', () => {
    assert.deepEqual(sessionAttributes({ [SESSION_ID_HEADER]: [] }), {});
  });

  it('accepts a value exactly at the length limit', () => {
    const id = 'a'.repeat(MAX_SESSION_ID_LENGTH);
    assert.deepEqual(
      sessionAttributes({ [SESSION_ID_HEADER]: id }),
      { [ATTR_SESSION_ID]: id },
    );
  });

  // Attacker-influenced input that reaches the telemetry backend and, once
  // indexed as a metric dimension, its cardinality budget. Rejected rather
  // than truncated: truncating would merge distinct sessions into one.
  it('rejects an over-long value rather than truncating it', () => {
    assert.deepEqual(
      sessionAttributes({ [SESSION_ID_HEADER]: 'a'.repeat(MAX_SESSION_ID_LENGTH + 1) }),
      {},
    );
  });

  it('ignores non-string header values', () => {
    assert.deepEqual(sessionAttributes({ [SESSION_ID_HEADER]: 42 }), {});
    assert.deepEqual(sessionAttributes({ [SESSION_ID_HEADER]: {} }), {});
  });
});

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  contentAttributes,
  isContentCaptureEnabled,
  CAPTURE_ENV_VAR,
  ATTR_INPUT_MESSAGES,
  ATTR_OUTPUT_MESSAGES,
  ATTR_TRUNCATED,
  MAX_CONTENT_CHARS,
} = require('../genai-content');

const MESSAGES = [{ role: 'user', content: 'what is the leave policy?' }];
const on = { [CAPTURE_ENV_VAR]: 'SPAN_ONLY' };

describe('isContentCaptureEnabled', () => {
  // The safety-critical property. Everything else is detail.
  it('is OFF when the variable is unset', () => {
    assert.equal(isContentCaptureEnabled({}), false);
  });

  it('is OFF for explicit false-ish values', () => {
    for (const v of ['false', 'FALSE', '0', 'no', 'off', '']) {
      assert.equal(isContentCaptureEnabled({ [CAPTURE_ENV_VAR]: v }), false, v);
    }
  });

  it('is ON for SPAN_ONLY, the value Splunk documents', () => {
    assert.equal(isContentCaptureEnabled({ [CAPTURE_ENV_VAR]: 'SPAN_ONLY' }), true);
    assert.equal(isContentCaptureEnabled({ [CAPTURE_ENV_VAR]: 'span_only' }), true);
    assert.equal(isContentCaptureEnabled({ [CAPTURE_ENV_VAR]: ' SPAN_ONLY ' }), true);
  });

  it('is ON for the legacy true/1 spellings', () => {
    assert.equal(isContentCaptureEnabled({ [CAPTURE_ENV_VAR]: 'true' }), true);
    assert.equal(isContentCaptureEnabled({ [CAPTURE_ENV_VAR]: '1' }), true);
  });

  // EVENT_ONLY asks for content as separate log events, which this service
  // does not emit. Honouring it as a span attribute would put content
  // somewhere the operator did not ask for it.
  it('is OFF for EVENT_ONLY, which asks for something we do not emit', () => {
    assert.equal(isContentCaptureEnabled({ [CAPTURE_ENV_VAR]: 'EVENT_ONLY' }), false);
  });

  it('is OFF for unrecognised values rather than guessing', () => {
    assert.equal(isContentCaptureEnabled({ [CAPTURE_ENV_VAR]: 'maybe' }), false);
  });
});

describe('contentAttributes', () => {
  it('returns nothing at all when capture is disabled', () => {
    assert.deepEqual(
      contentAttributes({ messages: MESSAGES, output: 'an answer', env: {} }),
      {},
    );
  });

  it('captures prompt and response when enabled', () => {
    const attrs = contentAttributes({ messages: MESSAGES, output: 'an answer', env: on });
    assert.equal(attrs[ATTR_INPUT_MESSAGES], JSON.stringify(MESSAGES));
    assert.equal(attrs[ATTR_OUTPUT_MESSAGES], 'an answer');
  });

  // Structured values are dropped outright by some exporters, so everything
  // goes over the wire as a string. See playbook trap 34.
  it('serialises structured input to a JSON string, not an array', () => {
    const attrs = contentAttributes({ messages: MESSAGES, env: on });
    assert.equal(typeof attrs[ATTR_INPUT_MESSAGES], 'string');
  });

  it('captures each side independently', () => {
    const inOnly = contentAttributes({ messages: MESSAGES, env: on });
    assert.ok(ATTR_INPUT_MESSAGES in inOnly);
    assert.ok(!(ATTR_OUTPUT_MESSAGES in inOnly));

    const outOnly = contentAttributes({ output: 'answer', env: on });
    assert.ok(ATTR_OUTPUT_MESSAGES in outOnly);
    assert.ok(!(ATTR_INPUT_MESSAGES in outOnly));
  });

  it('adds no attributes when there is nothing to capture', () => {
    assert.deepEqual(contentAttributes({ env: on }), {});
  });

  it('truncates oversized content and flags it', () => {
    const huge = 'x'.repeat(MAX_CONTENT_CHARS + 500);
    const attrs = contentAttributes({ output: huge, env: on });
    assert.equal(attrs[ATTR_OUTPUT_MESSAGES].length, MAX_CONTENT_CHARS);
    assert.equal(attrs[ATTR_TRUNCATED], true);
  });

  it('does not flag truncation when content fits', () => {
    const attrs = contentAttributes({ output: 'short', env: on });
    assert.ok(!(ATTR_TRUNCATED in attrs));
  });

  it('survives content that cannot be serialised', () => {
    const circular = {};
    circular.self = circular;
    assert.deepEqual(contentAttributes({ messages: circular, env: on }), {});
  });

  it('is safe to call with no arguments', () => {
    assert.deepEqual(contentAttributes(), {});
  });
});

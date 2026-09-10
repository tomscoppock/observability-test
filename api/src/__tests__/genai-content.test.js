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

  // THE REGRESSION THAT MATTERS. Splunk's AI Interactions view calls
  // JSON.parse on these attributes. Sending the bare answer text threw
  // on the first character ("According ...") and its React error boundary
  // blanked the whole trace page.
  it('emits valid JSON on both sides', () => {
    const attrs = contentAttributes({ messages: MESSAGES, output: 'According to policy', env: on });
    assert.doesNotThrow(() => JSON.parse(attrs[ATTR_INPUT_MESSAGES]));
    assert.doesNotThrow(() => JSON.parse(attrs[ATTR_OUTPUT_MESSAGES]));
  });

  // Shape is normative: the conventions say instrumentations MUST follow
  // the published JSON schema. Array of messages, each { role, parts },
  // each part { type: 'text', content }.
  it('shapes input to the semantic-convention schema', () => {
    const parsed = JSON.parse(contentAttributes({ messages: MESSAGES, env: on })[ATTR_INPUT_MESSAGES]);
    assert.deepEqual(parsed, [
      { role: 'user', parts: [{ type: 'text', content: 'what is the leave policy?' }] },
    ]);
  });

  it('shapes a plain output string into an assistant message', () => {
    const parsed = JSON.parse(contentAttributes({ output: 'an answer', env: on })[ATTR_OUTPUT_MESSAGES]);
    assert.deepEqual(parsed, [
      { role: 'assistant', parts: [{ type: 'text', content: 'an answer' }] },
    ]);
  });

  it('keeps the system prompt and conversation order', () => {
    const history = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ];
    const parsed = JSON.parse(contentAttributes({ messages: history, env: on })[ATTR_INPUT_MESSAGES]);
    assert.deepEqual(parsed.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
    assert.equal(parsed[3].parts[0].content, 'second');
  });

  it('passes through a message already carrying parts', () => {
    const already = [{ role: 'user', parts: [{ type: 'text', content: 'shaped' }] }];
    const parsed = JSON.parse(contentAttributes({ messages: already, env: on })[ATTR_INPUT_MESSAGES]);
    assert.deepEqual(parsed, already);
  });

  it('flattens OpenAI multimodal content blocks', () => {
    const multimodal = [{ role: 'user', content: [{ type: 'text', text: 'block one' }] }];
    const parsed = JSON.parse(contentAttributes({ messages: multimodal, env: on })[ATTR_INPUT_MESSAGES]);
    assert.deepEqual(parsed[0].parts, [{ type: 'text', content: 'block one' }]);
  });

  // Structured values are dropped outright by some exporters, so the whole
  // document goes over the wire as one string. See playbook trap 34.
  it('serialises to a string, not a structured value', () => {
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
    const parsed = JSON.parse(attrs[ATTR_OUTPUT_MESSAGES]);
    assert.equal(parsed[0].parts[0].content.length, MAX_CONTENT_CHARS);
    assert.equal(attrs[ATTR_TRUNCATED], true);
  });

  // Clipping the serialised string instead of the content inside it was the
  // second half of the same bug: the result no longer parses.
  it('still emits parseable JSON after truncating', () => {
    const huge = 'x'.repeat(MAX_CONTENT_CHARS * 2);
    const attrs = contentAttributes({ messages: [{ role: 'user', content: huge }], output: huge, env: on });
    assert.doesNotThrow(() => JSON.parse(attrs[ATTR_INPUT_MESSAGES]));
    assert.doesNotThrow(() => JSON.parse(attrs[ATTR_OUTPUT_MESSAGES]));
  });

  it('spends the truncation budget in message order', () => {
    const big = 'a'.repeat(MAX_CONTENT_CHARS - 5);
    const attrs = contentAttributes({
      messages: [{ role: 'user', content: big }, { role: 'user', content: 'bbbbbbbbbb' }],
      env: on,
    });
    const parsed = JSON.parse(attrs[ATTR_INPUT_MESSAGES]);
    assert.equal(parsed[0].parts[0].content.length, MAX_CONTENT_CHARS - 5);
    assert.equal(parsed[1].parts[0].content, 'bbbbb');
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

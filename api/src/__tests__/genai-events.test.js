'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isEventCaptureEnabled,
  toBodyMessages,
  emitOperationDetails,
  EVENT_NAME,
} = require('../genai-events');
const { CAPTURE_ENV_VAR } = require('../genai-content');

const MESSAGES = [
  { role: 'system', content: 'You are an HR Policy Assistant.' },
  { role: 'user', content: 'what is the leave policy?' },
];

describe('isEventCaptureEnabled', () => {
  it('is OFF when unset', () => {
    assert.equal(isEventCaptureEnabled({}), false);
  });

  // The distinction that matters: SPAN_ONLY is the safe default this
  // project ships, and it must NOT start shipping content as log events.
  it('is OFF for SPAN_ONLY', () => {
    assert.equal(isEventCaptureEnabled({ [CAPTURE_ENV_VAR]: 'SPAN_ONLY' }), false);
  });

  it('is ON for the event modes Splunk documents', () => {
    assert.equal(isEventCaptureEnabled({ [CAPTURE_ENV_VAR]: 'SPAN_AND_EVENT' }), true);
    assert.equal(isEventCaptureEnabled({ [CAPTURE_ENV_VAR]: 'event_only' }), true);
    assert.equal(isEventCaptureEnabled({ [CAPTURE_ENV_VAR]: ' SPAN_AND_EVENT ' }), true);
  });

  it('is OFF for legacy true/1, which mean span capture', () => {
    assert.equal(isEventCaptureEnabled({ [CAPTURE_ENV_VAR]: 'true' }), false);
    assert.equal(isEventCaptureEnabled({ [CAPTURE_ENV_VAR]: '1' }), false);
  });

  it('is OFF for unrecognised values', () => {
    assert.equal(isEventCaptureEnabled({ [CAPTURE_ENV_VAR]: 'maybe' }), false);
  });
});

describe('toBodyMessages', () => {
  it('wraps plain content into typed parts', () => {
    assert.deepEqual(toBodyMessages([{ role: 'user', content: 'hi' }]), [
      { role: 'user', parts: [{ type: 'text', content: 'hi' }] },
    ]);
  });

  it('passes through messages that already carry parts', () => {
    const shaped = [{ role: 'user', parts: [{ type: 'text', content: 'hi' }] }];
    assert.deepEqual(toBodyMessages(shaped), shaped);
  });

  it('returns undefined for nothing usable', () => {
    assert.equal(toBodyMessages([]), undefined);
    assert.equal(toBodyMessages(null), undefined);
    assert.equal(toBodyMessages([null, 3]), undefined);
  });
});

describe('emitOperationDetails', () => {
  it('emits nothing when capture is off', () => {
    assert.equal(
      emitOperationDetails({ messages: MESSAGES, output: 'answer', env: {} }),
      false,
    );
  });

  it('emits nothing under SPAN_ONLY', () => {
    assert.equal(
      emitOperationDetails({
        messages: MESSAGES,
        output: 'answer',
        env: { [CAPTURE_ENV_VAR]: 'SPAN_ONLY' },
      }),
      false,
    );
  });

  it('emits when an event mode is set and there is content', () => {
    assert.equal(
      emitOperationDetails({
        messages: MESSAGES,
        output: 'answer',
        env: { [CAPTURE_ENV_VAR]: 'SPAN_AND_EVENT' },
      }),
      true,
    );
  });

  it('emits nothing when there is no content to report', () => {
    assert.equal(
      emitOperationDetails({ env: { [CAPTURE_ENV_VAR]: 'SPAN_AND_EVENT' } }),
      false,
    );
  });

  it('is safe to call with no arguments', () => {
    assert.equal(emitOperationDetails(), false);
  });

  it('uses the event name Splunk keys on', () => {
    assert.equal(EVENT_NAME, 'gen_ai.client.inference.operation.details');
  });
});

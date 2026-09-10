'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  agentAttributes,
  agentName,
  DEFAULT_AGENT_NAME,
} = require('../agent-attributes');

describe('agentName', () => {
  it('falls back to the default when unset', () => {
    assert.equal(agentName({}), DEFAULT_AGENT_NAME);
  });

  it('honours GEN_AI_AGENT_NAME so sibling services differ', () => {
    assert.equal(agentName({ GEN_AI_AGENT_NAME: 'contract-reviewer' }), 'contract-reviewer');
  });

  it('ignores blank or non-string values rather than emitting an empty name', () => {
    assert.equal(agentName({ GEN_AI_AGENT_NAME: '   ' }), DEFAULT_AGENT_NAME);
    assert.equal(agentName({ GEN_AI_AGENT_NAME: 42 }), DEFAULT_AGENT_NAME);
  });

  it('trims surrounding whitespace', () => {
    assert.equal(agentName({ GEN_AI_AGENT_NAME: ' triage ' }), 'triage');
  });
});

describe('agentAttributes', () => {
  // The value Splunk keys the agent count on. If this changes, the AI
  // overview page silently returns to all-zeroes.
  it('marks the span as an agent invocation', () => {
    const attrs = agentAttributes({ env: {} });
    assert.equal(attrs['gen_ai.operation.name'], 'invoke_agent');
    assert.equal(attrs['gen_ai.agent.name'], DEFAULT_AGENT_NAME);
  });

  it('includes the provider when known', () => {
    const attrs = agentAttributes({ provider: 'openai', env: {} });
    assert.equal(attrs['gen_ai.provider.name'], 'openai');
  });

  it('omits the provider rather than emitting an empty one', () => {
    for (const provider of [undefined, '', '   ', null, 7]) {
      const attrs = agentAttributes({ provider, env: {} });
      assert.ok(!('gen_ai.provider.name' in attrs), String(provider));
    }
  });

  // gen_ai.agent.id is meant to be a provider-assigned stable identifier.
  // This agent is not provider-hosted, and a fabricated id would look
  // authoritative while correlating with nothing.
  it('never invents an agent id', () => {
    assert.ok(!('gen_ai.agent.id' in agentAttributes({ provider: 'openai', env: {} })));
  });

  it('is safe to call with no arguments', () => {
    assert.equal(agentAttributes()['gen_ai.operation.name'], 'invoke_agent');
  });
});

'use strict';

/**
 * Links nested GenAI calls to the agent and workflow that own them.
 *
 * WHY THIS EXISTS: Splunk does not infer which agent an LLM call belongs
 * to from span nesting. The reference implementation keeps an agent
 * context stack and copies `gen_ai.agent.name` and `gen_ai.agent.id` ONTO
 * EACH LLM SPAN (`_invocation.py`: "Inherit agent_name and agent_id from
 * agent context stack"). Those attributes are what let the agent screens
 * aggregate model calls, tokens and cost per agent.
 *
 * Without them you get what this project had: correct agent spans,
 * correct LLM spans, correct parent-child nesting, and an empty agents
 * list, because nothing tied the two together in a form the backend
 * reads.
 *
 * The identity is threaded through as an explicit argument rather than
 * hidden in OpenTelemetry context. Both work; the explicit version keeps
 * the data flow visible at every call site, and avoids restructuring
 * async blocks around a context binding.
 */

/**
 * Derive an agent id the way the reference implementation does: the
 * agent span's own id, 16 hex characters. It is stable for the life of
 * the invocation and correlates with the trace, which a random id would
 * not.
 *
 * @param {object} span
 * @returns {string|undefined}
 */
function agentIdFromSpan(span) {
  try {
    const ctx = span && typeof span.spanContext === 'function' ? span.spanContext() : null;
    return ctx && ctx.spanId ? ctx.spanId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Attributes a nested call copies from its enclosing agent and workflow.
 *
 * Returns an empty object when there is no owner, so callers can spread
 * the result unconditionally.
 *
 * @param {{ agentName?: string, agentId?: string, workflowName?: string }} [owner]
 * @returns {Record<string, string>}
 */
function inheritedAttributes(owner) {
  if (!owner || typeof owner !== 'object') return {};
  const attrs = {};
  if (typeof owner.agentName === 'string' && owner.agentName) {
    attrs['gen_ai.agent.name'] = owner.agentName;
  }
  if (typeof owner.agentId === 'string' && owner.agentId) {
    attrs['gen_ai.agent.id'] = owner.agentId;
  }
  if (typeof owner.workflowName === 'string' && owner.workflowName) {
    attrs['gen_ai.workflow.name'] = owner.workflowName;
  }
  return attrs;
}

module.exports = { agentIdFromSpan, inheritedAttributes };

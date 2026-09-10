'use strict';

/**
 * Agent-level GenAI attributes for the RAG pipeline span.
 *
 * WHY THIS EXISTS: Splunk's "APM > AI overview" page counts AGENTS, not
 * chat spans. Its Requests tile is documented as `count(agents)`, so with
 * no agent in the data every tile on the page reads zero even when AI
 * trace data is fully populated and evaluations are running. Measured on
 * this stack before the change: `sf.org.ai.numSpans` = 5 while
 * `sf.org.ai.numAgentsMonitored` = 0, and the whole overview page was zero.
 *
 * An LLM call on its own is not an agent. What makes this service an agent
 * is the pipeline: it retrieves context, decides what to send, and calls a
 * model. That pipeline span is therefore the honest place to declare it,
 * rather than relabelling the LLM call.
 *
 * The conventions for `invoke_agent` are in gen-ai-agent-spans:
 * `gen_ai.operation.name` SHOULD be `invoke_agent`, and the span name
 * SHOULD be `invoke_agent {gen_ai.agent.name}`. We set the attributes but
 * deliberately keep the existing span names (`chat.pipeline`,
 * `chat.pipeline.stream`), because both the Splunk dashboard and the Azure
 * workbook match on those names. If a backend turns out to need the
 * conventional span name too, that is a one-line change here plus a
 * dashboard update, and it should be made deliberately rather than as a
 * side effect of adding attributes.
 */

const DEFAULT_AGENT_NAME = 'hr-policy-assistant';

/** Human-readable agent name. Overridable so sibling services differ. */
function agentName(env) {
  const source = env || process.env;
  const configured = source.GEN_AI_AGENT_NAME;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim();
  }
  return DEFAULT_AGENT_NAME;
}

/**
 * Attributes marking a span as one agent invocation.
 *
 * `gen_ai.agent.id` is conditionally required "if applicable" and is meant
 * to be a provider-assigned identifier. This agent is not provider-hosted,
 * so an earlier version of this file omitted it on the grounds that a
 * fabricated id correlates with nothing.
 *
 * That was wrong in practice. Splunk's reference implementation defaults
 * the id to the agent span's own id in hex, and copies it onto every
 * nested LLM span, which is how its agent screens aggregate. An id derived
 * from the span is not fabricated: it correlates with the trace exactly.
 * Pass one from `agentIdFromSpan` in genai-context.js.
 *
 * @param {{ provider?: string, env?: NodeJS.ProcessEnv }} [args]
 * @returns {Record<string, string>}
 */
function agentAttributes({ provider, agentId, env } = {}) {
  const attrs = {
    'gen_ai.operation.name': 'invoke_agent',
    'gen_ai.agent.name': agentName(env),
    // The reference library records agent_type and framework alongside the
    // name, and the agent screens group by them.
    'gen_ai.agent.type': 'rag',
    'gen_ai.framework': 'in-house',
  };
  if (typeof provider === 'string' && provider.trim()) {
    attrs['gen_ai.provider.name'] = provider.trim();
  }
  if (typeof agentId === 'string' && agentId.trim()) {
    attrs['gen_ai.agent.id'] = agentId.trim();
  }
  return attrs;
}

/**
 * Conventional span name for an agent invocation.
 *
 * The conventions say the span name SHOULD be
 * `invoke_agent {gen_ai.agent.name}`. Adopting it renames what used to be
 * `chat.pipeline` / `chat.pipeline.stream`, so any dashboard query matching
 * those literals needs updating in the same change. The two HTTP routes
 * remain distinguishable by their parent `POST /api/chat` and
 * `POST /api/chat/stream` server spans.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function agentSpanName(env) {
  return 'invoke_agent ' + agentName(env);
}

module.exports = { agentAttributes, agentName, agentSpanName, DEFAULT_AGENT_NAME };

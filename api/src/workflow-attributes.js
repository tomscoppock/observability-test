'use strict';

/**
 * Workflow-level GenAI attributes: the top of the agentic hierarchy.
 *
 * Splunk's reference implementation models three nested levels, and its
 * own lifecycle checklist is explicit about the order:
 *
 *   Workflow          one per external request
 *     Agent           one per logical reasoning component
 *       LLM           one per model call
 *
 * This service had the agent and LLM levels but no workflow, which is the
 * level Splunk aggregates agent activity into. The distinction is not
 * academic for a single-agent RAG pipeline, but it becomes the whole
 * structure for a plan-act-reflect loop, where one request drives several
 * agents and the workflow is the only span that spans them.
 *
 * Naming follows the reference emitter: the span is `workflow {name}` and
 * carries `gen_ai.operation.name = invoke_workflow`. Note the asymmetry
 * with the agent level, whose span is `invoke_agent {name}` -- the prefix
 * is the operation for agents and the bare word "workflow" for workflows.
 * That is their convention, not a typo here.
 */

const DEFAULT_WORKFLOW_NAME = 'hr-policy-chat';

/** Workflow name. Overridable so sibling services differ. */
function workflowName(env) {
  const source = env || process.env;
  const configured = source.GEN_AI_WORKFLOW_NAME;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim();
  }
  return DEFAULT_WORKFLOW_NAME;
}

/** Span name for a workflow invocation: `workflow {name}`. */
function workflowSpanName(env) {
  return 'workflow ' + workflowName(env);
}

/**
 * Attributes marking a span as one workflow invocation.
 *
 * @param {{ workflowType?: string, framework?: string, env?: NodeJS.ProcessEnv }} [args]
 * @returns {Record<string, string>}
 */
function workflowAttributes({ workflowType, framework, env } = {}) {
  const attrs = {
    'gen_ai.operation.name': 'invoke_workflow',
    'gen_ai.workflow.name': workflowName(env),
  };
  if (workflowType) attrs['gen_ai.workflow.type'] = workflowType;
  if (framework) attrs['gen_ai.framework'] = framework;
  return attrs;
}

module.exports = {
  workflowAttributes,
  workflowName,
  workflowSpanName,
  DEFAULT_WORKFLOW_NAME,
};

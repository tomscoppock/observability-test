'use strict';

/**
 * Shared HTTP helpers for OpenAI-compatible and Azure OpenAI APIs.
 *
 * Azure OpenAI uses a different auth header (`api-key` instead of
 * `Authorization: Bearer`) and requires an `api-version` query
 * parameter.  This module detects Azure endpoints automatically and
 * builds the correct URL + headers for each provider.
 *
 * Detection: a base URL containing `.openai.azure.com` or
 * `.cognitiveservices.azure.com` is treated as Azure OpenAI.
 */

/**
 * Returns true when the base URL points to an Azure OpenAI endpoint.
 *
 * @param {string} baseUrl
 * @returns {boolean}
 */
function isAzure(baseUrl) {
  return /\.(openai\.azure\.com|cognitiveservices\.azure\.com)/i.test(baseUrl);
}

/**
 * Build the full request URL for an API call.
 *
 * For standard OpenAI:  `${baseUrl}/${path}`
 * For Azure OpenAI:     `${baseUrl}/${path}?api-version=${version}`
 *
 * @param {string} baseUrl  Base URL (may include /openai/deployments/{name})
 * @param {string} path     Path suffix, e.g. "embeddings" or "chat/completions"
 * @returns {string}
 */
function buildUrl(baseUrl, path) {
  // Strip trailing slash so we don't get double slashes
  const base = baseUrl.replace(/\/+$/, '');

  if (isAzure(base)) {
    const apiVersion = process.env.AZURE_API_VERSION || '2024-10-21';
    return `${base}/${path}?api-version=${apiVersion}`;
  }

  return `${base}/${path}`;
}

/**
 * Build request headers for an API call.
 *
 * For standard OpenAI:  `Authorization: Bearer <key>`
 * For Azure OpenAI:     `api-key: <key>`
 *
 * @param {string} baseUrl  Base URL (used to detect Azure)
 * @param {string} apiKey   API key / token
 * @returns {Record<string, string>}
 */
function buildHeaders(baseUrl, apiKey) {
  const headers = { 'Content-Type': 'application/json' };

  if (!apiKey) return headers;

  if (isAzure(baseUrl)) {
    headers['api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

module.exports = { isAzure, buildUrl, buildHeaders };

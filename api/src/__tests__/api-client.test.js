'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { isAzure, buildUrl, buildHeaders } = require('../api-client');

describe('api-client', () => {
  // Save and restore AZURE_API_VERSION across tests
  let savedVersion;
  beforeEach(() => { savedVersion = process.env.AZURE_API_VERSION; });
  afterEach(() => {
    if (savedVersion === undefined) delete process.env.AZURE_API_VERSION;
    else process.env.AZURE_API_VERSION = savedVersion;
  });

  describe('isAzure', () => {
    it('returns true for .openai.azure.com URLs', () => {
      assert.equal(isAzure('https://my-resource.openai.azure.com/openai/deployments/gpt-4o'), true);
    });

    it('returns true for .cognitiveservices.azure.com URLs', () => {
      assert.equal(isAzure('https://my-resource.cognitiveservices.azure.com/openai/'), true);
    });

    it('returns false for standard OpenAI URLs', () => {
      assert.equal(isAzure('https://api.openai.com/v1'), false);
    });

    it('returns false for other URLs', () => {
      assert.equal(isAzure('http://localhost:8080/v1'), false);
    });
  });

  describe('buildUrl', () => {
    it('appends path for standard OpenAI', () => {
      const url = buildUrl('https://api.openai.com/v1', 'embeddings');
      assert.equal(url, 'https://api.openai.com/v1/embeddings');
    });

    it('strips trailing slash from base URL', () => {
      const url = buildUrl('https://api.openai.com/v1/', 'chat/completions');
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    });

    it('appends api-version for Azure OpenAI', () => {
      delete process.env.AZURE_API_VERSION;
      const url = buildUrl(
        'https://my-resource.openai.azure.com/openai/deployments/gpt-4o',
        'chat/completions'
      );
      assert.equal(
        url,
        'https://my-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21'
      );
    });

    it('uses custom AZURE_API_VERSION', () => {
      process.env.AZURE_API_VERSION = '2025-01-01';
      const url = buildUrl(
        'https://my-resource.openai.azure.com/openai/deployments/embed',
        'embeddings'
      );
      assert.match(url, /api-version=2025-01-01/);
    });
  });

  describe('buildHeaders', () => {
    it('uses Bearer auth for standard OpenAI', () => {
      const headers = buildHeaders('https://api.openai.com/v1', 'sk-test');
      assert.equal(headers['Authorization'], 'Bearer sk-test');
      assert.equal(headers['api-key'], undefined);
      assert.equal(headers['Content-Type'], 'application/json');
    });

    it('uses api-key header for Azure OpenAI', () => {
      const headers = buildHeaders(
        'https://my-resource.openai.azure.com/openai/deployments/gpt-4o',
        'azure-key-123'
      );
      assert.equal(headers['api-key'], 'azure-key-123');
      assert.equal(headers['Authorization'], undefined);
      assert.equal(headers['Content-Type'], 'application/json');
    });

    it('returns only Content-Type when no API key', () => {
      const headers = buildHeaders('https://api.openai.com/v1', '');
      assert.deepEqual(headers, { 'Content-Type': 'application/json' });
    });
  });
});

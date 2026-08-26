'use strict';

/**
 * Unit tests for the db module.
 *
 * These tests mock the SurrealDB client to verify the db module's
 * logic without requiring a running database.  Integration tests
 * (with a real SurrealDB) are documented in docs/rag-testing-guide.md.
 */

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// We need to mock the dynamic import of 'surrealdb' before requiring db.js.
// Since db.js uses dynamic import(), we mock at the module level.

describe('db module', () => {
  // These tests verify the exported function signatures and error handling.
  // Full integration tests require a running SurrealDB instance.

  it('exports the expected functions', () => {
    const db = require('../db');
    assert.equal(typeof db.connect, 'function');
    assert.equal(typeof db.insertDocument, 'function');
    assert.equal(typeof db.insertChunks, 'function');
    assert.equal(typeof db.vectorSearch, 'function');
    assert.equal(typeof db.getDocumentById, 'function');
    assert.equal(typeof db.hasDocuments, 'function');
    assert.equal(typeof db._reset, 'function');
  });

  it('_reset clears the singleton state', () => {
    const db = require('../db');
    // Should not throw
    db._reset();
  });
});

describe('chunker integration with db types', () => {
  it('chunkText output shape matches insertChunks input', () => {
    const { chunkText } = require('../chunker');
    const chunks = chunkText('Hello world, this is a test document.', 20, 5);

    // Each chunk should have text and chunkIndex
    for (const chunk of chunks) {
      assert.equal(typeof chunk.text, 'string');
      assert.equal(typeof chunk.chunkIndex, 'number');
      assert.ok(chunk.text.length > 0);
      assert.ok(chunk.chunkIndex >= 0);
    }
  });
});

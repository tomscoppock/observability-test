'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { chunkText } = require('../chunker');

describe('chunkText', () => {
  it('returns empty array for empty string', () => {
    assert.deepEqual(chunkText(''), []);
  });

  it('returns empty array for null/undefined', () => {
    assert.deepEqual(chunkText(null), []);
    assert.deepEqual(chunkText(undefined), []);
  });

  it('returns single chunk for text shorter than chunkSize', () => {
    const result = chunkText('Hello world', 500, 50);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, 'Hello world');
    assert.equal(result[0].chunkIndex, 0);
  });

  it('chunks text into correct number of segments', () => {
    // 100 chars, chunkSize=30, overlap=10 => step=20
    // Chunks: 0-30, 20-50, 40-70, 60-90, 80-100 => 5 chunks
    const text = 'a'.repeat(100);
    const result = chunkText(text, 30, 10);
    assert.equal(result.length, 5);
  });

  it('respects chunk size', () => {
    const text = 'a'.repeat(200);
    const result = chunkText(text, 50, 10);
    // All chunks except possibly the last should be exactly chunkSize
    for (let i = 0; i < result.length - 1; i++) {
      assert.equal(result[i].text.length, 50);
    }
    // Last chunk can be shorter
    assert.ok(result[result.length - 1].text.length <= 50);
  });

  it('has sequential chunk indices starting from 0', () => {
    const text = 'a'.repeat(200);
    const result = chunkText(text, 50, 10);
    result.forEach((chunk, i) => {
      assert.equal(chunk.chunkIndex, i);
    });
  });

  it('uses default chunkSize=500 and overlap=50', () => {
    const text = 'a'.repeat(1000);
    const result = chunkText(text);
    // step = 500 - 50 = 450, so chunks at 0, 450, 900 => 3 chunks
    // chunk 0: 0-500, chunk 1: 450-950, chunk 2: 900-1000
    assert.equal(result.length, 3);
    assert.equal(result[0].text.length, 500);
    assert.equal(result[1].text.length, 500);
    assert.equal(result[2].text.length, 100);
  });

  it('throws on invalid chunkSize', () => {
    assert.throws(() => chunkText('hello', 0, 0), /chunkSize must be positive/);
    assert.throws(() => chunkText('hello', -1, 0), /chunkSize must be positive/);
  });

  it('throws on negative overlap', () => {
    assert.throws(() => chunkText('hello', 10, -1), /overlap must be non-negative/);
  });

  it('throws when overlap >= chunkSize', () => {
    assert.throws(() => chunkText('hello', 10, 10), /overlap must be less than chunkSize/);
    assert.throws(() => chunkText('hello', 10, 15), /overlap must be less than chunkSize/);
  });

  it('handles overlap of 0', () => {
    const text = 'a'.repeat(100);
    const result = chunkText(text, 25, 0);
    assert.equal(result.length, 4);
    result.forEach((chunk) => {
      assert.equal(chunk.text.length, 25);
    });
  });

  it('preserves text content across chunks', () => {
    const text = 'abcdefghij'; // 10 chars
    const result = chunkText(text, 4, 1);
    // step = 3, chunks: 0-4 "abcd", 3-7 "defg", 6-10 "ghij"
    assert.equal(result[0].text, 'abcd');
    assert.equal(result[1].text, 'defg');
    assert.equal(result[2].text, 'ghij');
  });
});

'use strict';

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Set up a mock LoggerProvider BEFORE importing the logger module.
// This avoids needing the full OTel SDK -- we intercept at the API level.
// ---------------------------------------------------------------------------

const { logs, SeverityNumber } = require('@opentelemetry/api-logs');

/** Collects emitted log records for assertion. */
const emittedRecords = [];

const mockLogger = {
  emit(record) {
    emittedRecords.push(record);
  },
};

const mockProvider = {
  getLogger(_name, _version) {
    return mockLogger;
  },
};

// Register our mock as the global logger provider.
logs.setGlobalLoggerProvider(mockProvider);

// Now import the module under test -- it will pick up our mock provider.
const logger = require('../logger');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('logger', () => {
  /** Capture stdout writes. */
  let stdoutWrites;
  let originalWrite;

  beforeEach(() => {
    emittedRecords.length = 0;
    stdoutWrites = [];
    originalWrite = process.stdout.write;
    process.stdout.write = (chunk, ...args) => {
      stdoutWrites.push(typeof chunk === 'string' ? chunk : chunk.toString());
      // Don't actually write during tests to keep output clean.
      return true;
    };
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it('info() emits a log record with severityText=INFO and severityNumber=9', () => {
    logger.info('test info message');

    assert.equal(emittedRecords.length, 1);
    const record = emittedRecords[0];
    assert.equal(record.severityText, 'INFO');
    assert.equal(record.severityNumber, SeverityNumber.INFO);
    assert.equal(record.body, 'test info message');
  });

  it('error() emits with severityText=ERROR and severityNumber=17', () => {
    logger.error('something broke');

    assert.equal(emittedRecords.length, 1);
    const record = emittedRecords[0];
    assert.equal(record.severityText, 'ERROR');
    assert.equal(record.severityNumber, SeverityNumber.ERROR);
    assert.equal(record.body, 'something broke');
  });

  it('custom attributes are included in the emitted log record', () => {
    logger.info('request handled', { method: 'GET', path: '/health', status: 200 });

    assert.equal(emittedRecords.length, 1);
    const record = emittedRecords[0];
    assert.deepEqual(record.attributes, {
      method: 'GET',
      path: '/health',
      status: 200,
    });
  });

  it('calling logger functions without an active span does not throw', () => {
    // No span context is active -- this must not throw.
    assert.doesNotThrow(() => {
      logger.debug('no span here');
      logger.info('still fine');
      logger.warn('warning without span');
      logger.error('error without span');
    });

    assert.equal(emittedRecords.length, 4);
  });

  it('message appears in stdout', () => {
    logger.info('hello stdout', { key: 'value' });

    assert.equal(stdoutWrites.length, 1);
    const line = stdoutWrites[0];
    // Should contain the level, message, and JSON attributes.
    assert.ok(line.includes('INFO'), `Expected INFO in: ${line}`);
    assert.ok(line.includes('hello stdout'), `Expected message in: ${line}`);
    assert.ok(line.includes('"key":"value"'), `Expected attributes in: ${line}`);
    // Should end with a newline.
    assert.ok(line.endsWith('\n'), 'Expected trailing newline');
  });
});

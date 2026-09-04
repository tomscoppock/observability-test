'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

// ---------------------------------------------------------------------------
// Minimal test harness -- creates an Express app with the admin router
// mounted at /api/admin. Tests focus on auth middleware behaviour which
// runs before any database calls.
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json());
  const adminRouter = require('../routes/admin');
  app.use('/api/admin', adminRouter);
  return app;
}

function request(server, method, path, options) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, `http://127.0.0.1:${server.address().port}`);
    const reqOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: options?.headers || {},
      timeout: 5000,
    };

    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = body; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (options?.body) {
      if (typeof options.body === 'string') {
        req.write(options.body);
      } else {
        req.write(JSON.stringify(options.body));
      }
    }

    req.end();
  });
}

describe('Admin routes -- authentication', () => {
  const originalPassword = process.env.ADMIN_PASSWORD;
  let server;

  afterEach(async () => {
    if (originalPassword !== undefined) {
      process.env.ADMIN_PASSWORD = originalPassword;
    } else {
      delete process.env.ADMIN_PASSWORD;
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  });

  it('returns 503 when ADMIN_PASSWORD is not set', async () => {
    delete process.env.ADMIN_PASSWORD;
    const app = createTestApp();
    server = app.listen(0);
    await new Promise((r) => server.on('listening', r));

    const res = await request(server, 'GET', '/api/admin/stats');
    assert.equal(res.status, 503);
    assert.ok(res.body.error.includes('Admin not configured'));
  });

  it('returns 401 when x-admin-key header is missing', async () => {
    process.env.ADMIN_PASSWORD = 'test-secret';
    const app = createTestApp();
    server = app.listen(0);
    await new Promise((r) => server.on('listening', r));

    const res = await request(server, 'GET', '/api/admin/stats');
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid admin password');
  });

  it('returns 401 when x-admin-key header is wrong', async () => {
    process.env.ADMIN_PASSWORD = 'test-secret';
    const app = createTestApp();
    server = app.listen(0);
    await new Promise((r) => server.on('listening', r));

    const res = await request(server, 'GET', '/api/admin/stats', {
      headers: { 'x-admin-key': 'wrong-password' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid admin password');
  });
});

describe('Admin routes -- input validation', () => {
  const originalPassword = process.env.ADMIN_PASSWORD;
  let server;

  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'test-secret';
  });

  afterEach(async () => {
    if (originalPassword !== undefined) {
      process.env.ADMIN_PASSWORD = originalPassword;
    } else {
      delete process.env.ADMIN_PASSWORD;
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  });

  it('POST /api/admin/import returns 400 when no file is provided', async () => {
    const app = createTestApp();
    server = app.listen(0);
    await new Promise((r) => server.on('listening', r));

    const res = await request(server, 'POST', '/api/admin/import', {
      headers: {
        'x-admin-key': 'test-secret',
        'Content-Type': 'application/json',
      },
    });
    // Should be 400 (no file) -- multer won't find a file in JSON body
    assert.equal(res.status, 400);
  });
});

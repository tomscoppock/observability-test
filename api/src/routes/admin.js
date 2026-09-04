'use strict';

/**
 * Admin routes for database management.
 *
 * All endpoints are gated by the ADMIN_PASSWORD env var.
 * Clients must send the password in the x-admin-key header.
 * If ADMIN_PASSWORD is not set, all endpoints return 503.
 */

const express = require('express');
const multer = require('multer');
const { trace } = require('@opentelemetry/api');
const logger = require('../logger');
const db = require('../db');

const router = express.Router();
const tracer = trace.getTracer('rag-api.admin', '0.1.0');

// Multer for JSON file import (in-memory, max 50 MB)
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
}).single('file');

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

/**
 * Validate the x-admin-key header against ADMIN_PASSWORD.
 * Returns 503 if ADMIN_PASSWORD is not configured.
 * Returns 401 if the header is missing or wrong.
 */
function requireAdminAuth(req, res, next) {
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(503).json({
      error: 'Admin not configured. Set ADMIN_PASSWORD in .env to enable admin features.',
    });
  }

  const providedKey = req.headers['x-admin-key'];

  if (!providedKey || providedKey !== adminPassword) {
    logger.warn('Admin auth failed', {
      method: req.method,
      path: req.originalUrl,
      hasKey: !!providedKey,
    });
    return res.status(401).json({ error: 'Invalid admin password' });
  }

  next();
}

// Apply auth to all admin routes
router.use(requireAdminAuth);

// ---------------------------------------------------------------------------
// GET /api/admin/stats
// ---------------------------------------------------------------------------

router.get('/stats', async (_req, res) => {
  return tracer.startActiveSpan('admin.getStats', async (span) => {
    try {
      const stats = await db.getStats();
      span.setStatus({ code: 1 });
      span.end();
      return res.json(stats);
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      span.end();
      logger.error('Failed to get stats', { error: err.message });
      return res.status(500).json({ error: 'Failed to get database stats' });
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/documents
// ---------------------------------------------------------------------------

router.get('/documents', async (_req, res) => {
  return tracer.startActiveSpan('admin.listDocuments', async (span) => {
    try {
      const documents = await db.listDocuments();
      span.setAttribute('db.results_count', documents.length);
      span.setStatus({ code: 1 });
      span.end();
      return res.json({ documents });
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      span.end();
      logger.error('Failed to list documents', { error: err.message });
      return res.status(500).json({ error: 'Failed to list documents' });
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/documents -- delete ALL documents and chunks
// ---------------------------------------------------------------------------

router.delete('/documents', async (_req, res) => {
  return tracer.startActiveSpan('admin.deleteAll', async (span) => {
    try {
      await db.deleteAllData();
      logger.info('All data deleted via admin endpoint');
      span.setStatus({ code: 1 });
      span.end();
      return res.json({ message: 'All documents and chunks deleted' });
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      span.end();
      logger.error('Failed to delete all data', { error: err.message });
      return res.status(500).json({ error: 'Failed to delete all data' });
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/documents/:id -- delete one document + its chunks
// ---------------------------------------------------------------------------

router.delete('/documents/:id', async (req, res) => {
  return tracer.startActiveSpan('admin.deleteDocument', async (span) => {
    try {
      const rid = req.params.id;
      span.setAttribute('db.document.id', rid);

      // Check the document exists first
      const doc = await db.getDocumentById(rid);
      if (!doc) {
        span.setStatus({ code: 1 });
        span.end();
        return res.status(404).json({ error: 'Document not found' });
      }

      await db.deleteDocument(rid);
      logger.info('Document deleted via admin endpoint', { id: rid });
      span.setStatus({ code: 1 });
      span.end();
      return res.json({ message: 'Document and its chunks deleted', id: rid });
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      span.end();
      logger.error('Failed to delete document', { id: req.params.id, error: err.message });
      return res.status(500).json({ error: 'Failed to delete document' });
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/export -- export all data as JSON download
// ---------------------------------------------------------------------------

router.get('/export', async (_req, res) => {
  return tracer.startActiveSpan('admin.export', async (span) => {
    try {
      const data = await db.exportAll();
      const filename = `rag-export-${new Date().toISOString().slice(0, 10)}.json`;

      span.setAttributes({
        'export.document_count': data.documents.length,
        'export.chunk_count': data.chunks.length,
      });

      logger.info('Database exported', {
        documentCount: data.documents.length,
        chunkCount: data.chunks.length,
      });

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      span.setStatus({ code: 1 });
      span.end();
      return res.json(data);
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      span.end();
      logger.error('Failed to export database', { error: err.message });
      return res.status(500).json({ error: 'Failed to export database' });
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/import -- import JSON file (full replace)
// ---------------------------------------------------------------------------

router.post('/import', (req, res) => {
  importUpload(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Import file too large. Maximum size is 50 MB.' });
      }
      return res.status(400).json({ error: 'File upload failed: ' + uploadErr.message });
    }

    return tracer.startActiveSpan('admin.import', async (span) => {
      try {
        if (!req.file) {
          span.setStatus({ code: 1 });
          span.end();
          return res.status(400).json({ error: 'No file provided. Upload a JSON file as "file" field.' });
        }

        // Parse the JSON file
        let data;
        try {
          data = JSON.parse(req.file.buffer.toString('utf-8'));
        } catch (parseErr) {
          span.setStatus({ code: 1 });
          span.end();
          return res.status(400).json({
            error: 'Invalid JSON file: ' + parseErr.message,
          });
        }

        // Validate structure
        if (!data.documents || !Array.isArray(data.documents)) {
          span.setStatus({ code: 1 });
          span.end();
          return res.status(400).json({
            error: 'Invalid export format: missing "documents" array',
          });
        }

        if (!data.chunks || !Array.isArray(data.chunks)) {
          span.setStatus({ code: 1 });
          span.end();
          return res.status(400).json({
            error: 'Invalid export format: missing "chunks" array',
          });
        }

        const result = await db.importAll(data);

        span.setAttributes({
          'import.document_count': result.documentCount,
          'import.chunk_count': result.chunkCount,
        });

        logger.info('Database imported via admin endpoint', result);
        span.setStatus({ code: 1 });
        span.end();
        return res.json({
          message: 'Database imported successfully',
          documentCount: result.documentCount,
          chunkCount: result.chunkCount,
        });
      } catch (err) {
        span.setStatus({ code: 2, message: err.message });
        span.recordException(err);
        span.end();
        logger.error('Failed to import database', { error: err.message });
        return res.status(500).json({ error: 'Failed to import database: ' + err.message });
      }
    });
  });
});

module.exports = router;

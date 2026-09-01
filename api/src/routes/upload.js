'use strict';

/**
 * File upload route.
 *
 * POST /api/upload -- accepts multipart/form-data with one or more text
 * files (.txt, .md).  Each file is chunked, embedded, and stored in
 * SurrealDB.  Every step is wrapped in an OTel span.
 */

const { Router } = require('express');
const multer = require('multer');
const { trace } = require('@opentelemetry/api');
const { chunkText } = require('../chunker');
const { embedTexts } = require('../embeddings');
const db = require('../db');
const logger = require('../logger');

const router = Router();
const tracer = trace.getTracer('rag-api.upload', '0.1.0');

// Multer config: memory storage, 5 MB limit, max 10 files
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const ALLOWED_EXTENSIONS = ['.txt', '.md'];

/**
 * Validate that a filename has an allowed extension.
 * @param {string} filename
 * @returns {boolean}
 */
function isAllowedFile(filename) {
  const ext = (filename || '').toLowerCase().split('.').pop();
  return ALLOWED_EXTENSIONS.includes(`.${ext}`);
}

router.post('/api/upload', upload.array('files', 10), async (req, res) => {
  return tracer.startActiveSpan('upload.pipeline', async (span) => {
    try {
      const files = req.files;

      if (!files || files.length === 0) {
        span.setStatus({ code: 2, message: 'No files provided' });
        span.end();
        return res.status(400).json({ error: 'No files provided' });
      }

      span.setAttribute('upload.file_count', files.length);
      logger.info('Upload started', { fileCount: files.length });

      const results = [];

      for (const file of files) {
        // Validate extension
        if (!isAllowedFile(file.originalname)) {
          logger.warn('Unsupported file type', { filename: file.originalname });
          results.push({
            filename: file.originalname,
            error: 'Unsupported file type. Accepted: .txt, .md',
          });
          continue;
        }

        // Validate non-empty
        if (!file.buffer || file.buffer.length === 0) {
          logger.warn('Empty file', { filename: file.originalname });
          results.push({
            filename: file.originalname,
            error: 'File is empty',
          });
          continue;
        }

        const text = file.buffer.toString('utf-8');
        const title = file.originalname.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');

        // Step 1: Chunk
        const chunks = await tracer.startActiveSpan('upload.chunk', async (chunkSpan) => {
          chunkSpan.setAttributes({
            'upload.filename': file.originalname,
            'upload.content_length': text.length,
          });
          const result = chunkText(text);
          chunkSpan.setAttribute('upload.chunk_count', result.length);
          chunkSpan.setStatus({ code: 1 });
          chunkSpan.end();
          return result;
        });

        logger.info('File chunked', {
          filename: file.originalname,
          contentLength: text.length,
          chunkCount: chunks.length,
        });

        // Step 2: Embed
        const chunkTexts = chunks.map((c) => c.text);
        const embeddings = await embedTexts(chunkTexts);

        // Step 3: Store in SurrealDB
        const doc = await db.insertDocument({
          title,
          filename: file.originalname,
          source_type: 'upload',
          content_length: text.length,
          chunk_count: chunks.length,
        });

        const chunksWithEmbeddings = chunks.map((c, i) => ({
          text: c.text,
          embedding: embeddings[i],
          chunkIndex: c.chunkIndex,
        }));

        await db.insertChunks(doc.id, chunksWithEmbeddings);

        logger.info('Document stored', {
          documentId: String(doc.id),
          title,
          chunkCount: chunks.length,
        });

        results.push({
          id: String(doc.id),
          title,
          filename: file.originalname,
          chunkCount: chunks.length,
        });
      }

      span.setAttribute('upload.documents_created', results.filter((r) => r.id).length);
      span.setStatus({ code: 1 });
      span.end();

      return res.json({ documents: results });
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      span.end();

      logger.error('Upload failed', { error: err.message, stack: err.stack });

      const msg = err.message || '';
      if (msg.includes('Embedding API')) {
        return res.status(503).json({ error: 'Embedding service unavailable: ' + msg });
      }
      if (
        msg.includes('SurrealDB') || msg.includes('connection') ||
        msg.includes('not allowed') || msg.includes('permission') ||
        msg.includes('Anonymous') || msg.includes('not authenticated')
      ) {
        return res.status(503).json({ error: 'Database service unavailable: ' + msg });
      }
      return res.status(500).json({ error: 'Upload failed: ' + msg });
    }
  });
});

module.exports = router;

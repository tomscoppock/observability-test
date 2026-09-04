'use strict';

/**
 * Vanilla JS chat client with drag-and-drop file upload.
 * Sends messages to POST /api/chat and files to POST /api/upload.
 */

const messagesEl = document.getElementById('messages');
const form = document.getElementById('chat-form');
const input = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

// ---------------------------------------------------------------------------
// Message display
// ---------------------------------------------------------------------------

/**
 * Append a message bubble to the chat.
 * @param {string} text - Message content (plain text or HTML if isHtml=true).
 * @param {'user'|'assistant'|'system'|'error'|'upload'} role
 * @param {boolean} [isHtml=false] - If true, set innerHTML instead of textContent.
 */
function appendMessage(text, role, isHtml) {
  var div = document.createElement('div');
  div.className = 'message ' + role;
  if (isHtml) {
    div.innerHTML = text;
  } else {
    div.textContent = text;
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

/**
 * Show a "thinking..." indicator and return a function to remove it.
 * @param {string} [text='Thinking...']
 * @returns {function} Call to remove the indicator.
 */
function showThinking(text) {
  var div = appendMessage(text || 'Thinking...', 'thinking');
  return function () {
    if (div.parentNode) div.parentNode.removeChild(div);
  };
}

/**
 * Format source citations as HTML.
 * @param {{ title: string, chunkIndex: number, score: number }[]} sources
 * @returns {string}
 */
function formatSources(sources) {
  if (!sources || sources.length === 0) return '';

  // De-duplicate by title
  var seen = {};
  var unique = [];
  for (var i = 0; i < sources.length; i++) {
    if (!seen[sources[i].title]) {
      seen[sources[i].title] = true;
      unique.push(sources[i]);
    }
  }

  var items = unique.map(function (s) {
    var score = typeof s.score === 'number' ? ' (' + (s.score * 100).toFixed(0) + '% match)' : '';
    return '<li>' + escapeHtml(s.title) + score + '</li>';
  });

  return '<div class="sources"><strong>Sources:</strong><ul>' + items.join('') + '</ul></div>';
}

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/**
 * Send the user's message to the API and display the response.
 * @param {string} message
 */
async function sendMessage(message) {
  appendMessage(message, 'user');
  input.value = '';
  sendBtn.disabled = true;
  var hideThinking = showThinking('Thinking...');

  console.log('[chat] Sending message:', message.substring(0, 80));

  try {
    var res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message }),
    });

    console.log('[chat] Response status:', res.status);

    if (!res.ok) {
      var errBody = await res.text();
      console.error('[chat] Error response body:', errBody);
      var err;
      try { err = JSON.parse(errBody); } catch (_e) { err = { error: res.statusText }; }
      throw new Error(err.error || 'HTTP ' + res.status);
    }

    var data = await res.json();
    console.log('[chat] Reply received, sources:', (data.sources || []).length);
    var replyHtml = escapeHtml(data.reply) + formatSources(data.sources);
    appendMessage(replyHtml, 'assistant', true);
  } catch (err) {
    console.error('[chat] Error:', err.message, err);
    appendMessage('Error: ' + err.message, 'error');
  } finally {
    hideThinking();
    sendBtn.disabled = false;
    input.focus();
  }
}

// ---------------------------------------------------------------------------
// File upload
// ---------------------------------------------------------------------------

/**
 * Upload files to the API.
 * @param {FileList|File[]} files
 */
async function uploadFiles(files) {
  if (!files || files.length === 0) return;

  var names = [];
  for (var i = 0; i < files.length; i++) {
    names.push(files[i].name);
  }
  console.log('[upload] Starting upload:', names.join(', '));
  appendMessage('Uploading ' + files.length + ' file(s): ' + names.join(', '), 'upload');
  var hideThinking = showThinking('Processing files...');

  try {
    var formData = new FormData();
    for (var j = 0; j < files.length; j++) {
      formData.append('files', files[j]);
    }

    var res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    console.log('[upload] Response status:', res.status);

    if (!res.ok) {
      var errBody = await res.text();
      console.error('[upload] Error response body:', errBody);
      var err;
      try { err = JSON.parse(errBody); } catch (_e) { err = { error: res.statusText }; }
      throw new Error(err.error || 'HTTP ' + res.status);
    }

    var data = await res.json();
    var docs = data.documents || [];
    var successCount = 0;
    var messages = [];

    for (var k = 0; k < docs.length; k++) {
      var doc = docs[k];
      if (doc.error) {
        console.warn('[upload] File error:', doc.filename, doc.error);
        messages.push(doc.filename + ': ' + doc.error);
      } else {
        successCount++;
        console.log('[upload] File indexed:', doc.filename, doc.chunkCount, 'chunks');
        messages.push(doc.filename + ': ' + doc.chunkCount + ' chunks indexed');
      }
    }

    var summary = successCount + ' of ' + docs.length + ' file(s) uploaded successfully.';
    console.log('[upload]', summary);
    appendMessage(summary + '\n' + messages.join('\n'), 'system');
  } catch (err) {
    console.error('[upload] Error:', err.message, err);
    appendMessage('Upload error: ' + err.message, 'error');
  } finally {
    hideThinking();
  }
}

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------

dropZone.addEventListener('dragover', function (e) {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', function (e) {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', function (e) {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('drag-over');
  uploadFiles(e.dataTransfer.files);
});

// Also allow the messages area to accept drops
messagesEl.addEventListener('dragover', function (e) {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

messagesEl.addEventListener('drop', function (e) {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  uploadFiles(e.dataTransfer.files);
});

// File input (browse button)
fileInput.addEventListener('change', function () {
  uploadFiles(fileInput.files);
  fileInput.value = '';
});

// ---------------------------------------------------------------------------
// Chat form
// ---------------------------------------------------------------------------

form.addEventListener('submit', function (e) {
  e.preventDefault();
  var text = input.value.trim();
  if (text) {
    sendMessage(text);
  }
});

// ---------------------------------------------------------------------------
// Scrape form
// ---------------------------------------------------------------------------

var scrapeForm = document.getElementById('scrape-form');
var scrapeUrlInput = document.getElementById('scrape-url');

if (scrapeForm) {
  scrapeForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var url = scrapeUrlInput.value.trim();
    if (!url) return;

    console.log('[scrape] Starting scrape:', url);
    appendMessage('Scraping: ' + url + '...', 'user');
    var hideThinking = showThinking('Fetching and processing page...');
    scrapeUrlInput.disabled = true;
    document.getElementById('scrape-btn').disabled = true;

    try {
      var res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url }),
      });

      console.log('[scrape] Response status:', res.status);

      if (!res.ok) {
        var errBody = await res.text();
        console.error('[scrape] Error response body:', errBody);
        var err;
        try { err = JSON.parse(errBody); } catch (_e) { err = { error: res.statusText }; }
        throw new Error(err.error || 'HTTP ' + res.status);
      }

      var data = await res.json();
      console.log('[scrape] Success:', data.title, data.chunkCount, 'chunks,', data.contentLength, 'bytes');

      appendMessage(
        'Scraped "' + escapeHtml(data.title) + '" -- ' +
        data.chunkCount + ' chunks stored (' +
        Math.round(data.contentLength / 1024) + ' KB). You can now ask questions about this page.',
        'system'
      );
      scrapeUrlInput.value = '';
    } catch (err) {
      console.error('[scrape] Error:', err.message, err);
      appendMessage('Scrape failed: ' + err.message, 'error');
    } finally {
      hideThinking();
      scrapeUrlInput.disabled = false;
      document.getElementById('scrape-btn').disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Test error button
// ---------------------------------------------------------------------------

var testErrorBtn = document.getElementById('test-error-btn');
if (testErrorBtn) {
  testErrorBtn.addEventListener('click', async function () {
    console.log('[test-error] Triggering test error...');
    appendMessage('Triggering test error for OTel verification...', 'system');

    try {
      var res = await fetch('/api/test-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Deliberate test error from UI at ' + new Date().toISOString() }),
      });

      console.log('[test-error] Response status:', res.status);
      var data = await res.json();
      console.log('[test-error] Response:', data);
      appendMessage('Test error sent (HTTP ' + res.status + '). Check Splunk APM for the error span.\nServer: ' + data.error, 'error');
    } catch (err) {
      console.error('[test-error] Network error:', err);
      appendMessage('Test error failed: ' + err.message, 'error');
    }
  });
}

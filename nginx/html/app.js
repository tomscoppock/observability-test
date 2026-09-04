'use strict';

/**
 * Vanilla JS chat client with drag-and-drop file upload and admin panel.
 * Sends messages to POST /api/chat and files to POST /api/upload.
 * Admin panel manages the knowledge base via /api/admin/* endpoints.
 */

var messagesEl = document.getElementById('messages');
var form = document.getElementById('chat-form');
var input = document.getElementById('message-input');
var sendBtn = document.getElementById('send-btn');
var dropZone = document.getElementById('drop-zone');
var fileInput = document.getElementById('file-input');

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

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

var tabBtns = document.querySelectorAll('.tab-btn');
var tabContents = document.querySelectorAll('.tab-content');

function switchTab(tabName) {
  for (var i = 0; i < tabBtns.length; i++) {
    if (tabBtns[i].getAttribute('data-tab') === tabName) {
      tabBtns[i].classList.add('active');
    } else {
      tabBtns[i].classList.remove('active');
    }
  }
  for (var j = 0; j < tabContents.length; j++) {
    if (tabContents[j].id === 'tab-' + tabName) {
      tabContents[j].classList.add('active');
    } else {
      tabContents[j].classList.remove('active');
    }
  }

  // Load admin data when switching to admin tab
  if (tabName === 'admin') {
    var key = sessionStorage.getItem('adminKey');
    if (key) {
      showAdminPanel();
      loadAdminData();
    }
  }
}

for (var t = 0; t < tabBtns.length; t++) {
  tabBtns[t].addEventListener('click', function () {
    switchTab(this.getAttribute('data-tab'));
  });
}

// ---------------------------------------------------------------------------
// Admin -- authentication
// ---------------------------------------------------------------------------

var adminLoginEl = document.getElementById('admin-login');
var adminPanelEl = document.getElementById('admin-panel');
var adminLoginForm = document.getElementById('admin-login-form');
var adminPasswordInput = document.getElementById('admin-password');
var adminLoginError = document.getElementById('admin-login-error');

function showAdminPanel() {
  adminLoginEl.hidden = true;
  adminPanelEl.hidden = false;
}

function showAdminLogin() {
  adminLoginEl.hidden = false;
  adminPanelEl.hidden = true;
  adminLoginError.hidden = true;
  adminPasswordInput.value = '';
}

/**
 * Fetch wrapper that adds the x-admin-key header.
 * On 401, clears the stored key and shows the login form.
 * On 503, shows a message that admin is not configured.
 */
async function adminFetch(url, options) {
  var key = sessionStorage.getItem('adminKey');
  if (!key) {
    showAdminLogin();
    throw new Error('Not authenticated');
  }

  options = options || {};
  options.headers = options.headers || {};
  options.headers['x-admin-key'] = key;

  var res = await fetch(url, options);

  if (res.status === 401) {
    sessionStorage.removeItem('adminKey');
    showAdminLogin();
    adminLoginError.textContent = 'Session expired. Please enter the password again.';
    adminLoginError.hidden = false;
    throw new Error('Invalid admin password');
  }

  if (res.status === 503) {
    var body = await res.json();
    throw new Error(body.error || 'Admin not configured');
  }

  return res;
}

// Login form
if (adminLoginForm) {
  adminLoginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var password = adminPasswordInput.value.trim();
    if (!password) return;

    adminLoginError.hidden = true;

    // Test the password by calling stats
    try {
      var res = await fetch('/api/admin/stats', {
        headers: { 'x-admin-key': password },
      });

      if (res.status === 401) {
        adminLoginError.textContent = 'Invalid password.';
        adminLoginError.hidden = false;
        return;
      }

      if (res.status === 503) {
        adminLoginError.textContent = 'Admin not configured. Set ADMIN_PASSWORD in .env.';
        adminLoginError.hidden = false;
        return;
      }

      if (!res.ok) {
        adminLoginError.textContent = 'Error: HTTP ' + res.status;
        adminLoginError.hidden = false;
        return;
      }

      // Success -- store the key and show the panel
      sessionStorage.setItem('adminKey', password);
      showAdminPanel();
      loadAdminData();
    } catch (err) {
      adminLoginError.textContent = 'Connection error: ' + err.message;
      adminLoginError.hidden = false;
    }
  });
}

// Logout button
var adminLogoutBtn = document.getElementById('admin-logout-btn');
if (adminLogoutBtn) {
  adminLogoutBtn.addEventListener('click', function () {
    sessionStorage.removeItem('adminKey');
    showAdminLogin();
  });
}

// ---------------------------------------------------------------------------
// Admin -- status messages
// ---------------------------------------------------------------------------

var adminStatusEl = document.getElementById('admin-status');

function showAdminStatus(message, type) {
  adminStatusEl.textContent = message;
  adminStatusEl.className = 'admin-status ' + (type || 'info');
  adminStatusEl.hidden = false;
  // Auto-hide after 5 seconds
  setTimeout(function () {
    adminStatusEl.hidden = true;
  }, 5000);
}

// ---------------------------------------------------------------------------
// Admin -- load data
// ---------------------------------------------------------------------------

async function loadAdminData() {
  await Promise.all([loadAdminStats(), loadDocumentList()]);
}

async function loadAdminStats() {
  try {
    var res = await adminFetch('/api/admin/stats');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    document.getElementById('stat-documents').textContent = data.documentCount;
    document.getElementById('stat-chunks').textContent = data.chunkCount;
  } catch (err) {
    console.error('[admin] Failed to load stats:', err.message);
  }
}

async function loadDocumentList() {
  var container = document.getElementById('admin-documents');
  try {
    var res = await adminFetch('/api/admin/documents');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    var docs = data.documents || [];

    if (docs.length === 0) {
      container.innerHTML = '<p class="admin-placeholder">No documents in the knowledge base.</p>';
      return;
    }

    var html = '<table class="admin-table">';
    html += '<thead><tr><th>Title</th><th>Source</th><th>Chunks</th><th>Created</th><th></th></tr></thead>';
    html += '<tbody>';
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      var docId = typeof doc.id === 'object' ? doc.id.id : String(doc.id).replace('documents:', '');
      var created = doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '--';
      html += '<tr>';
      html += '<td>' + escapeHtml(doc.title || '--') + '</td>';
      html += '<td>' + escapeHtml(doc.source_type || '--') + '</td>';
      html += '<td>' + (doc.chunk_count || 0) + '</td>';
      html += '<td>' + created + '</td>';
      html += '<td><button class="delete-btn" data-doc-id="' + escapeHtml(docId) + '">Delete</button></td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;

    // Attach delete handlers
    var deleteBtns = container.querySelectorAll('.delete-btn');
    for (var j = 0; j < deleteBtns.length; j++) {
      deleteBtns[j].addEventListener('click', function () {
        var id = this.getAttribute('data-doc-id');
        deleteDocument(id);
      });
    }
  } catch (err) {
    console.error('[admin] Failed to load documents:', err.message);
    container.innerHTML = '<p class="admin-placeholder">Failed to load documents.</p>';
  }
}

// ---------------------------------------------------------------------------
// Admin -- actions
// ---------------------------------------------------------------------------

async function deleteDocument(id) {
  if (!confirm('Delete this document and all its chunks?')) return;

  try {
    var res = await adminFetch('/api/admin/documents/' + encodeURIComponent(id), {
      method: 'DELETE',
    });
    if (!res.ok) {
      var body = await res.json();
      throw new Error(body.error || 'HTTP ' + res.status);
    }
    showAdminStatus('Document deleted.', 'success');
    await loadAdminData();
  } catch (err) {
    console.error('[admin] Delete failed:', err.message);
    showAdminStatus('Delete failed: ' + err.message, 'error');
  }
}

// Delete all
var deleteAllBtn = document.getElementById('admin-delete-all-btn');
if (deleteAllBtn) {
  deleteAllBtn.addEventListener('click', async function () {
    if (!confirm('Delete ALL documents and chunks? This cannot be undone.')) return;
    if (!confirm('Are you sure? This will wipe the entire knowledge base.')) return;

    try {
      var res = await adminFetch('/api/admin/documents', {
        method: 'DELETE',
      });
      if (!res.ok) {
        var body = await res.json();
        throw new Error(body.error || 'HTTP ' + res.status);
      }
      showAdminStatus('All data deleted.', 'success');
      await loadAdminData();
    } catch (err) {
      console.error('[admin] Delete all failed:', err.message);
      showAdminStatus('Delete all failed: ' + err.message, 'error');
    }
  });
}

// Export
var exportBtn = document.getElementById('admin-export-btn');
if (exportBtn) {
  exportBtn.addEventListener('click', async function () {
    try {
      showAdminStatus('Exporting...', 'info');
      var res = await adminFetch('/api/admin/export');
      if (!res.ok) throw new Error('HTTP ' + res.status);

      var blob = await res.blob();
      var filename = 'rag-export-' + new Date().toISOString().slice(0, 10) + '.json';

      // Trigger download
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);

      showAdminStatus('Export downloaded: ' + filename, 'success');
    } catch (err) {
      console.error('[admin] Export failed:', err.message);
      showAdminStatus('Export failed: ' + err.message, 'error');
    }
  });
}

// Import
var importFileInput = document.getElementById('admin-import-file');
if (importFileInput) {
  importFileInput.addEventListener('change', async function () {
    var file = this.files[0];
    if (!file) return;
    this.value = ''; // Reset so the same file can be re-selected

    if (!confirm('Import will REPLACE all existing data. Continue?')) return;

    try {
      showAdminStatus('Importing ' + file.name + '...', 'info');

      var formData = new FormData();
      formData.append('file', file);

      var key = sessionStorage.getItem('adminKey');
      var res = await fetch('/api/admin/import', {
        method: 'POST',
        headers: { 'x-admin-key': key },
        body: formData,
      });

      if (res.status === 401) {
        sessionStorage.removeItem('adminKey');
        showAdminLogin();
        throw new Error('Invalid admin password');
      }

      if (!res.ok) {
        var body = await res.json();
        throw new Error(body.error || 'HTTP ' + res.status);
      }

      var data = await res.json();
      showAdminStatus(
        'Imported ' + data.documentCount + ' documents and ' + data.chunkCount + ' chunks.',
        'success'
      );
      await loadAdminData();
    } catch (err) {
      console.error('[admin] Import failed:', err.message);
      showAdminStatus('Import failed: ' + err.message, 'error');
    }
  });
}

// Refresh button
var refreshBtn = document.getElementById('admin-refresh-btn');
if (refreshBtn) {
  refreshBtn.addEventListener('click', function () {
    loadAdminData();
  });
}

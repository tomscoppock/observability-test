'use strict';

/**
 * Vanilla JS chat client.
 * Sends messages to POST /api/chat and displays responses.
 */

const messagesEl = document.getElementById('messages');
const form = document.getElementById('chat-form');
const input = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');

/**
 * Append a message bubble to the chat.
 * @param {string} text - Message content.
 * @param {'user'|'assistant'|'system'|'error'} role - CSS class for styling.
 */
function appendMessage(text, role) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/**
 * Send the user's message to the API and display the response.
 * @param {string} message - The user's input text.
 */
async function sendMessage(message) {
  appendMessage(message, 'user');
  input.value = '';
  sendBtn.disabled = true;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    appendMessage(data.reply, 'assistant');
  } catch (err) {
    appendMessage(`Error: ${err.message}`, 'error');
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

// Event listeners
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (text) {
    sendMessage(text);
  }
});

import { registerOwner } from './send.js';

const $ = (s) => document.querySelector(s);
$('#create-passkey').addEventListener('click', async () => {
  const button = $('#create-passkey');
  button.disabled = true;
  $('#setup-status').textContent = 'Waiting for Face ID…';
  try {
    const r = await registerOwner($('#setup-code').value);
    $('#setup-code').value = '';
    $('#owner-passkey').value = r.ownerPasskey;
    $('#setup-result').hidden = false;
    $('#setup-status').textContent = r.next;
  } catch (error) {
    $('#setup-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$('#copy-owner').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#owner-passkey').value); $('#setup-status').textContent = 'Copied.'; }
  catch { $('#owner-passkey').select(); }
});

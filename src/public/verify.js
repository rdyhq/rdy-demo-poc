const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
window.history.replaceState(null, '', window.location.pathname);
const field = document.querySelector('#confirmation-token');
const button = document.querySelector('#confirm-access');
if (token && /^[a-f0-9]{64}$/.test(token)) {
  field.value = token;
  button.disabled = false;
} else {
  document.querySelector('#confirm-status').textContent = 'This link is not valid. Request a new sign-in link.';
}

// User-approved summaries only. Never persist an invite code on the device.
const form = document.querySelector('#feedback-form');
const status = document.querySelector('#result');
const button = document.querySelector('#send');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  button.disabled = true;
  status.textContent = 'Submitting for review…';
  const fields = {
    inviteCode: form.elements.invite.value,
    name: form.elements.name.value,
    project: form.elements.project.value,
    type: form.elements.type.value,
    summary: form.elements.summary.value,
    reasoning: form.elements.reasoning.value,
    outcome: form.elements.outcome.value,
    consent: form.elements.consent.checked
  };
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields), cache: 'no-store', credentials: 'omit'
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Not confirmed received.');
    status.textContent = 'Received for review. Receipt: ' + payload.id + '. No work has been authorized.';
    form.elements.invite.value = '';
    form.elements.summary.value = '';
    form.elements.reasoning.value = '';
    form.elements.outcome.value = '';
    form.elements.consent.checked = false;
  } catch (error) {
    status.textContent = (error && error.message) || 'Delivery not confirmed. Check before resubmitting.';
  } finally {
    button.disabled = false;
  }
});

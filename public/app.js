import { composeCommand } from './commands.js';

const $ = (selector) => document.querySelector(selector);
const crew = $('#crew');
let installPrompt;
let lastFocus;
function showDialog(id) {
  lastFocus = document.activeElement;
  $(id).showModal();
}
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.querySelector('.close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => lastFocus?.focus());
});
function message(text) { $('#app-message').textContent = text; }

// Boiler Bot V2 silhouette, visor, antenna and gauge from the reference SVG.
// Personalities are keyed by roster ID, never by activity or membership position.
// Every prop/movement is decorative. Unknown future agents get the same full seat.
const looks = {
  'claude': ['#ff9a50', '#da6730', 'coffee'],
  'claude-code': ['#ff736c', '#c64751', 'builder'],
  'claude-code (paperclip-vm)': ['#b7a0f8', '#7861b2', 'paper'],
  'codex': ['#5baaf7', '#3674b8', 'detective'],
  'astra': ['#ffd259', '#b78b2f', 'star'],
  'chatgpt': ['#65d7ab', '#339579', 'garden'],
  'muse': ['#f88ec6', '#b95296', 'music'],
  'grok': ['#ffb369', '#b87036', 'pilot'],
  'muse-blue': ['#7bdde6', '#3894a7', 'sleep']
};
function botSVG(color, shade, pose, index) {
  const props = {
    coffee: '<g class="prop cup"><path d="M20 15h4v4q-2 2-4 0z" fill="#fff9de" stroke="#8d542f" stroke-width=".4"/><path d="M24 16q3-1 2 1.5L24 18" fill="none" stroke="#8d542f" stroke-width=".6"/><path class="steam" d="M21 14q-1-1 0-2m2 2q-1-1 0-2" fill="none" stroke="#fff" stroke-width=".6"/></g>',
    builder: '<g class="prop wrench" fill="#e3eff2" stroke="#4b6981" stroke-width=".5"><path d="M21 17l2-5q-2-2 0-3l.3 2 1 .4 1-1.5q1 2-1 3l-1.5 4.5z"/></g><path d="M7 5q5-5 10 0v1H7z" fill="#ffda65" stroke="#b98331" stroke-width=".4"/>',
    paper: '<g class="prop papers"><path d="M20 13l6 1-1 7-6-1z" fill="#fff9e7" stroke="#8f7aaf" stroke-width=".4"/><path d="M21 15l3 .5m-3.3 1 3 .5m-3.3 1 2 .3" stroke="#9e8ab4" stroke-width=".4"/><path d="M22.5 13.7l.3-1q.5-1 1 0l-.7 3q-.6 1-1 0l.4-1.8" fill="none" stroke="#656289" stroke-width=".4"/></g>',
    detective: '<g class="prop magnifier"><path d="M22 17l-2 3" stroke="#435a84" stroke-width="1.2" stroke-linecap="round"/><circle cx="23" cy="15" r="2.6" fill="#c3f8ff" fill-opacity=".7" stroke="#f4f7f1" stroke-width="1"/><path d="M22 14l1.5-.5" stroke="white" stroke-width=".6" stroke-linecap="round"/></g>',
    star: '<g class="prop star"><path d="M23 9l1 2 2.3.4-1.7 1.5.4 2.4-2-1.1-2 1.1.4-2.4-1.7-1.5 2.3-.4z" fill="#fff8b0" stroke="#c79331" stroke-width=".4"/><path d="M23 15v5" stroke="#aa7c34" stroke-width=".7"/></g><path d="M8 4L7 1l4 2 2-2 2 2 3-1-1 3" fill="#fff3a5" stroke="#bc8d3e" stroke-width=".4"/>',
    garden: '<g class="prop plant"><path d="M20 17h5l-.6 4h-3.8z" fill="#ffae9c" stroke="#b76e58" stroke-width=".4"/><path d="M22.5 17v-5" stroke="#398560" stroke-width=".6"/><path d="M22.5 15q-4 0-3-3 3 0 3 3m0-1q0-4 3-3 1 3-3 3" fill="#57c77a"/></g>',
    music: '<path d="M6 8q0-8 6-8t6 8" fill="none" stroke="#665184" stroke-width="1.3"/><rect x="4.8" y="7" width="2" height="4" rx="1" fill="#665184"/><rect x="17.2" y="7" width="2" height="4" rx="1" fill="#665184"/><g class="prop notes" fill="#865185"><path d="M23 10v5h.7v-3l3-1v3h.7V9z"/><ellipse cx="22.4" cy="15.2" rx="1.3" ry=".8"/><ellipse cx="26.4" cy="14.2" rx="1.3" ry=".8"/></g>',
    pilot: '<g class="prop airplane"><path d="M20 11l9-2-3 6-2-2-2 2v-3z" fill="#fffbea" stroke="#8c7996" stroke-width=".4"/><path d="M22 12l7-3-5 4" fill="none" stroke="#8c7996" stroke-width=".3"/></g><path d="M6 5q6-5 12 0" fill="#92cbd9" stroke="#468196" stroke-width=".5"/>',
    sleep: '<g class="prop sleepy"><path d="M20 14h3l-3 3h3m1-7h3l-3 3h3" fill="none" stroke="#418397" stroke-width=".65" stroke-linecap="round"/></g><path d="M6 6q2-6 8-5l4 3q-6-1-8 2" fill="#819ce4" stroke="#526bac" stroke-width=".4"/><circle cx="18" cy="4" r="1.2" fill="#fff6d7"/>'
  }[pose] || '';
  const eyes = pose === 'sleep'
    ? '<path d="M8 9q1.5 1 3 0m2 0q1.5 1 3 0" fill="none" stroke="#c6fff2" stroke-width=".8" stroke-linecap="round"/>'
    : pose === 'music' || pose === 'garden'
    ? '<path d="M8 9.5q1.5-2 3 0m2 0q1.5-2 3 0" fill="none" stroke="#c6fff2" stroke-width=".8" stroke-linecap="round"/>'
    : '<rect x="7.8" y="8.2" width="3.6" height="1.6" rx=".8"/><rect x="12.6" y="8.2" width="3.6" height="1.6" rx=".8"/>';
  return `<svg viewBox="-3 -3 34 33" aria-hidden="true" focusable="false">
    <defs><linearGradient id="bot-${index}" x2=".8" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="${shade}"/></linearGradient></defs>
    <ellipse class="bot-shadow" cx="12" cy="26" rx="10" ry="1.5" fill="#4b7e851f"/>
    <g class="robot">
      <g class="bot-antenna"><path d="M12 4.4V2.8" stroke="#455c68" stroke-width="1.1" stroke-linecap="round"/><circle cx="12" cy="2.2" r="1.1" fill="#fff2b2" stroke="${shade}" stroke-width=".35"/></g>
      <path d="M9.6 20v2.5m4.8-2.5v2.5M8.2 23h2.8m2.1 0h2.8" stroke="${shade}" stroke-width="2.2" stroke-linecap="round"/>
      <g class="bot-arm arm-left"><path d="M5 12.2l-2.2 2" stroke="${shade}" stroke-width="2.3" stroke-linecap="round"/><circle cx="2.7" cy="14.3" r="1.3" fill="${color}"/></g>
      <g class="bot-arm arm-right"><path d="M19 12.2l2 2" stroke="${shade}" stroke-width="2.3" stroke-linecap="round"/><circle cx="21.3" cy="14.3" r="1.3" fill="${color}"/></g>
      <rect x="4.6" y="4.5" width="14.8" height="15.5" rx="7.4" fill="url(#bot-${index})" stroke="${shade}" stroke-width=".35"/>
      <path d="M6.2 7.4Q7.2 6.3 8.7 6.3" stroke="white" stroke-width=".8" fill="none" opacity=".65" stroke-linecap="round"/>
      <rect x="6.6" y="6.4" width="10.8" height="5.4" rx="2.7" fill="#253d54" stroke="${shade}" stroke-width=".3"/>
      <path d="M8 7.2h5" stroke="white" stroke-width=".3" opacity=".3"/>
      <g class="bot-eyes" fill="#c6fff2">${eyes}</g>
      <path d="M10.6 10.5q1.4 1 2.8 0" fill="none" stroke="#c6fff2" stroke-width=".45" stroke-linecap="round"/>
      <path d="M7.2 13.3v1m0 .7v1m0 .7v1" stroke="${shade}" stroke-width=".6" stroke-linecap="round"/>
      <path d="M8 12.8h8" stroke="white" stroke-width=".3" opacity=".5"/>
      <circle cx="12" cy="15.3" r="1.9" fill="#fff8da" stroke="${shade}" stroke-width=".6"/><path d="M12 15.3l.9-1" stroke="#476679" stroke-width=".6" stroke-linecap="round"/><circle cx="12" cy="15.3" r=".35" fill="#476679"/>
      ${props}
    </g>
  </svg>`;
}

async function loadCrew() {
  try {
    const response = await fetch('./crew.json');
    if (!response.ok) throw new Error('Roster unavailable');
    const data = await response.json();
    if (!Array.isArray(data.agents) || !data.agents.length) throw new Error('Roster is empty');
    const fragment = document.createDocumentFragment();
    data.agents.forEach((agent, index) => {
      const button = document.createElement('button');
      button.className = 'crew-member';
      button.style.setProperty('--delay', `${-index * .49}s`);
      button.dataset.agent = agent.id;
      button.setAttribute('aria-label', `${agent.name}, activity unknown. View crew details`);
      // Only fixed SVG geometry and developer-owned palette enter innerHTML.
      const [color, shade, pose] = looks[agent.id] || ['#a6c8ea', '#628caf', 'coffee'];
      button.dataset.personality = pose;
      button.innerHTML = botSVG(color, shade, pose, index);
      const name = document.createElement('span'); name.className = 'crew-name'; name.textContent = agent.name;
      const detail = document.createElement('span'); detail.className = 'crew-detail'; detail.textContent = agent.subtitle || 'Crew member';
      button.append(name, detail);
      button.addEventListener('click', () => {
        $('#crew-title').textContent = agent.name;
        $('#crew-role').textContent = agent.role;
        $('#crew-status').textContent = 'Activity: unknown. This room keeps every crew member visible, whether working or idle. The animation is for fun.';
        $('#crew-source').textContent = `Listed in ${agent.sources.join(' and ')}. Roster snapshot: ${new Date(data.syncedAt).toLocaleString()}.`;
        showDialog('#crew-dialog');
      });
      fragment.append(button);
    });
    crew.replaceChildren(fragment);
    $('#crew-count').textContent = `${data.agents.length} crew · everyone's here`;
    $('#roster-date').textContent = `Roster: ${new Date(data.syncedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  } catch (error) {
    $('#crew-count').textContent = 'Roster unavailable';
    message('Could not load the crew. Reconnect and reload.');
  }
}

document.querySelectorAll('[data-command]').forEach((button) => {
  button.addEventListener('click', () => {
    try {
      $('#command-output').value = composeCommand(button.dataset.command, $('#command-input').value);
      $('#command-title').textContent = {check:'CHECK COMS',react:'REACT',review:'REVIEW AND BREAK DOWN'}[button.dataset.command];
      $('#copy-status').textContent = '';
      message('');
      showDialog('#command-dialog');
    } catch (error) { message(error.message); $('#command-input').focus(); }
  });
});
$('#copy-command').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#command-output').value);
    $('#copy-status').textContent = 'Copied. Paste it into your agent. Nothing has been sent automatically.';
  } catch {
    $('#command-output').focus(); $('#command-output').select();
    $('#copy-status').textContent = 'Copy permission is unavailable. The command is selected; use Copy.';
  }
});

let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
function motionState() {
  document.body.classList.toggle('motion-paused', paused);
  $('#motion-toggle').setAttribute('aria-pressed', String(paused));
  $('#motion-toggle').textContent = paused ? 'Resume motion' : 'Pause motion';
}
$('#motion-toggle').addEventListener('click', () => { paused = !paused; motionState(); });
motionState();

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault(); installPrompt = event; $('#native-install').hidden = false;
});
$('#install-help').addEventListener('click', () => showDialog('#install-dialog'));
$('#native-install').addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  $('#install-state').textContent = choice.outcome === 'accepted' ? 'Installation accepted.' : 'You can install whenever you like.';
  installPrompt = undefined; $('#native-install').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#install-help').hidden = true; });
if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('#install-help').hidden = true;
function connectivity() {
  $('#connection-state').textContent = navigator.onLine ? 'Local command console' : 'Offline · room available';
  $('#offline-note').textContent = navigator.onLine ? '' : 'GitHub needs a connection.';
}
window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity); connectivity();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    $('#offline-note').textContent = 'Offline saving unavailable. You can still use the console online.';
  });
} else {
  $('#offline-note').textContent = 'Offline saving is unavailable in this browser.';
}
loadCrew();

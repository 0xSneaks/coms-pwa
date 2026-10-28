import { composeCommand } from './commands.js';
import { MAX_SEND, sendOrder } from './send.js';

const $ = (selector) => document.querySelector(selector);
const crew = $('#crew');
let installPrompt;
let current = { kind: 'check', text: '' };
let lastFocus;
function showDialog(id) {
  lastFocus = document.activeElement;
  $(id).showModal();
}
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.querySelector('.close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => lastFocus?.focus());
});
// Toasts clear themselves (and on typing) so an old warning never sits over new text.
let messageTimer;
function message(text) {
  clearTimeout(messageTimer);
  $('#app-message').textContent = text;
  if (text) messageTimer = setTimeout(() => { $('#app-message').textContent = ''; }, 4000);
}

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
      current = { kind: button.dataset.command, text: $('#command-input').value.trim() };
      $('#send-status').textContent = current.text.length > MAX_SEND
        ? `Send takes up to ${MAX_SEND.toLocaleString()} characters; Copy works for this one.` : '';
      $('#send-command').disabled = !navigator.onLine;
      $('#command-title').textContent = {check:'CHECK COMS',react:'REACT',review:'REVIEW AND BREAK DOWN',run:'RUN THE CREW'}[button.dataset.command];
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

$('#send-command').addEventListener('click', async () => {
  const button = $('#send-command');
  const status = $('#send-status');
  button.disabled = true;
  status.textContent = 'Waiting for Face ID…';
  try {
    const r = await sendOrder(current);
    status.replaceChildren(document.createTextNode(r.boardUpdated
      ? `Sent to the crew${r.repaired ? ' (board line added on retry)' : ''}. It is in every agent's inbox. `
      : `Saved as ${r.orderPath || 'an order file'}, but NOT on the board yet, so agents won't see it. Don't tap Send again (that makes a second order); ask an agent to add the board line. `));
    const link = r.commitUrl || r.orderUrl;
    if (link && link.startsWith('https://github.com/')) {
      const a = document.createElement('a');
      a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'View on GitHub ↗';
      status.append(a);
    }
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = !navigator.onLine;
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

/* ================= Animation layer =================
   Decorative only: tap reactions, ambient room life, character skits,
   a send celebration and typing attention. Every loop checks the shared
   `paused` flag and document visibility before starting anything, and
   all matching CSS lives under the same .motion-paused / reduced-motion
   rules as the rest of the room. Skit overlays are pointer-events:none
   and aria-hidden; none of this touches the send path. */
const world = $('#world');
const rand = (min, max) => min + Math.random() * (max - min);
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const motionOK = () => !paused && !document.hidden;
const members = () => [...crew.querySelectorAll('.crew-member')];
const memberById = (id) => members().find((m) => m.dataset.agent === id);
function relRect(el) {
  const w = world.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - w.left, y: r.top - w.top, w: r.width, h: r.height, cx: r.left - w.left + r.width / 2, cy: r.top - w.top + r.height / 2 };
}
async function classSkit(member, cls, ms) {
  if (!member) return;
  member.classList.add(cls);
  await wait(ms);
  member.classList.remove(cls);
}

/* --- Tap reaction: rides alongside the crew-details dialog, never blocks it --- */
crew.addEventListener('click', (event) => {
  const member = event.target.closest('.crew-member');
  if (!member) return;
  member.classList.remove('reacting');
  void member.offsetWidth;
  member.classList.add('reacting');
  setTimeout(() => member.classList.remove('reacting'), 950);
});

/* --- Ambient sparkles --- */
{
  const layer = document.createElement('div');
  layer.className = 'sparkle-layer';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 12; i++) {
    const s = document.createElement('span');
    const size = rand(3, 6);
    s.style.left = `${rand(2, 98)}%`;
    s.style.top = `${rand(6, 64)}%`;
    s.style.width = `${size}px`;
    s.style.height = `${size}px`;
    s.style.animationDuration = `${rand(5, 11)}s`;
    s.style.animationDelay = `${-rand(0, 8)}s`;
    if (i % 3 === 0) s.className = 'pale';
    layer.append(s);
  }
  world.append(layer);
}

/* --- Cross-room paper plane --- */
const plane = document.createElement('div');
plane.className = 'room-plane';
plane.setAttribute('aria-hidden', 'true');
plane.innerHTML = '<span class="plane-bob"><svg viewBox="0 0 30 18" width="30" height="18" focusable="false"><path d="M1 9L29 1L20 17L16 11Z" fill="#fffbea" stroke="#8c7996" stroke-width="1"/><path d="M16 11L29 1" fill="none" stroke="#8c7996" stroke-width=".7"/></svg></span>';
world.append(plane);
plane.addEventListener('animationend', (event) => {
  if (event.animationName === 'plane-cross') plane.classList.remove('flying');
});
(function flyPlane() {
  setTimeout(() => {
    if (motionOK()) plane.classList.add('flying');
    flyPlane();
  }, rand(18000, 30000));
  setTimeout(() => { if (motionOK()) plane.classList.add('flying'); }, rand(5000, 9000));
})();

/* --- Random hello waves --- */
(function waveLoop() {
  setTimeout(() => {
    if (motionOK()) {
      const awake = members().filter((m) => m.dataset.personality !== 'sleep');
      if (awake.length) {
        const m = pickOne(awake);
        m.classList.add('waving');
        setTimeout(() => m.classList.remove('waving'), 1650);
      }
    }
    waveLoop();
  }, rand(10000, 20000));
})();

/* --- Typing attention --- */
{
  const input = $('#command-input');
  let typeTimer;
  input.addEventListener('input', () => {
    if ($('#app-message').textContent) message('');
    document.body.classList.add('typing');
    clearTimeout(typeTimer);
    typeTimer = setTimeout(() => document.body.classList.remove('typing'), 1500);
  });
  input.addEventListener('blur', () => {
    clearTimeout(typeTimer);
    document.body.classList.remove('typing');
  });
}

/* --- Send celebration (send.js dispatches 'coms:order-sent' on success) --- */
window.addEventListener('coms:order-sent', () => {
  if (!motionOK()) return;
  members().forEach((m, i) => m.style.setProperty('--hop-delay', `${i * 55}ms`));
  world.classList.remove('celebrate');
  void world.offsetWidth;
  world.classList.add('celebrate');
  setTimeout(() => world.classList.remove('celebrate'), 1700);
  const burst = document.createElement('div');
  burst.className = 'sparkle-burst';
  burst.setAttribute('aria-hidden', 'true');
  world.append(burst);
  for (let i = 0; i < 10; i++) {
    const s = document.createElement('span');
    burst.append(s);
    const angle = (i / 10) * Math.PI * 2 + rand(-.2, .2);
    const dist = rand(60, 130);
    const anim = s.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist - 20}px)) scale(.4)`, opacity: 0 }
    ], { duration: rand(700, 1100), easing: 'cubic-bezier(.17,.67,.35,1)' });
    anim.onfinish = () => s.remove();
  }
  setTimeout(() => burst.remove(), 1400);
});

/* --- Skit props: created once per member, shown by CSS during the skit --- */
const MEGAPHONE_SVG = '<svg viewBox="0 0 48 34" focusable="false"><path d="M16 12L38 5v24L16 22Z" fill="#ffcb65" stroke="#b46a30" stroke-width="1.5"/><rect x="8" y="12" width="8" height="10" rx="2" fill="#e4572e"/><path d="M11 22v6h5v-6" fill="#e4572e"/><path class="mega-arc a1" d="M41 10q5 7 0 14" fill="none" stroke="#e4572e" stroke-width="2" stroke-linecap="round"/><path class="mega-arc a2" d="M44 7q7 10 0 20" fill="none" stroke="#e4572e" stroke-width="2" stroke-linecap="round"/></svg>';
const LAPTOP_SVG = '<svg viewBox="0 0 56 38" focusable="false"><rect x="9" y="3" width="38" height="26" rx="3" fill="#35506b"/><rect x="12" y="6" width="32" height="20" rx="2" fill="#cfeeff"/><path d="M15 11h14M15 16h20M15 21h10" stroke="#5b87a8" stroke-width="2" stroke-linecap="round"/><path d="M5 33h46l-5-4H10Z" fill="#7b93a8"/></svg>';
const BARBELL_SVG = '<svg viewBox="0 0 84 26" focusable="false"><rect x="1" y="11" width="82" height="4" rx="2" fill="#5a6b76"/><rect x="9" y="3" width="7" height="20" rx="2.5" fill="#c64751"/><rect x="18" y="6" width="6" height="14" rx="2" fill="#7a3542"/><rect x="68" y="3" width="7" height="20" rx="2.5" fill="#c64751"/><rect x="60" y="6" width="6" height="14" rx="2" fill="#7a3542"/></svg>';
function ensureProp(member, cls, html) {
  let el = member.querySelector(`.skit-prop.${cls}`);
  if (!el) {
    el = document.createElement('span');
    el.className = `skit-prop ${cls}`;
    el.setAttribute('aria-hidden', 'true');
    if (html) el.innerHTML = html;
    member.append(el);
  }
  return el;
}
function ensureSheets(member) {
  if (member.querySelector('.sheet')) return;
  for (let i = 1; i <= 4; i++) {
    const s = document.createElement('span');
    s.className = `skit-prop sheet sh${i}`;
    s.setAttribute('aria-hidden', 'true');
    if (i === 4) {
      const stamp = document.createElement('span');
      stamp.className = 'stamp';
      stamp.textContent = 'FILED';
      s.append(stamp);
    }
    member.append(s);
  }
}

/* --- Paper-ball throws (the argument skit) --- */
function throwBall(fromMember, toMember) {
  if (!fromMember || !toMember) return;
  const a = relRect(fromMember);
  const b = relRect(toMember);
  const x1 = a.cx + (b.cx > a.cx ? a.w * .3 : -a.w * .3);
  const y1 = a.y + a.h * .3;
  const x2 = b.cx;
  const y2 = b.y + b.h * .32;
  const ball = document.createElement('span');
  ball.className = 'paper-ball';
  ball.setAttribute('aria-hidden', 'true');
  world.append(ball);
  const anim = ball.animate([
    { transform: `translate(${x1}px, ${y1}px) rotate(0deg)`, opacity: 1 },
    { transform: `translate(${(x1 + x2) / 2}px, ${Math.min(y1, y2) - 48}px) rotate(210deg)`, opacity: 1, offset: .55 },
    { transform: `translate(${x2}px, ${y2}px) rotate(350deg)`, opacity: 1 },
    { transform: `translate(${x2}px, ${y2 + 16}px) rotate(380deg)`, opacity: 0 }
  ], { duration: 720, easing: 'ease-out' });
  anim.onfinish = () => ball.remove();
  setTimeout(() => {
    toMember.classList.add('duck');
    setTimeout(() => toMember.classList.remove('duck'), 600);
  }, 600);
}

/* --- Walkers: a member's SVG clone that can leave its seat --- */
function makeWalker(member) {
  const svg = member.querySelector('svg');
  if (!svg) return null;
  const seat = relRect(svg);
  const el = document.createElement('div');
  el.className = 'room-walker';
  el.setAttribute('aria-hidden', 'true');
  el.style.width = `${seat.w}px`;
  el.style.height = `${seat.h}px`;
  el.append(svg.cloneNode(true));
  const anger = document.createElement('span');
  anger.className = 'anger-mark';
  anger.textContent = '💢';
  el.append(anger);
  el._pos = { x: seat.x, y: seat.y };
  el.style.transform = `translate(${seat.x}px, ${seat.y}px)`;
  world.append(el);
  member.classList.add('seat-empty');
  return { el, seat: { x: seat.x, y: seat.y }, member };
}
function animateWalkerTo(el, p, dur) {
  const from = { ...el._pos };
  el._pos = p;
  const anim = el.animate([
    { transform: `translate(${from.x}px, ${from.y}px)` },
    { transform: `translate(${p.x}px, ${p.y}px)` }
  ], { duration: dur, easing: 'ease-in-out', fill: 'forwards' });
  return anim.finished.then(() => {
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    anim.cancel();
  }).catch(() => { el.style.transform = `translate(${p.x}px, ${p.y}px)`; });
}
function frontOf(target, walkerEl) {
  const w = world.getBoundingClientRect();
  const t = target.getBoundingClientRect();
  const ew = walkerEl.offsetWidth;
  const eh = walkerEl.offsetHeight;
  return {
    x: Math.max(4, Math.min(w.width - ew - 4, t.left - w.left + t.width / 2 - ew / 2)),
    y: Math.max(4, Math.min(w.height - eh - 4, t.top - w.top + t.height - eh + 12))
  };
}
function dustPuffs(pos, width) {
  for (let i = 0; i < 3; i++) {
    const d = document.createElement('span');
    d.className = 'dust-puff';
    d.setAttribute('aria-hidden', 'true');
    d.style.left = `${pos.x + width * .3 + i * 10}px`;
    d.style.top = `${pos.y + 34 + i * 6}px`;
    world.append(d);
    const anim = d.animate([
      { transform: 'scale(.4)', opacity: .7 },
      { transform: 'scale(1.5) translate(-6px, -4px)', opacity: 0 }
    ], { duration: 600 + i * 120, easing: 'ease-out' });
    anim.onfinish = () => d.remove();
  }
}

/* ================= Character skits ================= */
/* (a) ARGUMENT — Muse throws a paper ball at ChatGPT; sometimes he throws back */
async function skitArgue() {
  const muse = memberById('muse');
  const gpt = memberById('chatgpt');
  if (!muse || !gpt) return;
  muse.classList.add('skit-argue');
  gpt.classList.add('skit-argue');
  await wait(500);
  throwBall(muse, gpt);
  if (Math.random() < .3) {
    await wait(950);
    throwBall(gpt, muse);
  }
  await wait(1500);
  muse.classList.remove('skit-argue');
  gpt.classList.remove('skit-argue');
}
/* (b) MEGAPHONE — Claude makes an announcement */
async function skitMegaphone() {
  const claude = memberById('claude');
  if (!claude) return;
  ensureProp(claude, 'megaphone', MEGAPHONE_SVG);
  await classSkit(claude, 'skit-announce', 2200);
}
/* (c) LAPTOP — Claude Code settles in behind his laptop */
async function skitLaptop() {
  const cc = memberById('claude-code');
  if (!cc) return;
  ensureProp(cc, 'laptop', LAPTOP_SVG);
  await classSkit(cc, 'skit-working', 4000);
}
/* (d) MAKE IT RAIN — Grok, gleefully */
async function skitRain() {
  const grok = memberById('grok');
  if (!grok) return;
  const r = relRect(grok);
  const n = 10 + Math.floor(Math.random() * 5);
  for (let i = 0; i < n; i++) {
    const bill = document.createElement('span');
    bill.className = 'rain-bill';
    bill.setAttribute('aria-hidden', 'true');
    bill.textContent = '$';
    bill.style.left = `${r.cx + rand(-56, 56)}px`;
    bill.style.top = `${r.y + 8}px`;
    world.append(bill);
    const fall = rand(180, 260);
    const sway = rand(-24, 24);
    const rot = rand(-40, 40);
    const anim = bill.animate([
      { transform: 'translate(-50%, 0) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${sway}px), ${fall * .55}px) rotate(${rot * .6}deg)`, opacity: 1, offset: .55 },
      { transform: `translate(calc(-50% + ${sway * -.5}px), ${fall}px) rotate(${rot}deg)`, opacity: 0 }
    ], { duration: rand(1400, 2200), delay: rand(0, 650), easing: 'ease-in', fill: 'backwards' });
    anim.onfinish = () => bill.remove();
  }
  await classSkit(grok, 'skit-rain', 2600);
}
/* (e) BENCH PRESS — Astra puts in the reps */
async function skitBench() {
  const astra = memberById('astra');
  if (!astra) return;
  ensureProp(astra, 'barbell', BARBELL_SVG);
  await classSkit(astra, 'skit-lift', 3000);
}
/* (f) NAIL BITER — Codex is worried about the review */
async function skitNailBiter() {
  const codex = memberById('codex');
  if (!codex) return;
  ensureProp(codex, 'sweat', '');
  await classSkit(codex, 'skit-nervous', 2200);
}
/* (g) CONDUCTOR — Muse leads the room like an orchestra */
function floatNotes(member) {
  const c = relRect(member);
  ['♪', '♩', '♪'].forEach((ch, i) => {
    setTimeout(() => {
      if (!motionOK()) return;
      const note = document.createElement('span');
      note.className = 'float-note';
      note.setAttribute('aria-hidden', 'true');
      note.textContent = ch;
      note.style.left = `${c.cx + (i - 1) * 16}px`;
      note.style.top = `${c.y + 4}px`;
      world.append(note);
      const anim = note.animate([
        { transform: 'translate(-50%, 0)', opacity: 0 },
        { transform: 'translate(-50%, -18px)', opacity: 1, offset: .3 },
        { transform: 'translate(-50%, -48px)', opacity: 0 }
      ], { duration: 1500, easing: 'ease-out' });
      anim.onfinish = () => note.remove();
    }, i * 350);
  });
}
async function skitConductor() {
  const muse = memberById('muse');
  if (!muse) return;
  const others = members().filter((m) => m !== muse);
  others.forEach((m, i) => {
    m.style.setProperty('--bob-delay', `${i * 90}ms`);
    m.classList.add('conducted');
  });
  muse.classList.add('skit-conduct');
  floatNotes(muse);
  await wait(3000);
  muse.classList.remove('skit-conduct');
  others.forEach((m) => m.classList.remove('conducted'));
}
/* (i) PAPERWORK — Paperclip gets buried, files it anyway */
async function skitPaperwork() {
  const clip = memberById('claude-code (paperclip-vm)');
  if (!clip) return;
  ensureSheets(clip);
  await classSkit(clip, 'skit-buried', 3000);
}
/* (j) WALK OVER AND YELL — Claude or Claude Code has had enough */
async function skitYell() {
  const actorId = Math.random() < .5 ? 'claude' : 'claude-code';
  const actor = memberById(actorId);
  if (!actor) return;
  const target = pickOne(members().filter((m) => m !== actor));
  if (!target) return;
  const wk = makeWalker(actor);
  if (!wk) return;
  await animateWalkerTo(wk.el, frontOf(target, wk.el), 1150);
  wk.el.classList.add('skit-mad');
  let bubble;
  if (actorId === 'claude' && Math.random() < .5) {
    const mega = document.createElement('span');
    mega.className = 'skit-prop megaphone show';
    mega.setAttribute('aria-hidden', 'true');
    mega.innerHTML = MEGAPHONE_SVG;
    wk.el.append(mega);
  } else {
    bubble = document.createElement('span');
    bubble.className = 'yell-bubble';
    bubble.setAttribute('aria-hidden', 'true');
    bubble.textContent = '!!!';
    bubble.style.left = `${wk.el._pos.x + wk.el.offsetWidth / 2}px`;
    bubble.style.top = `${wk.el._pos.y - 10}px`;
    world.append(bubble);
  }
  target.classList.add('duck', 'tremble');
  await wait(1400);
  target.classList.remove('duck', 'tremble');
  wk.el.classList.remove('skit-mad');
  if (bubble) bubble.remove();
  await animateWalkerTo(wk.el, wk.seat, 1150);
  wk.el.remove();
  actor.classList.remove('seat-empty');
}
/* (h) ZOOMIES — Blue is the only one who runs around the room */
let zooming = false;
function skitZoomies() {
  const blue = memberById('muse-blue');
  if (!blue || zooming) return;
  const wk = makeWalker(blue);
  if (!wk) return;
  zooming = true;
  wk.el.classList.add('zooming');
  const w = world.getBoundingClientRect();
  const rw = wk.el.offsetWidth;
  const rh = wk.el.offsetHeight;
  const ix = 26;
  const iy = 26;
  const pts = [wk.seat,
    { x: ix, y: iy },
    { x: w.width - ix - rw, y: iy },
    { x: w.width - ix - rw, y: w.height - iy - rh },
    { x: ix, y: w.height - iy - rh },
    wk.seat];
  let total = 0;
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segs.push(len);
    total += len;
  }
  let acc = 0;
  const frames = pts.map((p, i) => {
    if (i > 0) acc += segs[i - 1];
    return { transform: `translate(${p.x}px, ${p.y}px)`, offset: total ? Math.min(1, acc / total) : 0 };
  });
  dustPuffs(wk.seat, rw);
  const anim = wk.el.animate(frames, { duration: 4500, easing: 'linear', fill: 'forwards' });
  const done = () => {
    wk.el.remove();
    blue.classList.remove('seat-empty');
    blue.classList.add('duck');
    setTimeout(() => blue.classList.remove('duck'), 550);
    zooming = false;
  };
  anim.finished.then(done).catch(done);
}

/* --- Skit scheduler: one skit at a time from the rotation --- */
const SKITS = [skitArgue, skitMegaphone, skitLaptop, skitRain, skitBench, skitNailBiter, skitConductor, skitPaperwork, skitYell];
let skitBusy = false;
(function skitLoop() {
  setTimeout(async () => {
    if (motionOK() && !skitBusy && members().length) {
      skitBusy = true;
      try { await pickOne(SKITS)(); } catch { /* a failed skit never breaks the room */ }
      skitBusy = false;
    }
    skitLoop();
  }, rand(10000, 20000));
})();
/* Blue marches to his own drummer: a slower, separate zoomies cadence */
(function zoomLoop() {
  setTimeout(() => {
    if (motionOK()) skitZoomies();
    zoomLoop();
  }, rand(25000, 45000));
})();

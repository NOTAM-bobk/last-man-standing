import {
  CADENCE_MS,
  MILES_PER_LAP,
  STORAGE_KEY,
  autoShoeId,
  createState,
  derive,
  formatDuration,
  formatMmSs,
  formatTime,
  fromInputValue,
  loadState,
  newShoeId,
  nextSaturdayStart,
  saveState,
  shoeStats,
  toInputValue,
} from './js/state.js';
import { createUI } from './js/ui.js';

let state = loadState();
const ui = createUI(document);
const { refs } = ui;

const NAME_LIMIT = 28;
const ALARM_WINDOW_MS = 3 * 60 * 1000;
const ALARM_AUTO_STOP_MS = 30_000;
let shoeMode = { renamingId: null, confirmId: null, focus: null };

function render() {
  const view = derive(state, Date.now());
  ui.render(view);
  checkAlarm(view);
}

function commit(next) {
  state = next;
  saveState(state);
  render();
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

/* alarm ------------------------------------------------------------------ */

let audioCtx = null;
let alarmHour = null;
let alarmStopTimer = null;
let beepTimer = null;

function audio() {
  const AudioCtor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!audioCtx) audioCtx = new AudioCtor();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function beep() {
  const ctx = audio();
  if (!ctx || ctx.state !== 'running') return;
  const start = ctx.currentTime;
  [
    { at: 0, hz: 880 },
    { at: 0.2, hz: 1174 },
  ].forEach(({ at, hz }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, start + at);
    gain.gain.exponentialRampToValueAtTime(0.09, start + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start + at);
    osc.stop(start + at + 0.2);
  });
}

function stopAlarm() {
  clearInterval(beepTimer);
  clearTimeout(alarmStopTimer);
  beepTimer = null;
  alarmStopTimer = null;
  refs.alarm.hidden = true;
}

function startAlarm() {
  if (!refs.alarm.hidden) return;
  refs.alarm.hidden = false;
  beep();
  beepTimer = setInterval(beep, 2400);
  alarmStopTimer = setTimeout(stopAlarm, ALARM_AUTO_STOP_MS);
}

function checkAlarm(view) {
  if (view.phase !== 'running') {
    if (!refs.alarm.hidden) stopAlarm();
    return;
  }

  if (view.msToHourEnd > 0 && view.msToHourEnd <= ALARM_WINDOW_MS) {
    if (alarmHour !== view.hourIndex) {
      alarmHour = view.hourIndex;
      startAlarm();
    }
    if (!refs.alarm.hidden) {
      refs.alarmSub.textContent = `${formatMmSs(view.msToHourEnd)} left in hour ${view.hourIndex + 1}`;
    }
  } else if (!refs.alarm.hidden) {
    stopAlarm();
  }
}

/* confetti --------------------------------------------------------------- */

function confetti() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  document.body.append(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const colors = ['#c7f64b', '#f4f1ea', '#ff6a3d', '#8b879a'];
  const pieces = Array.from({ length: 80 }, () => ({
    x: window.innerWidth / 2 + (Math.random() - 0.5) * window.innerWidth * 0.6,
    y: -20 - Math.random() * 120,
    vx: (Math.random() - 0.5) * 5,
    vy: 2.5 + Math.random() * 4,
    size: 5 + Math.random() * 7,
    rot: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.35,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  let frame = 0;
  const draw = () => {
    if (!canvas.isConnected) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const piece of pieces) {
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.vy += 0.05;
      piece.rot += piece.spin;
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rot);
      ctx.fillStyle = piece.color;
      ctx.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      ctx.restore();
    }
    frame += 1;
    if (frame < 120) requestAnimationFrame(draw);
    else canvas.remove();
  };
  requestAnimationFrame(draw);
  // rAF pauses in a background tab, so a timer guarantees the canvas goes away.
  setTimeout(() => canvas.remove(), 2400);
}

function finishLap() {
  const now = Date.now();
  const view = derive(state, now);
  if (view.phase !== 'running' || view.lapThisHour) return;

  commit(
    createState(state.start, {
      laps: [
        ...state.laps,
        {
          hour: view.hourIndex,
          at: now,
          ms: Math.min(now - view.hourStart, CADENCE_MS),
          shoeId: view.activeShoeId,
        },
      ],
      shoes: state.shoes,
      rotation: state.rotation,
    }),
  );

  const lap = state.laps[state.laps.length - 1];
  ui.flash();
  confetti();
  showLap(lap, state.laps.length);
}

const GOGGINS_QUOTES = [
  'Stay hard.',
  "Who's gonna carry the boats?",
  "Don't stop when you're tired. Stop when you're done.",
  "When you think you're done, you're only at 40% of your body's capability.",
  'You are in danger of living a life so comfortable and soft that you will die without ever realizing your true potential.',
  'Be uncommon amongst uncommon people.',
  'The most important conversation is the one you have with yourself.',
  'You have to build calluses on your brain just like how you build calluses on your hands.',
  'Suffering is the true test of life.',
  'Motivation is crap. Motivation comes and goes. When you are driven, whatever is in front of you will get destroyed.',
];

let lastQuoteIndex = -1;

function pickQuote() {
  let index = Math.floor(Math.random() * GOGGINS_QUOTES.length);
  if (GOGGINS_QUOTES.length > 1 && index === lastQuoteIndex) {
    index = (index + 1) % GOGGINS_QUOTES.length;
  }
  lastQuoteIndex = index;
  return GOGGINS_QUOTES[index];
}

function showLap(lap, number) {
  if (!lap) return;
  const view = derive(state, Date.now());
  const pace = formatMmSs(lap.ms / MILES_PER_LAP);
  const pair = shoeStats(state).find((shoe) => shoe.id === lap.shoeId) ?? null;
  const quote = pickQuote();

  ui.openSheet({
    title: `Lap ${number} banked`,
    content: `
      <div class="lap-stats">
        <div class="lap-stat">
          <span class="stat-label">Lap time</span>
          <strong>${formatMmSs(lap.ms)}</strong>
        </div>
        <div class="lap-stat">
          <span class="stat-label">Avg pace</span>
          <strong>${pace}<span class="unit">/mi</span></strong>
        </div>
        <div class="lap-stat">
          <span class="stat-label">Total distance</span>
          <strong>${view.totalMiles.toFixed(1)}<span class="unit">mi</span></strong>
        </div>
        <div class="lap-stat">
          <span class="stat-label">Total time</span>
          <strong>${formatDuration(view.totalMs)}</strong>
        </div>
        <div class="lap-stat lap-stat--wide">
          <span class="stat-label">Shoe</span>
          <strong>${pair ? escapeHtml(pair.name) : 'No pair'}</strong>
          <span class="lap-stat-note">${
            pair
              ? `${pair.laps} lap${pair.laps === 1 ? '' : 's'} · ${pair.miles.toFixed(1)} mi on this pair`
              : 'Add a pair in Shoes to track its miles'
          }</span>
        </div>
      </div>
      <blockquote class="quote">
        <p>${escapeHtml(quote)}</p>
        <footer>David Goggins</footer>
      </blockquote>
    `,
    actions: [{ label: 'Keep going', variant: 'primary', onClick: ui.closeSheet }],
  });
}

function tapOut() {
  const view = derive(state, Date.now());
  if (view.phase !== 'running') return;

  ui.openSheet({
    title: 'Tap out?',
    body: `The clock stops. ${view.totalMiles.toFixed(1)} mi across ${view.lapCount} lap${
      view.lapCount === 1 ? '' : 's'
    } becomes your final.`,
    actions: [
      { label: 'Keep going', variant: 'ghost', onClick: ui.closeSheet },
      {
        label: 'Tap out',
        variant: 'danger',
        onClick: () => {
          state = createState(state.start, {
            laps: state.laps,
            endedAt: Date.now(),
            shoes: state.shoes,
            rotation: state.rotation,
          });
          saveState(state);
          stopAlarm();
          ui.closeSheet();
          render();
        },
      },
    ],
  });
}

function startNewRun() {
  state = createState(nextSaturdayStart(Date.now()), {
    shoes: state.shoes,
    rotation: state.rotation,
  });
  saveState(state);
  stopAlarm();
  render();
}

function editStart() {
  const existing = state.laps.length;
  const content = `
    <label class="field-label" for="startInput">Start date &amp; time</label>
    <input class="field" id="startInput" type="datetime-local" step="60" value="${toInputValue(
      state.start,
    )}" />
    <button class="preset" id="presetSat" type="button">Next Saturday · 5:00 am</button>
    <p class="hint" id="startHint">${
      existing
        ? `Saving clears the ${existing} lap${existing === 1 ? '' : 's'} already on the board.`
        : 'Change it any time — the clock follows your phone.'
    }</p>
  `;

  ui.openSheet({
    title: 'Start time',
    content,
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: ui.closeSheet },
      {
        label: 'Save start',
        variant: 'primary',
        onClick: () => {
          const input = refs.sheetContent.querySelector('#startInput');
          const hint = refs.sheetContent.querySelector('#startHint');
          const next = fromInputValue(input?.value ?? '');
          if (next === null) {
            if (hint) {
              hint.textContent = 'That date doesn’t look right — pick another.';
              hint.classList.add('hint--warn');
            }
            input?.focus();
            return;
          }
          state = createState(next, { shoes: state.shoes, rotation: state.rotation });
          saveState(state);
          ui.closeSheet();
          render();
        },
      },
    ],
  });

  const preset = refs.sheetContent.querySelector('#presetSat');
  const input = refs.sheetContent.querySelector('#startInput');
  preset?.addEventListener('click', () => {
    if (input) input.value = toInputValue(nextSaturdayStart(Date.now()));
  });
}

/* shoes ---------------------------------------------------------------- */

function openShoes() {
  shoeMode = { renamingId: null, confirmId: null, focus: null };
  ui.openSheet({
    title: 'Shoes',
    body: 'Add the pairs you run in. The rotation picks the next one for each lap.',
    content: '',
    actions: [{ label: 'Done', variant: 'primary', onClick: ui.closeSheet }],
  });
  paintShoes();
}

function removeShoe(id) {
  shoeMode = { renamingId: null, confirmId: null, focus: '#newShoe' };
  commit({
    ...state,
    shoes: state.shoes.filter((shoe) => shoe.id !== id),
    laps: state.laps.map((lap) => (lap.shoeId === id ? { ...lap, shoeId: null } : lap)),
    rotation: {
      ...state.rotation,
      pinnedShoeId: state.rotation.pinnedShoeId === id ? null : state.rotation.pinnedShoeId,
    },
  });
  paintShoes();
}

function paintShoes() {
  const host = refs.sheetContent;
  const stats = shoeStats(state);
  const pinned = state.rotation.pinnedShoeId;
  const every = state.rotation.every;

  const preview = stats.length
    ? Array.from({ length: Math.min(6, stats.length * 2) }, (_, index) => {
        const id = autoShoeId(stats, every, index);
        return stats.find((shoe) => shoe.id === id)?.name ?? '';
      })
        .filter(Boolean)
        .join(' · ')
    : '';

  const everyButtons = [1, 2, 3, 4]
    .map(
      (value) =>
        `<button class="seg-btn${value === every ? ' is-on' : ''}" type="button" data-every="${value}" aria-pressed="${value === every}">${value} lap${value === 1 ? '' : 's'}</button>`,
    )
    .join('');

  const rows = stats
    .map((shoe) => {
      const name = escapeHtml(shoe.name);
      if (shoeMode.renamingId === shoe.id) {
        return `<li class="shoe-item">
          <form class="shoe-form" data-rename-form="${escapeHtml(shoe.id)}">
            <input class="field field--tight" id="renameInput" aria-label="Rename ${name}" maxlength="${NAME_LIMIT}" autocomplete="off" value="${name}" />
            <button class="add-btn" type="submit">Save</button>
            <button class="shoe-act" type="button" data-cancel="1">Cancel</button>
          </form>
        </li>`;
      }
      if (shoeMode.confirmId === shoe.id) {
        return `<li class="shoe-item shoe-item--warn">
          <span class="shoe-text">
            <span class="shoe-name">Remove ${name}?</span>
            <span class="shoe-meta">${shoe.laps} lap${shoe.laps === 1 ? ' stays' : 's stay'} on the board, no pair attached.</span>
          </span>
          <button class="shoe-act shoe-act--del" type="button" data-del-confirm="${escapeHtml(shoe.id)}">Remove</button>
          <button class="shoe-act" type="button" data-cancel="1">Keep</button>
        </li>`;
      }
      const isPinned = pinned === shoe.id;
      return `<li class="shoe-item${isPinned ? ' is-pinned' : ''}">
        <button class="shoe-pick" type="button" data-pin="${escapeHtml(shoe.id)}" aria-pressed="${isPinned}">
          <span class="shoe-name">${name}</span>
          <span class="shoe-meta">${shoe.laps} lap${shoe.laps === 1 ? '' : 's'} · ${shoe.miles.toFixed(1)} mi${isPinned ? ' · pinned' : ''}</span>
        </button>
        <button class="shoe-act" type="button" data-rename="${escapeHtml(shoe.id)}" aria-label="Rename ${name}">Edit</button>
        <button class="shoe-act shoe-act--del" type="button" data-del="${escapeHtml(shoe.id)}" aria-label="Remove ${name}">Remove</button>
      </li>`;
    })
    .join('');

  host.innerHTML = `
    <p class="field-label" id="everyLabel">Use each pair for</p>
    <div class="seg" role="group" aria-labelledby="everyLabel">${everyButtons}</div>
    ${preview ? `<p class="hint" id="everyHint">Rotation: ${escapeHtml(preview)}</p>` : ''}
    ${
      stats.length
        ? `<ul class="shoe-list" aria-label="Your pairs">${rows}</ul>`
        : `<p class="hint">No pairs yet — add the ones on your feet.</p>`
    }
    <form class="shoe-form" id="addShoeForm">
      <input class="field field--tight" id="newShoe" aria-label="New shoe name" placeholder="e.g. Pegasus 41" maxlength="${NAME_LIMIT}" autocomplete="off" />
      <button class="add-btn" type="submit">Add pair</button>
    </form>
  `;

  bindShoeSheet();
}

function bindShoeSheet() {
  const host = refs.sheetContent;

  host.querySelectorAll('[data-every]').forEach((button) => {
    button.addEventListener('click', () => {
      const every = Number(button.dataset.every);
      if (!Number.isFinite(every) || every === state.rotation.every) return;
      shoeMode = { ...shoeMode, focus: `[data-every="${every}"]` };
      commit({ ...state, rotation: { ...state.rotation, every } });
      paintShoes();
    });
  });

  host.querySelectorAll('[data-pin]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.pin;
      const pinnedShoeId = state.rotation.pinnedShoeId === id ? null : id;
      shoeMode = { ...shoeMode, focus: `[data-pin="${id}"]` };
      commit({ ...state, rotation: { ...state.rotation, pinnedShoeId } });
      paintShoes();
    });
  });

  host.querySelectorAll('[data-rename]').forEach((button) => {
    button.addEventListener('click', () => {
      shoeMode = { renamingId: button.dataset.rename, confirmId: null, focus: '#renameInput' };
      paintShoes();
    });
  });

  host.querySelectorAll('[data-del]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.del;
      const used = state.laps.some((lap) => lap.shoeId === id);
      if (!used) {
        removeShoe(id);
        return;
      }
      shoeMode = { renamingId: null, confirmId: id, focus: `[data-del-confirm="${id}"]` };
      paintShoes();
    });
  });

  host.querySelectorAll('[data-del-confirm]').forEach((button) => {
    button.addEventListener('click', () => removeShoe(button.dataset.delConfirm));
  });

  host.querySelectorAll('[data-cancel]').forEach((button) => {
    button.addEventListener('click', () => {
      shoeMode = { renamingId: null, confirmId: null, focus: null };
      paintShoes();
    });
  });

  host.querySelector('[data-rename-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const id = form.dataset.renameForm;
    const input = form.querySelector('input');
    const name = (input?.value ?? '').trim().replace(/\s+/g, ' ').slice(0, NAME_LIMIT);
    if (!name) {
      input?.focus();
      return;
    }
    shoeMode = { renamingId: null, confirmId: null, focus: `[data-pin="${id}"]` };
    commit({ ...state, shoes: state.shoes.map((shoe) => (shoe.id === id ? { ...shoe, name } : shoe)) });
    paintShoes();
  });

  host.querySelector('#addShoeForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = host.querySelector('#newShoe');
    const name = (input?.value ?? '').trim().replace(/\s+/g, ' ').slice(0, NAME_LIMIT);
    if (!name) {
      input?.focus();
      return;
    }
    const shoe = { id: newShoeId(), name, addedAt: Date.now() };
    shoeMode = { renamingId: null, confirmId: null, focus: `[data-pin="${shoe.id}"]` };
    commit({ ...state, shoes: [...state.shoes, shoe] });
    paintShoes();
  });

  if (shoeMode.focus) {
    const target = host.querySelector(shoeMode.focus);
    shoeMode = { ...shoeMode, focus: null };
    target?.focus();
  }
}

/* one lap -------------------------------------------------------------- */

function openLap(hour) {
  const lap = state.laps.find((entry) => entry.hour === hour);
  if (!lap) return;
  const hourStart = state.start + hour * CADENCE_MS;

  ui.openSheet({
    title: `Hour ${hour + 1}`,
    body: `${formatTime(hourStart)} start · ${formatDuration(lap.ms)} from the top of the hour.`,
    content: '',
    actions: [{ label: 'Done', variant: 'primary', onClick: ui.closeSheet }],
  });
  paintLap(hour);
}

function paintLap(hour) {
  const host = refs.sheetContent;
  const lap = state.laps.find((entry) => entry.hour === hour);
  if (!lap) return;

  const options = [
    `<button class="lap-shoe${lap.shoeId ? '' : ' is-on'}" type="button" data-lap-shoe="" aria-pressed="${!lap.shoeId}"><span>No pair</span></button>`,
    ...state.shoes.map(
      (shoe) =>
        `<button class="lap-shoe${lap.shoeId === shoe.id ? ' is-on' : ''}" type="button" data-lap-shoe="${escapeHtml(
          shoe.id,
        )}" aria-pressed="${lap.shoeId === shoe.id}"><span>${escapeHtml(shoe.name)}</span></button>`,
    ),
  ].join('');

  host.innerHTML = `
    <p class="field-label">Pair on this lap</p>
    <div class="lap-shoes" role="group" aria-label="Pair on this lap">${options}</div>
    ${
      state.shoes.length
        ? ''
        : '<p class="hint">No pairs yet — add one in Shoes and it shows up here.</p>'
    }
  `;

  host.querySelectorAll('[data-lap-shoe]').forEach((button) => {
    button.addEventListener('click', () => {
      const shoeId = button.dataset.lapShoe || null;
      commit({
        ...state,
        laps: state.laps.map((entry) => (entry.hour === hour ? { ...entry, shoeId } : entry)),
      });
      paintLap(hour);
      host.querySelector(`[data-lap-shoe="${shoeId ?? ''}"]`)?.focus();
    });
  });
}

/* wiring --------------------------------------------------------------- */

refs.lap.addEventListener('click', () => {
  const view = derive(state, Date.now());
  if (view.phase === 'ended') startNewRun();
  else finishLap();
});

refs.tapout.addEventListener('click', tapOut);
refs.editStart.addEventListener('click', editStart);
refs.shoePill.addEventListener('click', openShoes);
refs.alarmDisarm.addEventListener('click', stopAlarm);

// Browsers only start audio after a gesture, so unlock on the first one.
window.addEventListener('pointerdown', () => audio(), { once: true });
window.addEventListener('keydown', () => audio(), { once: true });

refs.rail.addEventListener('click', (event) => {
  const chip = event.target instanceof Element ? event.target.closest('.chip') : null;
  if (!chip?.dataset?.hour) return;
  const hour = Number(chip.dataset.hour);
  if (!Number.isInteger(hour)) return;
  if (!state.laps.some((lap) => lap.hour === hour)) return;
  openLap(hour);
});

refs.scrim.addEventListener('click', (event) => {
  if (event.target === refs.scrim) ui.closeSheet();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !refs.scrim.hidden) ui.closeSheet();
});

// Any clock source counts: tab wake, focus, bfcache restore or a sibling tab writing state.
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return;
  state = loadState();
  render();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});
window.addEventListener('focus', render);
window.addEventListener('pageshow', render);

render();
setInterval(render, 250);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // Offline support is a bonus; the tracker itself never needs the network.
    });
  });
}

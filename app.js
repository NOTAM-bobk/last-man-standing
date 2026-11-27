import {
  CADENCE_MS,
  STORAGE_KEY,
  createState,
  derive,
  fromInputValue,
  loadState,
  nextSaturdayStart,
  saveState,
  toInputValue,
} from './js/state.js';
import { createUI } from './js/ui.js';

let state = loadState();
const ui = createUI(document);
const { refs } = ui;

function render() {
  ui.render(derive(state, Date.now()));
}

function finishLap() {
  const now = Date.now();
  const view = derive(state, now);
  if (view.phase !== 'running' || view.lapThisHour) return;

  state = createState(state.start, {
    laps: [
      ...state.laps,
      { hour: view.hourIndex, at: now, ms: Math.min(now - view.hourStart, CADENCE_MS) },
    ],
    endedAt: null,
  });
  saveState(state);
  render();
  ui.flash();
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
          state = createState(state.start, { laps: state.laps, endedAt: Date.now() });
          saveState(state);
          ui.closeSheet();
          render();
        },
      },
    ],
  });
}

function startNewRun() {
  state = createState(nextSaturdayStart(Date.now()));
  saveState(state);
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
          state = createState(next);
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

refs.lap.addEventListener('click', () => {
  const view = derive(state, Date.now());
  if (view.phase === 'ended') startNewRun();
  else finishLap();
});

refs.tapout.addEventListener('click', tapOut);
refs.editStart.addEventListener('click', editStart);

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

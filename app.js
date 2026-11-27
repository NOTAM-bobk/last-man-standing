import {
  CADENCE_MS,
  STORAGE_KEY,
  autoShoeId,
  createState,
  derive,
  formatDuration,
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
let shoeMode = { renamingId: null, confirmId: null, focus: null };

function render() {
  ui.render(derive(state, Date.now()));
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
          state = createState(state.start, {
            laps: state.laps,
            endedAt: Date.now(),
            shoes: state.shoes,
            rotation: state.rotation,
          });
          saveState(state);
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

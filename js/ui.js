// Rendering for the tracker. Writes are cached so the 250 ms tick only touches
// text that actually changed, which keeps the countdown from flickering.

import {
  CADENCE_MS,
  MILES_PER_LAP,
  formatCountdownParts,
  formatDay,
  formatDuration,
  formatHourShort,
  formatMmSs,
  formatTime,
  pad2,
} from './state.js';

const IDS = [
  'hero',
  'statusDot',
  'statusText',
  'startText',
  'editStart',
  'tapout',
  'heroLabel',
  'clock',
  'heroSub',
  'trackFill',
  'lap',
  'lapNote',
  'statDistance',
  'statRun',
  'statTotal',
  'railWrap',
  'rail',
  'railCount',
  'scrim',
  'sheet',
  'sheetTitle',
  'sheetBody',
  'sheetContent',
  'sheetActions',
];

export function createUI(root = document) {
  const refs = {};
  for (const id of IDS) refs[id] = root.getElementById(id);

  const seen = { clock: null, lap: null, distance: null, run: null, total: null, rail: null };

  function setHtml(element, key, html) {
    if (seen[key] === html) return;
    seen[key] = html;
    element.innerHTML = html;
  }

  function render(view) {
    const live = view.phase === 'running';

    refs.statusDot.className = `dot dot--${view.phase}`;
    refs.statusText.textContent = live ? 'Live' : view.phase === 'prestart' ? 'Starts soon' : 'Ended';
    refs.startText.textContent = `${formatDay(view.start)} · ${formatTime(view.start)}`;
    refs.tapout.hidden = !live;
    refs.hero.classList.toggle('is-ended', view.phase === 'ended');

    refs.heroLabel.textContent =
      view.phase === 'prestart'
        ? 'Starts in'
        : view.phase === 'ended'
          ? 'Final time'
          : view.lapThisHour
            ? 'Next hour in'
            : 'Hour ends in';

    if (view.phase === 'prestart') {
      const parts = formatCountdownParts(view.msToStart);
      const long = parts.days > 0;
      refs.clock.classList.toggle('is-long', long);
      setHtml(
        refs.clock,
        'clock',
        long
          ? `${parts.days}<span class="cd-unit">d</span> ${pad2(parts.hours)}:${pad2(parts.minutes)}:${pad2(parts.seconds)}`
          : `${pad2(parts.hours)}:${pad2(parts.minutes)}:${pad2(parts.seconds)}`,
      );
    } else if (view.phase === 'running') {
      refs.clock.classList.remove('is-long');
      setHtml(refs.clock, 'clock', formatMmSs(view.msToHourEnd));
    } else {
      refs.clock.classList.add('is-long');
      setHtml(refs.clock, 'clock', formatDuration(view.totalMs));
    }

    refs.heroSub.textContent =
      view.phase === 'prestart'
        ? `${formatDay(view.start)} · ${formatTime(view.start)}`
        : view.phase === 'running'
          ? `Hour ${view.hourIndex + 1} · ${
              view.lapThisHour
                ? `${MILES_PER_LAP} mi banked`
                : `${MILES_PER_LAP} mi before ${formatTime(view.hourEnd)}`
            }`
          : `${view.lapCount} lap${view.lapCount === 1 ? '' : 's'} · ${view.totalMiles.toFixed(1)} mi`;

    const progress = view.phase === 'ended' ? 1 : view.hourProgress;
    refs.trackFill.style.width = `${Math.round(progress * 100)}%`;

    refs.lap.classList.remove('lap--banked', 'lap--ghost');
    if (view.phase === 'prestart') {
      refs.lap.disabled = true;
      setHtml(refs.lap, 'lap', 'Finish lap <span class="lap-add">+3 mi</span>');
      refs.lapNote.textContent = `First lap due ${formatTime(view.start)}.`;
    } else if (view.phase === 'running') {
      if (view.lapThisHour) {
        refs.lap.disabled = true;
        refs.lap.classList.add('lap--banked');
        setHtml(
          refs.lap,
          'lap',
          `Lap banked <span class="lap-add">${formatMmSs(view.lapThisHour.ms)}</span>`,
        );
        refs.lapNote.textContent = `Next hour in ${formatMmSs(view.msToHourEnd)}.`;
      } else {
        refs.lap.disabled = false;
        setHtml(refs.lap, 'lap', 'Finish lap <span class="lap-add">+3 mi</span>');
        refs.lapNote.textContent = `${MILES_PER_LAP} miles, then hit finish.`;
      }
    } else {
      refs.lap.disabled = false;
      refs.lap.classList.add('lap--ghost');
      setHtml(refs.lap, 'lap', 'Start a new run');
      refs.lapNote.textContent = 'Tap out is final — this clears the board.';
    }

    setHtml(
      refs.statDistance,
      'distance',
      `${view.totalMiles.toFixed(1)}<span class="unit">mi</span>`,
    );
    const runText = formatDuration(view.runMs);
    if (seen.run !== runText) {
      seen.run = runText;
      refs.statRun.textContent = runText;
    }
    const totalText = formatDuration(view.totalMs);
    if (seen.total !== totalText) {
      seen.total = totalText;
      refs.statTotal.textContent = totalText;
    }

    renderRail(view);
  }

  function renderRail(view) {
    const visible = view.hourIndex >= 0;
    refs.railWrap.hidden = !visible;
    if (!visible) return;

    const lapHours = view.laps.map((lap) => lap.hour).join(',');
    const signature = `${view.start}|${view.hourIndex}|${lapHours}|${view.phase}|${view.firstHour}`;
    if (seen.rail !== signature) {
      seen.rail = signature;
      const fragment = root.createDocumentFragment();
      if (view.firstHour > 0) {
        const more = root.createElement('span');
        more.className = 'rail-more';
        more.textContent = '…';
        fragment.append(more);
      }
      for (let hour = view.firstHour; hour <= view.hourIndex; hour += 1) {
        const hourStart = view.start + hour * CADENCE_MS;
        const lap = view.laps.find((entry) => entry.hour === hour);
        const isNow = view.phase === 'running' && hour === view.hourIndex;
        const chip = root.createElement('div');
        chip.className = `chip ${isNow ? 'chip--now' : lap ? 'chip--done' : 'chip--missed'}`;
        chip.innerHTML = `<span class="chip-dot"></span><span class="chip-time">${formatHourShort(hourStart)}</span>`;
        chip.title = `${formatTime(hourStart)} — ${lap ? `${formatDuration(lap.ms)} lap` : 'no lap'}`;
        fragment.append(chip);
      }
      refs.rail.replaceChildren(fragment);
      refs.rail.scrollLeft = refs.rail.scrollWidth;
    }

    refs.railCount.textContent = `${view.lapCount} lap${view.lapCount === 1 ? '' : 's'} · ${view.totalMiles.toFixed(1)} mi`;
  }

  function flash() {
    const card = refs.statDistance.closest('.stat');
    if (!card) return;
    card.classList.remove('is-pop');
    void card.offsetWidth;
    card.classList.add('is-pop');
  }

  function openSheet({ title, body = '', content = '', actions = [] }) {
    refs.sheetTitle.textContent = title;
    refs.sheetBody.textContent = body;
    refs.sheetBody.hidden = !body;
    refs.sheetContent.innerHTML = content;
    refs.sheetActions.replaceChildren();

    for (const action of actions) {
      const button = root.createElement('button');
      button.type = 'button';
      button.className = `sheet-btn sheet-btn--${action.variant ?? 'ghost'}`;
      button.textContent = action.label;
      button.addEventListener('click', () => action.onClick?.(button));
      refs.sheetActions.append(button);
    }

    refs.scrim.hidden = false;
    requestAnimationFrame(() => {
      refs.scrim.classList.add('is-open');
      const focusTarget =
        refs.sheetActions.querySelector('.sheet-btn--primary') ??
        refs.sheetActions.firstElementChild;
      focusTarget?.focus();
    });
  }

  function closeSheet() {
    refs.scrim.classList.remove('is-open');
    setTimeout(() => {
      refs.scrim.hidden = true;
    }, 160);
  }

  return { refs, render, flash, openSheet, closeSheet };
}

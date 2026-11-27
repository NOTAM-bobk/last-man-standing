// Rule-based coaching notes for the lap summary. Everything comes from the run
// itself: the pace of the lap, the hour of the day, mileage so far, gear and
// whether hours were missed. Pure functions so the advice is easy to test.

import { CADENCE_MS, MILES_PER_LAP, formatMmSs, formatTime } from './state.js';

export function lapTips(view, lap, pair = null) {
  const paceMs = lap.ms > 0 ? lap.ms / MILES_PER_LAP : 0;
  const hourStart = view.start + lap.hour * CADENCE_MS;
  const clockHour = new Date(hourStart).getHours();
  const timeLabel = formatTime(hourStart);
  const index = view.laps.findIndex((entry) => entry.hour === lap.hour);
  const previous = index > 0 ? view.laps[index - 1] : null;
  const prevPace = previous ? previous.ms / MILES_PER_LAP : null;
  const miles = view.totalMiles;
  const missing = Math.max(0, view.hourIndex + 1 - view.laps.length);

  const pools = { hydration: [], nutrition: [], recovery: [], pacing: [], gear: [] };
  const add = (kind, score, text) => {
    if (text) pools[kind].push({ kind, score, text });
  };

  if (clockHour < 7) {
    add(
      'hydration',
      70,
      `${timeLabel} start: 400–500 ml with electrolytes before the next lap — you wake up already down fluid.`,
    );
  } else if (clockHour >= 11 && clockHour < 16) {
    add(
      'hydration',
      80,
      `Midday at ${timeLabel}: sip 400–500 ml now and keep the bottle within reach for the next hour.`,
    );
  } else if (clockHour >= 21) {
    add(
      'hydration',
      65,
      `It's ${timeLabel}. Keep the next bottle small — big volumes this late cost you sleep.`,
    );
  } else {
    add(
      'hydration',
      50,
      `Drink 300–500 ml over the next half hour; add electrolytes if you're sweating hard.`,
    );
  }

  if (miles >= 12) {
    add(
      'nutrition',
      85,
      `${miles.toFixed(1)} mi in. You need 40–60 g of carbs an hour now — gel, banana, or a bottle with mix.`,
    );
  } else if (miles >= 6) {
    add(
      'nutrition',
      70,
      `${miles.toFixed(1)} mi in. Take 30–40 g of carbs before the next lap so you don't run the hour empty.`,
    );
  } else {
    add(
      'nutrition',
      45,
      `Eat 20–30 g of carbs with a little protein within the hour; it's cheaper now than at mile 12.`,
    );
  }

  if (lap.ms >= 55 * 60_000) {
    add(
      'recovery',
      90,
      `That lap ate ${formatMmSs(lap.ms)} of the hour. Sit down, feet up, and bank earlier next time.`,
    );
  } else if (miles >= 15) {
    add(
      'recovery',
      80,
      `${miles.toFixed(1)} mi on the legs. Take 10 minutes off your feet — legs up, calves released.`,
    );
  } else if (clockHour >= 21) {
    add(
      'recovery',
      75,
      `Late laps add up. Bed within 90 minutes of your last one; sleep is the session that pays.`,
    );
  } else {
    add(
      'recovery',
      55,
      `Walk 3–5 minutes, then stretch calves and hip flexors while the clock is still yours.`,
    );
  }

  if (paceMs > 0) {
    const paceLabel = `${formatMmSs(paceMs)}/mi`;

    if (prevPace && paceMs - prevPace > 20_000) {
      add(
        'pacing',
        85,
        `You slowed ${Math.round((paceMs - prevPace) / 1000)}s/mi (${paceLabel}). Start the next one easier instead of trying to win it back.`,
      );
    } else if (prevPace && prevPace - paceMs > 25_000) {
      add(
        'pacing',
        70,
        `${Math.round((prevPace - paceMs) / 1000)}s/mi quicker than the last lap (${paceLabel}). Bank the win — don't spend it in the first mile.`,
      );
    }

    if (paceMs < 8 * 60_000) {
      add(
        'pacing',
        75,
        `Sub-8 pace at hour ${lap.hour + 1} is expensive. Cap the next lap near ${formatMmSs(paceMs + 30_000)}/mi.`,
      );
    } else if (paceMs > 14 * 60_000) {
      add(
        'pacing',
        70,
        `${paceLabel} means a lot of walking. Run the first five minutes next hour, then walk if you still need it.`,
      );
    }

    if (missing > 0) {
      add(
        'pacing',
        65,
        `You're ${missing} lap${missing === 1 ? '' : 's'} behind the clock. Don't double up — just take the next one on time.`,
      );
    }
  }

  if (pair && pair.miles >= 300) {
    add(
      'gear',
      70,
      `${pair.name} are at ${pair.miles.toFixed(0)} mi. Rotate your other pair in before the foam goes flat.`,
    );
  }

  const best = (kind) => pools[kind].sort((a, b) => b.score - a.score)[0] ?? null;
  const picks = [best('hydration'), best('nutrition'), best('recovery')].filter(Boolean);
  const extras = ['pacing', 'gear']
    .map(best)
    .filter((tip) => tip && tip.score >= 65);

  return picks.concat(extras);
}

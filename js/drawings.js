// drawings.js — the hand-drawn parts of the notebook: the mountain ridge, small pen doodles,
// and your words scribbled across a page. Used on the first page and on the lock screen.

import { h } from './util.js';

// A ridge line drawn in pen: the mountain. The dotted line is the trail up, the flag marks the top.
// If you set "a date that matters" in Settings, it is written next to the flag.
export function ridge(label = '') {
  const el = h('div', { class: 'ridge', 'aria-hidden': 'true' });
  el.innerHTML = `<svg viewBox="0 0 360 92" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <path class="back" stroke-width="1.1" d="M-4 74c22-3 37-15 58-21 14-4 22 5 37-2 19-9 28-27 46-30 12-2 17 9 30 10 18 1 26-15 44-17 14-2 21 12 35 16 16 5 27-3 42 3 21 8 44 19 78 24"/>
    <path stroke-width="1.7" d="M-4 86c17-1 30-6 44-13 13-6 20-3 31-10 15-10 21-24 37-33 9-5 13 3 22-3 12-8 19-17 31-19 8-1 10 6 17 11 10 7 15 3 25 10 13 9 20 20 35 24 12 3 18-2 31 3 19 7 38 17 95 26"/>
    <path class="trail" stroke-width="1.2" stroke-dasharray="1.5 5.5" d="M46 80c14-7 25-9 36-19 13-12 21-25 34-31 12-5 19-2 30-12 6-5 10-8 15-9"/>
    <path class="flag" stroke-width="1.3" d="M163 8.5v-12M163 -3.5l9 3.2-9 3.2z"/>
  </svg>`;
  if (label) el.append(h('span', { class: 'ridge-label' }, label));
  return el;
}

// Pen doodles of ordinary things. Each is one or two wobbly strokes, drawn as if in a notebook margin.
const DOODLES = {
  mountain: '<path d="M4 34c6-4 9-11 14-17 3-4 5 1 8-3 3-5 5-9 8-9s5 6 9 11c4 5 8 11 14 16"/><path d="M30 9l3 4 3-3"/>',
  bottle: '<path d="M21 6h10M22 6c0 5-6 7-6 14v20c0 3 2 4 5 4h10c3 0 5-1 5-4V20c0-7-6-9-6-14"/><path d="M16 25c7 2 13 2 20 0M16 33c7 2 13 2 20 0"/>',
  ball: '<path d="M26 6c11 0 20 9 20 20s-9 20-20 20S6 37 6 26 15 6 26 6z"/><path d="M26 17l8 6-3 10H21l-3-10zM26 17V7M34 23l10-3M31 33l6 9M21 33l-6 9M18 23L8 20"/>',
  bike: '<path d="M13 33a8 8 0 1 0 .1 0M41 33a8 8 0 1 0 .1 0"/><path d="M13 41l9-17h14l5 17M22 24l8 17M36 24l-6 17M19 20h6M36 24l-2-6h5"/>',
  star: '<path d="M26 5l5 14 15 1-12 9 4 15-12-9-12 9 4-15L6 20l15-1z"/>',
  bracelet: '<path d="M26 8c11 0 19 7 19 17s-8 19-19 19S7 36 7 26 15 8 26 8z"/><path d="M11 17l2 1M17 11l1 2M35 11l-1 2M41 17l-2 1M44 27h-2M40 37l-2-1M12 37l2-1M8 27h2"/><path d="M22 41h8v7h-8z"/>',
  hairtie: '<path d="M10 26c0-9 7-15 16-15s17 6 17 14-8 16-17 16-16-6-16-15z"/><path d="M14 26c0-7 5-11 12-11s13 4 13 10-6 12-13 12-12-5-12-11z"/><path d="M41 18c3-1 6 1 6 4"/>',
  sock: '<path d="M18 6h14v22l11 8c3 2 3 6 0 8-3 1-6 1-9-1L18 33z"/><path d="M18 12h14M18 17h14"/>',
  worm: '<path d="M6 30c4-10 9-10 12 0s8 10 11 0 8-10 11 0 6 8 8 3"/><path d="M8 27l-2-1"/>',
  note: '<path d="M20 38V12l20-5v26"/><path d="M20 38c0 3-3 5-6 5s-6-2-6-5 3-5 6-5 6 2 6 5zM40 33c0 3-3 5-6 5s-6-2-6-5 3-5 6-5 6 2 6 5z"/>',
  heart: '<path d="M26 44C12 34 6 26 6 18c0-6 4-10 10-10 4 0 8 3 10 7 2-4 6-7 10-7 6 0 10 4 10 10 0 8-6 16-20 26z"/>',
};
const DOODLE_ORDER = ['mountain', 'bottle', 'ball', 'star', 'bracelet', 'bike', 'hairtie', 'worm', 'sock', 'note', 'heart'];

export function doodle(name, i) {
  const el = h('span', { class: 'doodle', 'aria-hidden': 'true', style: { '--i': String(i), '--tilt': `${((i * 37) % 17) - 8}deg` } });
  el.innerHTML = `<svg viewBox="0 0 52 52" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" pathLength="1">${DOODLES[name].replace(/<path /g, '<path pathLength="1" ')}</svg>`;
  return el;
}

// A small number from a word, always the same for the same word (so the page doesn't reshuffle).
function wordNumber(word) {
  let n = 7;
  for (const ch of word) n = (n * 31 + ch.codePointAt(0)) % 9973;
  return n;
}

// Your words, scattered like scribbles on a page, with drawings in between.
export function wordScatter(words) {
  const items = [];
  let drawn = 0; // each drawing appears once before any repeats
  words.forEach((word, i) => {
    const n = wordNumber(word);
    items.push(h('span', {
      class: `scribble s${n % 4} ${word.length <= 10 && n % 3 === 0 ? 'big' : ''}`,
      style: { '--i': String(items.length), '--tilt': `${(n % 13) - 6}deg`, '--nudge': `${(n % 15) - 7}px` },
    }, word));
    if (i % 2 === 1 || words.length < 5) items.push(doodle(DOODLE_ORDER[drawn++ % DOODLE_ORDER.length], items.length));
  });
  if (!words.length) DOODLE_ORDER.slice(0, 7).forEach((d, i) => items.push(doodle(d, i)));
  return h('div', { class: 'scatter' }, items);
}


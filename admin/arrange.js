/* The Visuals grid, arranged by hand in the preview rail.
 *
 * The page lays the grid out in rows, each stretched to exactly the width of
 * the page, every picture in a row the same height (visuals_layout in
 * build.py). A row can also hold a stack: two or more pictures one above the
 * other in one column. That is the whole model, and it is stored as
 *
 *   shared.visualsRows = [ ["photo:a", "video:b", ["photo:c", "photo:d"]], ... ]
 *
 * A string is one picture and a list is a stack. Anything the rows do not
 * mention - a fresh upload - is laid out after them automatically, the same
 * way build.py does it, so the rail always shows exactly what the page will.
 *
 * In the rail: click a picture to select it, Shift-click to select a run,
 * Ctrl/Cmd-click to add or remove one. Drag to move - a line shows where it
 * will land: beside a picture, above or below one (a stack), or between rows
 * (a row of its own). Double-click a photo to crop it. The bar along the top
 * makes the selection smaller or bigger, stacks it, gives it a row of its
 * own, or opens the crop.
 *
 * Loaded before admin.js; everything here is called once the admin is up.
 */

// Mirrors RATIOS / ROW_TARGET / VIDEO_AR in build.py - keep them in step.
const ARR_RATIOS = ['1:1', '4:5', '3:4', '2:3', '9:16', '5:4', '4:3', '3:2', '16:9', '2:1', '3:1'];
const ARR_SHAPE_RATIO = { square: '1:1', portrait: '4:5', tall: '2:3', landscape: '3:2', wide: '2:1', panorama: '3:1' };
const ARR_VIDEO_AR = 16 / 9;
const ROW_TARGET = 3.2;

// ---------------------------------------------------------------- the model

function arrPhotoAr(ph) {
  const ratio = ph.ratio || ARR_SHAPE_RATIO[ph.shape] || 'orig';
  if (ratio !== 'orig' && ARR_RATIOS.includes(ratio)) {
    const [w, h] = ratio.split(':').map(Number);
    return w / h;
  }
  const ar = Number(ph.ar);
  return ar > 0 ? Math.min(4, Math.max(0.25, ar)) : 1;
}

// every grid item by its ref, "photo:<id>" / "video:<id>"
function arrItems(shared) {
  const items = new Map();
  (shared.photos || []).forEach((p) => items.set(`photo:${p.id}`, { kind: 'photo', item: p, ar: arrPhotoAr(p), src: p.src }));
  (shared.videos || [])
    .forEach((v) => items.set(`video:${v.id}`, { kind: 'video', item: v, ar: ARR_VIDEO_AR, src: v.poster }));
  return items;
}

const arrUnitAr = (unit, items) => 1 / unit.reduce((a, r) => a + 1 / items.get(r).ar, 0);

// same greedy rule as auto_rows in build.py
function autoRows(units, items) {
  const rows = [];
  let row = [], total = 0;
  for (const u of units) {
    const ar = arrUnitAr(u, items);
    if (row.length && Math.abs(total + ar - ROW_TARGET) > Math.abs(total - ROW_TARGET)) {
      rows.push(row);
      row = []; total = 0;
    }
    row.push(u);
    total += ar;
  }
  if (row.length) {
    if (rows.length && total < ROW_TARGET * 0.6) rows[rows.length - 1].push(...row);
    else rows.push(row);
  }
  return rows;
}

/* The whole of Visuals as the page will show it (the English page - every
 * video included): the Featured rows, then DIVIDER, then the grid's rows.
 * A row is a list of units, a unit always an array of refs here. Keeping
 * both in one list is what lets a drag carry a picture from one to the
 * other; arrStore splits it at the divider again. */
const DIVIDER = '|';

function arrLayout(shared) {
  const items = arrItems(shared);
  const seen = new Set();
  const take = (r) => (typeof r === 'string' && items.has(r) && !seen.has(r) ? (seen.add(r), r) : null);
  const rowsOf = (list) => {
    const rows = [];
    for (const row of list || []) {
      if (!Array.isArray(row)) continue;
      const units = row.map((u) => (Array.isArray(u) ? u : [u]).map(take).filter(Boolean)).filter((u) => u.length);
      if (units.length) rows.push(units);
    }
    return rows;
  };
  const featured = rowsOf(shared.featuredRows);
  const grid = rowsOf(shared.visualsRows);
  const rest = [...items.keys()];
  const order = [...(shared.visualsOrder || []).filter((r) => items.has(r)), ...rest];
  const left = order.map(take).filter(Boolean).map((r) => [r]);
  return [...featured, DIVIDER, ...grid, ...autoRows(left, items)];
}

const isRow = (row) => Array.isArray(row);

// reading order, for the photo and video lists on the tab
function arrRefs(shared) {
  return arrLayout(shared).filter(isRow).flat(2);
}

function arrFeatured(shared) {
  return new Set((shared.featuredRows || []).flat(2));
}

// write a layout back: stacks of one become plain refs again
function arrStore(shared, rows) {
  const clean = (list) => list
    .map((row) => row.map((u) => u.filter(Boolean)).filter((u) => u.length))
    .filter((row) => row.length)
    .map((row) => row.map((u) => (u.length === 1 ? u[0] : u)));
  const at = rows.indexOf(DIVIDER);
  shared.featuredRows = clean(rows.slice(0, at).filter(isRow));
  shared.visualsRows = clean(rows.slice(at + 1).filter(isRow));
  delete shared.visualsOrder;
  markDirty();
}

// a picture on or off the Featured rows, from its card on the tab
function arrSetFeatured(shared, ref, on) {
  const rows = arrLayout(shared);
  const at = rows.indexOf(DIVIDER);
  const moved = arrMove(rows, [ref], { type: 'row', index: on ? at : at + 1 });
  arrStore(shared, moved);
}

function arrRemove(shared, ref) {
  const rows = arrLayout(shared).map((row) => (isRow(row) ? row.map((u) => u.filter((r) => r !== ref)) : row));
  arrStore(shared, rows);
}

// where a ref sits: [row, unit, index in unit]
function arrFind(rows, ref) {
  for (let i = 0; i < rows.length; i++) {
    if (!isRow(rows[i])) continue;
    for (let j = 0; j < rows[i].length; j++) {
      const k = rows[i][j].indexOf(ref);
      if (k !== -1) return [i, j, k];
    }
  }
  return null;
}

/* Move `refs` to `target`, which is one of
 *   { type: 'beside', ref, after }   a unit of its own next to ref's unit
 *   { type: 'stack', ref, after }    into ref's stack, above or below it
 *   { type: 'row', index }           a new row before row `index`
 * The moved refs are blanked where they were rather than spliced out, so
 * every index the target was worked out against still holds. */
function arrMove(rows, refs, target) {
  const moving = new Set(refs);
  const out = rows.map((row) => (isRow(row) ? row.map((u) => u.map((r) => (moving.has(r) ? null : r))) : row));
  if (target.type === 'row') {
    out.splice(target.index, 0, refs.map((r) => [r]));
  } else {
    const at = arrFind(out, target.ref);
    if (!at) return rows;
    const [i, j, k] = at;
    if (target.type === 'stack') out[i][j].splice(k + (target.after ? 1 : 0), 0, ...refs);
    else out[i].splice(j + (target.after ? 1 : 0), 0, ...refs.map((r) => [r]));
  }
  return out;
}

// ---------------------------------------------------------------- the rail

const arr = {
  selected: new Set(),   // refs
  anchor: null,          // where a Shift-click run starts
  undo: [],              // earlier arrangements, newest last
  redo: [],
};

function arrSelectedInOrder(rows) {
  return rows.filter(isRow).flat(2).filter((r) => arr.selected.has(r));
}

const arrSnapshot = (shared) => JSON.stringify({
  featuredRows: shared.featuredRows, visualsRows: shared.visualsRows, visualsOrder: shared.visualsOrder,
});

function arrRestore(shared, snap) {
  const s = JSON.parse(snap);
  for (const k of ['featuredRows', 'visualsRows', 'visualsOrder']) {
    if (s[k] === undefined) delete shared[k]; else shared[k] = s[k];
  }
  markDirty();
  renderPanel();
}

function arrCommit(rows) {
  const shared = SHARED();
  arr.undo.push(arrSnapshot(shared));
  if (arr.undo.length > 100) arr.undo.shift();
  arr.redo = [];
  arrStore(shared, rows);
  renderPanel();
}

/* Ctrl+Z / Cmd+Z undoes the last change to the arrangement, and
 * Ctrl+Shift+Z (or Ctrl+Y) does it again. Only on the Visuals tab, and
 * never while typing - there the keys belong to the text box. */
function arrUndo(back) {
  const from = back ? arr.undo : arr.redo;
  const to = back ? arr.redo : arr.undo;
  if (!from.length) { toast(T(back ? 'Nothing to undo.' : 'Nothing to redo.')); return; }
  const shared = SHARED();
  to.push(arrSnapshot(shared));
  arrRestore(shared, from.pop());
}

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || typeof state === 'undefined' || !state.files) return;
  if (typeof previewKey === 'function' && previewKey() !== 'visuals') return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase();
  if (k === 'z') { e.preventDefault(); arrUndo(!e.shiftKey); }
  else if (k === 'y') { e.preventDefault(); arrUndo(false); }
});

/* Smaller and bigger. A picture's size is how many share its row - every
 * picture in a row is the same height - so these change its row:
 *   bigger:  out of a stack first; otherwise the picture furthest from it
 *            leaves the row, and the rest grow into the room
 *   smaller: the first picture of the next row joins this one (or the last
 *            of the row before, at the bottom of the page) */
function arrResize(dir) {
  const rows = arrLayout(SHARED());
  const sel = arrSelectedInOrder(rows);
  if (!sel.length) return;
  const at = arrFind(rows, sel[0]);
  if (!at) return;
  const [i, j] = at;
  const row = rows[i];

  if (dir > 0) {
    const unit = row[j];
    const loose = unit.filter((r) => arr.selected.has(r));
    if (unit.length > loose.length) {
      // out of the stack, each on its own, straight after it
      row[j] = unit.filter((r) => !arr.selected.has(r));
      row.splice(j + 1, 0, ...loose.map((r) => [r]));
      return arrCommit(rows);
    }
    // the selected units in this row
    const js = sel.map((r) => arrFind(rows, r)).filter((a) => a && a[0] === i).map((a) => a[1]);
    const hi = Math.max(...js), lo = Math.min(...js);
    if (lo === 0 && hi === row.length - 1) { toast(T('That already has the row to itself.')); return; }
    if (hi < row.length - 1) {
      // the last picture moves down to start the next row (of the same zone)
      const gone = row.pop();
      if (!isRow(rows[i + 1])) rows.splice(i + 1, 0, []);
      rows[i + 1].unshift(gone);
    } else {
      // the selection is at the end, so the first picture moves up instead
      const gone = row.shift();
      if (isRow(rows[i - 1])) rows[i - 1].push(gone); else rows.splice(i, 0, [gone]);
    }
    return arrCommit(rows);
  }

  if (isRow(rows[i + 1]) && rows[i + 1].length) {
    row.push(rows[i + 1].shift());
  } else if (isRow(rows[i - 1]) && rows[i - 1].length) {
    row.unshift(rows[i - 1].pop());
  } else {
    toast(T('There is nothing else to share the row with.'));
    return;
  }
  arrCommit(rows);
}

// the selection into one stack, where the first of it is
function arrStack() {
  const rows = arrLayout(SHARED());
  const sel = arrSelectedInOrder(rows);
  if (sel.length < 2) { toast(T('Select two or more pictures to stack them.')); return; }
  arrCommit(arrMove(rows, sel.slice(1), { type: 'stack', ref: sel[0], after: true }));
}

// the selection onto a row of its own, under the row it was in
function arrOwnRow() {
  const rows = arrLayout(SHARED());
  const sel = arrSelectedInOrder(rows);
  if (!sel.length) return;
  const at = arrFind(rows, sel[0]);
  arrCommit(arrMove(rows, sel, { type: 'row', index: at[0] + 1 }));
}

function arrBar(rows, items) {
  const sel = arrSelectedInOrder(rows);
  const one = sel.length === 1 ? items.get(sel[0]) : null;
  const btn = (label, title, onclick, disabled) => el('button', {
    className: 'arr__btn', type: 'button', title: T(title), disabled: disabled || null, onclick,
  }, T(label));
  const history = [
    el('button', { className: 'arr__btn', type: 'button', title: T('Undo (Ctrl+Z)'),
                   disabled: arr.undo.length ? null : true, onclick: () => arrUndo(true) }, '↶'),
    el('button', { className: 'arr__btn', type: 'button', title: T('Redo (Ctrl+Shift+Z)'),
                   disabled: arr.redo.length ? null : true, onclick: () => arrUndo(false) }, '↷'),
  ];
  if (!sel.length) {
    return el('div', { className: 'arr__bar arr__bar--idle' },
      el('span', {}, T('Click to select · Shift/Ctrl-click for more · drag to move · double-click to crop')),
      el('span', { className: 'arr__hist' }, ...history));
  }
  const at = rows.indexOf(DIVIDER);
  const inFeatured = (() => { const f = arrFind(rows, sel[0]); return f && f[0] < at; })();
  return el('div', { className: 'arr__bar' },
    ...history,
    el('span', { className: 'arr__count' }, T('{n} selected', { n: sel.length })),
    btn(inFeatured ? '☆ Unfeature' : '★ Feature',
        inFeatured ? 'Back into the grid, at its top' : 'Up into the Featured rows, at their end',
        () => arrCommit(arrMove(rows, sel, { type: 'row', index: inFeatured ? at + 1 : at }))),
    btn('− Smaller', 'Fit one more picture into its row', () => arrResize(-1)),
    btn('+ Bigger', 'Take a picture out of its row (or out of its stack)', () => arrResize(1)),
    btn('Stack', 'Put the selected pictures one above the other in one column', arrStack, sel.length < 2),
    btn('Own row', 'Give the selection a row to itself', arrOwnRow),
    btn('Crop…', 'Change the shape of this photo', () => arrCrop(one.item), !(one && one.kind === 'photo')),
    el('button', { className: 'arr__btn arr__btn--x', type: 'button', title: T('Clear the selection'),
      onclick: () => { arr.selected.clear(); renderPreview(); } }, '×'));
}

/* The editor, in place of the old schematic grid. Each tile carries the
 * same data-pv as before, so pointing at a photo's card still lights it. */
function arrEditor() {
  const shared = SHARED();
  const items = arrItems(shared);
  const rows = arrLayout(shared);
  // forget anything selected that has since been deleted
  for (const r of [...arr.selected]) if (!items.has(r)) arr.selected.delete(r);

  const tile = (ref) => {
    const it = items.get(ref);
    const ph = it.kind === 'photo' ? it.item : null;
    const img = el('img', { src: '/' + it.src, alt: '', loading: 'lazy', draggable: 'false' });
    if (ph) {
      const f = Array.isArray(ph.focus) ? ph.focus : [50, 50];
      img.style.objectPosition = `${f[0]}% ${f[1]}%`;
      img.style.transformOrigin = `${f[0]}% ${f[1]}%`;
      if (ph.zoom > 1) img.style.transform = `scale(${ph.zoom})`;
    }
    return el('div', {
      className: 'arr__tile' + (arr.selected.has(ref) ? ' is-selected' : '') + (it.kind === 'video' ? ' arr__tile--video' : ''),
      'data-ref': ref,
      'data-pv': 'visuals.cell.' + ref,
      style: `--ar:${it.ar.toFixed(4)}`,
      title: ref,
    }, img, it.kind === 'video' ? el('span', { className: 'pv__celldot' }, '▶') : null);
  };

  const grid = el('div', { className: 'arr__rows' },
    ...rows.map((row, i) => (!isRow(row)
      ? el('div', { className: 'arr__row arr__divider', 'data-row': i },
          el('span', {}, T('↑ Featured — drop pictures above this line to feature them')),
          el('span', {}, T('Grid ↓')))
      : el('div', { className: 'arr__row' + (i < rows.indexOf(DIVIDER) ? ' arr__row--featured' : ''), 'data-row': i },
      ...row.map((unit) => (unit.length > 1
        ? el('div', { className: 'arr__unit arr__stack', style: `--ar:${arrUnitAr(unit, items).toFixed(4)}` }, ...unit.map(tile))
        : el('div', { className: 'arr__unit', style: `--ar:${items.get(unit[0]).ar.toFixed(4)}` }, tile(unit[0]))))))));
  const line = el('div', { className: 'arr__line', hidden: true });
  const root = el('div', { className: 'arr', 'data-pv': 'visuals.grid' }, arrBar(rows, items), grid, line);
  arrWire(root, grid, line, rows, items);
  return root;
}

// ---------------------------------------------------------------- pointer

function arrWire(root, grid, line, rows, items) {
  const order = rows.filter(isRow).flat(2);
  let down = null;     // { ref, x, y, ev }
  let drag = null;     // { refs, ghost, target }

  const select = (ref, e) => {
    if (e.shiftKey && arr.anchor && order.includes(arr.anchor)) {
      const [a, b] = [order.indexOf(arr.anchor), order.indexOf(ref)].sort((x, y) => x - y);
      if (!(e.ctrlKey || e.metaKey)) arr.selected.clear();
      order.slice(a, b + 1).forEach((r) => arr.selected.add(r));
    } else if (e.ctrlKey || e.metaKey) {
      if (arr.selected.has(ref)) arr.selected.delete(ref); else arr.selected.add(ref);
      arr.anchor = ref;
    } else {
      arr.selected.clear();
      arr.selected.add(ref);
      arr.anchor = ref;
    }
    paintSel();
  };

  // in place, not a re-render: a fresh rail between the two clicks of a
  // double-click would never see the double-click
  const paintSel = () => {
    grid.querySelectorAll('.arr__tile').forEach((n) => n.classList.toggle('is-selected', arr.selected.has(n.dataset.ref)));
    root.firstChild.replaceWith(arrBar(rows, items));
  };

  /* Where a drop at (x, y) would land, and the line that says so.
   * Along the top or bottom edge of a row - the outer sixth of it - is a
   * row of its own, above or below: a long line right across. Inside that,
   * a picture's top or bottom quarter stacks above or below it, and
   * otherwise its left or right half goes beside it. Anywhere else, the
   * nearest gap between rows. */
  const aim = (x, y) => {
    const box = root.getBoundingClientRect();
    const show = (l, t, w, h) => {
      line.hidden = false;
      Object.assign(line.style, { left: `${l - box.left}px`, top: `${t - box.top}px`, width: `${w}px`, height: `${h}px` });
    };
    const g = grid.getBoundingClientRect();
    for (const rowEl of grid.querySelectorAll('.arr__row')) {
      const r = rowEl.getBoundingClientRect();
      if (y < r.top - 2 || y > r.bottom + 2) continue;
      const band = rowEl.classList.contains('arr__divider') ? r.height / 2 : Math.max(8, r.height / 6);
      const i = Number(rowEl.dataset.row);
      if (y <= r.top + band) { show(g.left, r.top - 3, g.width, 3); return { type: 'row', index: i }; }
      if (y >= r.bottom - band) { show(g.left, r.bottom, g.width, 3); return { type: 'row', index: i + 1 }; }
    }
    const over = document.elementFromPoint(x, y);
    const t = over && over.closest && over.closest('.arr__tile');
    if (t && grid.contains(t) && !drag.refs.includes(t.dataset.ref)) {
      const r = t.getBoundingClientRect();
      const fy = (y - r.top) / r.height;
      const fx = (x - r.left) / r.width;
      if (fy < 0.25 || fy > 0.75) {
        const after = fy > 0.75;
        show(r.left, after ? r.bottom + 1 : r.top - 4, r.width, 3);
        return { type: 'stack', ref: t.dataset.ref, after };
      }
      const unit = t.closest('.arr__unit').getBoundingClientRect();
      const after = fx > 0.5;
      show(after ? unit.right + 1 : unit.left - 4, unit.top, 3, unit.height);
      return { type: 'beside', ref: t.dataset.ref, after };
    }
    const rowEls = [...grid.querySelectorAll('.arr__row')];
    if (!rowEls.length) return null;
    // inside a row's height but between pictures: beside the nearest one
    for (const rowEl of rowEls) {
      const r = rowEl.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom && x >= r.left && x <= r.right) {
        let best = null, bestD = Infinity;
        for (const tEl of rowEl.querySelectorAll('.arr__tile')) {
          if (drag.refs.includes(tEl.dataset.ref)) continue;
          const tr = tEl.getBoundingClientRect();
          const d = Math.abs(x - (tr.left + tr.width / 2));
          if (d < bestD) { bestD = d; best = tEl; }
        }
        if (best) {
          const unit = best.closest('.arr__unit').getBoundingClientRect();
          const after = x > unit.left + unit.width / 2;
          show(after ? unit.right + 1 : unit.left - 4, unit.top, 3, unit.height);
          return { type: 'beside', ref: best.dataset.ref, after };
        }
      }
    }
    // between rows
    let index = rowEls.length, edge = rowEls[rowEls.length - 1].getBoundingClientRect().bottom + 2;
    for (let i = 0; i < rowEls.length; i++) {
      const r = rowEls[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { index = i; edge = r.top - 3; break; }
    }
    show(g.left, edge, g.width, 3);
    return { type: 'row', index: Number(rowEls[Math.min(index, rowEls.length - 1)].dataset.row) + (index >= rowEls.length ? 1 : 0) };
  };

  const stop = () => {
    if (drag) {
      clearInterval(drag.timer);
      drag.ghost.remove();
      root.classList.remove('is-dragging');
    }
    line.hidden = true;
    down = null;
    drag = null;
  };

  grid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const t = e.target.closest('.arr__tile');
    // pressing on the space between pictures clears the selection
    if (!t) { if (arr.selected.size) { arr.selected.clear(); paintSel(); } return; }
    e.preventDefault();
    down = { ref: t.dataset.ref, x: e.clientX, y: e.clientY, ev: e };
    grid.setPointerCapture(e.pointerId);
  });

  grid.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (!drag) {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) return;
      // dragging something unselected drags just that; a selected one, all of it
      if (!arr.selected.has(down.ref)) {
        arr.selected.clear();
        arr.selected.add(down.ref);
        arr.anchor = down.ref;
        grid.querySelectorAll('.arr__tile').forEach((n) => n.classList.toggle('is-selected', n.dataset.ref === down.ref));
      }
      const refs = order.filter((r) => arr.selected.has(r));
      const ghost = el('div', { className: 'arr__ghost' },
        ...refs.slice(0, 3).map((r) => {
          const src = grid.querySelector(`.arr__tile[data-ref="${CSS.escape(r)}"] img`);
          return el('img', { src: src ? src.src : '', alt: '' });
        }),
        refs.length > 1 ? el('span', {}, String(refs.length)) : null);
      document.body.append(ghost);
      root.classList.add('is-dragging');
      drag = { refs, ghost, target: null };
    }
    drag.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`;
    drag.target = aim(e.clientX, e.clientY);
    drag.x = e.clientX; drag.y = e.clientY;
    // near the top or bottom of the rail, it scrolls, so a picture can be
    // carried to the far end of a long grid
    if (!drag.timer) {
      drag.timer = setInterval(() => {
        const rail = root.closest('.preview');
        if (!drag || !rail) return;
        const r = rail.getBoundingClientRect();
        const step = drag.y < r.top + 50 ? -14 : drag.y > r.bottom - 50 ? 14 : 0;
        if (step) { rail.scrollTop += step; drag.target = aim(drag.x, drag.y); }
      }, 30);
    }
  });

  grid.addEventListener('pointerup', (e) => {
    if (!down) return;
    if (drag) {
      const { refs, target } = drag;
      stop();
      if (target) arrCommit(arrMove(arrLayout(SHARED()), refs, target));
      return;
    }
    const { ref } = down;
    stop();
    select(ref, e);
  });
  grid.addEventListener('pointercancel', stop);
  grid.addEventListener('lostpointercapture', () => { if (drag) stop(); });

  grid.addEventListener('dblclick', (e) => {
    // the grid holds the pointer, so the event names the grid, not the picture
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const t = hit && hit.closest('.arr__tile');
    if (!t) return;
    const it = arrItems(SHARED()).get(t.dataset.ref);
    if (it && it.kind === 'photo') arrCrop(it.item);
    else toast(T('Videos are always 16:9.'));
  });
  // A click on the rail around the grid clears the selection. Not on the
  // grid itself: it holds the pointer while a picture is pressed, so every
  // click on a picture arrives there as a click on the grid.
  root.addEventListener('click', (e) => {
    if (e.target === root && arr.selected.size) { arr.selected.clear(); paintSel(); }
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && arr.selected.size && !document.querySelector('dialog[open]')) {
    arr.selected.clear();
    if (typeof renderPreview === 'function') renderPreview();
  }
});

// ---------------------------------------------------------------- crop

/* Double-click a photo, or Crop… on the bar: its shape (Original - the
 * file's own - or one of ARR_RATIOS), where the crop sits, and how far it
 * is pulled in. The frame shows the picture exactly as the page will:
 * object-fit:cover, object-position at the focus, scaled about it. Drag
 * the picture inside the frame to move what is in view. */
function arrCrop(ph) {
  const dlg = el('dialog', { className: 'crop' });
  const before = { ratio: ph.ratio, focus: ph.focus, zoom: ph.zoom };
  let focus = Array.isArray(ph.focus) ? [...ph.focus] : [50, 50];
  let zoom = Number(ph.zoom) || 1;

  const img = el('img', { src: '/' + ph.src, alt: '', draggable: 'false' });
  const frame = el('div', { className: 'crop__frame' }, img);
  const stage = el('div', { className: 'crop__stage' }, frame);

  const paint = () => {
    const ar = arrPhotoAr(ph);
    // fit the frame inside the stage whatever the shape
    const W = Math.min(560, innerWidth - 120), H = Math.min(420, innerHeight - 330);
    const w = Math.min(W, H * ar);
    frame.style.width = `${w}px`;
    frame.style.height = `${w / ar}px`;
    img.style.objectPosition = `${focus[0]}% ${focus[1]}%`;
    img.style.transformOrigin = `${focus[0]}% ${focus[1]}%`;
    img.style.transform = `scale(${zoom})`;
    chips.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ratio === (ph.ratio || 'orig'))));
  };
  const save = () => {
    const f = focus.map((v) => Math.round(v));
    if (f[0] === 50 && f[1] === 50) delete ph.focus; else ph.focus = f;
    const z = Math.round(zoom * 100) / 100;
    if (z > 1) ph.zoom = z; else delete ph.zoom;
    markDirty();
  };

  const chips = el('div', { className: 'crop__chips' },
    ...['orig', ...ARR_RATIOS].map((r) => el('button', {
      type: 'button', 'data-ratio': r, className: 'crop__chip',
      onclick: () => { ph.ratio = r; markDirty(); paint(); },
    }, r === 'orig' ? T('Original') : r)));

  const slider = el('input', { type: 'range', min: '1', max: '3', step: '0.01', value: String(zoom) });
  slider.addEventListener('input', () => { zoom = Number(slider.value); paint(); save(); });

  // drag the picture: moving it left shows more of its right-hand side
  let from = null;
  frame.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    frame.setPointerCapture(e.pointerId);
    from = { x: e.clientX, y: e.clientY, f: [...focus] };
  });
  frame.addEventListener('pointermove', (e) => {
    if (!from) return;
    const r = frame.getBoundingClientRect();
    // how much of the picture is out of view on each axis, in frame units
    const nat = (img.naturalWidth / img.naturalHeight) || arrPhotoAr(ph);
    const fa = r.width / r.height;
    const spanX = Math.max(0.0001, (nat > fa ? nat / fa : 1) * zoom - 1);
    const spanY = Math.max(0.0001, (nat > fa ? 1 : fa / nat) * zoom - 1);
    focus = [
      Math.min(100, Math.max(0, from.f[0] - ((e.clientX - from.x) / r.width) / spanX * 100)),
      Math.min(100, Math.max(0, from.f[1] - ((e.clientY - from.y) / r.height) / spanY * 100)),
    ];
    paint();
  });
  const letGo = () => { if (from) { from = null; save(); } };
  frame.addEventListener('pointerup', letGo);
  frame.addEventListener('pointercancel', letGo);

  const close = () => { dlg.close(); dlg.remove(); renderPanel(); };
  dlg.append(
    el('h2', { className: 'crop__title' }, T('Crop')),
    chips,
    stage,
    el('label', { className: 'crop__zoom' }, el('span', {}, T('Zoom')), slider),
    el('p', { className: 'hint' }, T('Drag the picture to choose what stays in view. Original keeps the whole photo.')),
    el('div', { className: 'crop__actions' },
      el('button', { className: 'btn btn--ghost', type: 'button', onclick: () => {
        ph.ratio = 'orig'; focus = [50, 50]; zoom = 1; slider.value = '1'; save(); paint();
      } }, T('Reset')),
      el('button', { className: 'btn btn--ghost', type: 'button', onclick: () => {
        for (const [k, v] of Object.entries(before)) { if (v === undefined) delete ph[k]; else ph[k] = v; }
        markDirty();
        close();
      } }, T('Cancel')),
      el('button', { className: 'btn', type: 'button', onclick: close }, T('Done'))));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dlg);
  dlg.showModal();
  paint();
}

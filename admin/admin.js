/* Tony D site admin.
 *
 * Edits content/shared.json, content/en.json and content/zh.json in the
 * browser and posts them to the admin Worker, which commits them to the draft
 * branch. Nothing here talks to GitHub directly — that is deliberate, so the
 * admin works from mainland China where api.github.com is unreliable.
 *
 * The English and Chinese fields for the same item sit next to each other on
 * purpose: the site's long-standing hazard is editing one page and forgetting
 * the other, and pairing them makes that hard to do.
 *
 * Vanilla JS, no build step, matching the site it edits.
 */

const API = '/api/admin';

const state = {
  headSha: null,
  files: null,
  dirty: false,
  tab: 'home',
  // which fold's preview the rail is showing, if not the tab's own
  section: null,
  status: null,
};

const SHARED = () => state.files['content/shared.json'];
const LOC = (lang) => state.files[`content/${lang}.json`];

/* The two content languages. Addressed by name (LANG.en / LANG.zh) wherever
 * the code means a specific one — a `lang` attribute, which file to write —
 * because those meanings must not move when the panel is reordered. */
const LANG = {
  en: { code: 'en', label: 'EN', cls: 'tag--en', attr: 'en' },
  zh: { code: 'zh', label: '中文', cls: 'tag--zh', attr: 'zh-Hans' },
};

/* …and by position wherever a pair is laid out side by side, which is where
 * the interface language decides the order. Editing the Chinese page while
 * every Chinese box sits in the right-hand column means reading across the
 * English one all day; whichever language you are working in comes first.
 * The tag on each field still says which is which, so the pair never becomes
 * ambiguous when the order flips. */
const langOrder = () => (UI.lang === 'zh' ? [LANG.zh, LANG.en] : [LANG.en, LANG.zh]);

/* The frames of the hero's handwriting loop.
 *
 * It used to be exactly two images - `ink` and an optional `inkName` - timed
 * against each other by the stylesheet. It is a list now, so any number of
 * pieces can take turns and the hold is a number rather than a keyframe. The
 * old pair is still read when there is no list yet, so content that has not
 * been through the new form still renders. */
function heroLoopFrames(shared) {
  const images = shared.images || {};
  const loop = images.inkLoop;
  if (loop && Array.isArray(loop.frames)) return loop.frames.filter(Boolean);
  return [images.ink, images.inkName].filter(Boolean);
}

// ---------------------------------------------------------------- helpers

function el(tag, props, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'className') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function markDirty() {
  state.dirty = true;
  document.getElementById('saveBtn').disabled = false;
  renderStatus();
  // typing repaints the little page in the corner, a beat behind
  renderPreviewSoon();
}

function toast(message, kind, detail) {
  const node = document.getElementById('toast');
  node.className = 'toast' + (kind ? ` toast--${kind}` : '');
  node.replaceChildren(
    el('div', {}, message),
    detail ? el('p', { className: 'toast__detail' }, detail) : null,
  );
  node.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { node.hidden = true; }, kind === 'bad' ? 9000 : 4000);
}

async function api(path, init) {
  const res = await fetch(API + path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }

  if (!res.ok) {
    const err = new Error((body && body.error) || `Request failed (${res.status})`);
    err.detail = body && body.detail;
    err.status = res.status;
    throw err;
  }
  return body;
}

const slug = (s) =>
  (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function newId(prefix, taken) {
  let base = prefix || 'item';
  let n = 1;
  let id = base;
  while (taken.includes(id)) id = `${base}-${++n}`;
  return id;
}

// ---------------------------------------------------------------- controls

function input(obj, key, opts = {}) {
  // a content string is authored HTML, so it gets a box that shows the
  // words rather than the markup; paths, ids and lang codes stay literal
  if (opts.rich) return richBox(obj, key, opts);
  const node = opts.multiline ? el('textarea') : el('input', { type: 'text' });
  node.value = obj[key] ?? '';
  if (opts.lang) node.setAttribute('lang', opts.lang);
  if (opts.mono) node.className = 'mono';
  if (opts.rows) node.rows = opts.rows;
  if (opts.placeholder) node.placeholder = opts.placeholder;
  node.addEventListener('input', () => {
    if (node.value === '' && opts.dropWhenEmpty) delete obj[key];
    else obj[key] = node.value;
    if (opts.onChange) opts.onChange(node.value);
    markDirty();
  });
  return node;
}

/* label and hint are translated here rather than at the call sites: every
 * form control on every tab goes through this one function, so the panel
 * changes language without a hundred edits. T() passes anything it has no
 * translation for straight back, so an untranslated label still renders. */
function field(label, control, hint, tag, pv) {
  // A rich box carries its own controls, and they belong on the label's
  // line rather than above the box - one row per field either way.
  const isRich = control && control.classList && control.classList.contains('rich__box');
  return el(
    'label',
    { className: 'f' + (isRich ? ' f--rich' : ''), 'data-pv-target': pv },
    el('span', {}, T(label),
      tag ? el('span', { className: `tag ${tag.cls}` }, tag.label) : null,
      isRich ? richToolbar(control, tag) : null),
    control,
    hint ? el('p', { className: 'hint', html: T(hint) }) : null,
  );
}

function row(...kids) {
  return el('div', { className: 'row' }, ...kids);
}

/** The same field in both locales, side by side, working language first. */
function bi(label, key, getObj, opts = {}) {
  // Everything bi() edits is copy, so it gets the rich box unless it is
  // something literal - a lang code or a path, which carry `mono`.
  const rich = opts.rich !== false && !opts.mono;
  return el('div', { className: 'row', 'data-pv-target': opts.pv },
    ...langOrder().map((lang, i) =>
      field(
        T(label),
        input(getObj(lang.code), key, { ...opts, rich, lang: lang.attr }),
        // the hint describes the field, not the language, so it goes under
        // the leading column rather than always under the English one
        i === 0 ? (opts.hint ? T(opts.hint) : null) : null,
        lang,
      ),
    ),
  );
}

function check(label, obj, key, onChange) {
  const box = el('input', { type: 'checkbox' });
  box.checked = !!obj[key];
  box.addEventListener('change', () => {
    obj[key] = box.checked;
    markDirty();
    if (onChange) onChange();
  });
  return el('label', { className: 'check' }, box, el('span', {}, T(label)));
}

function listControls(arr, index, rerender, { onDelete } = {}) {
  const move = (to) => {
    if (to < 0 || to >= arr.length) return;
    const [item] = arr.splice(index, 1);
    arr.splice(to, 0, item);
    markDirty();
    rerender();
  };
  return el(
    'div',
    { className: 'listctl' },
    el('button', { className: 'btn btn--small btn--ghost', type: 'button', title: T('Move up'),
                   onclick: () => move(index - 1) }, '↑'),
    el('button', { className: 'btn btn--small btn--ghost', type: 'button', title: T('Move down'),
                   onclick: () => move(index + 1) }, '↓'),
    el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                   onclick: () => {
                     if (!confirm(T('Remove this item? It disappears from both languages.'))) return;
                     const [gone] = arr.splice(index, 1);
                     if (onDelete) onDelete(gone);
                     markDirty();
                     rerender();
                   } }, T('Remove')),
  );
}

/* A card title is usually a plain string to translate, but some are built
 * nodes carrying a name from the content (a video's own title), which is not
 * the admin's language to change. */
function card(titleNode, controls, body, pv) {
  const title = typeof titleNode === 'string' ? T(titleNode) : titleNode;
  return el(
    'div',
    { className: 'card', 'data-pv-target': pv },
    el('div', { className: 'card__head' }, el('div', { className: 'card__title' }, title), controls),
    el('div', { className: 'card__body' }, body),
  );
}

function addButton(label, onClick) {
  return el('button', { className: 'additem', type: 'button', onclick: onClick }, T(label));
}

function intro(html) {
  return el('p', { className: 'intro', html: T(html) });
}

// ---------------------------------------------------------------- uploads

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Upload straight to the draft branch. Uploads commit immediately rather than
 * waiting for Save, because a half-saved image reference is worse than an
 * unreferenced file sitting in the repo.
 */
async function uploadInto(dir, file, onDone) {
  const name = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const path = `${dir}/${name}`;
  toast(T('Uploading {name}…', { name }));
  try {
    const b64 = await fileToBase64(file);
    const res = await api('/upload', {
      method: 'POST',
      body: JSON.stringify({ path, contentBase64: b64 }),
    });
    state.headSha = res.commit;
    toast(T('Uploaded {path}', { path }), 'good',
          T('It is on the draft branch — Publish to put it on the live site.'));
    onDone(path, file);
  } catch (err) {
    toast(err.message, 'bad', err.detail);
  }
}

function uploadButton(dir, label, onDone) {
  const picker = el('input', { type: 'file', accept: '.webp,.jpg,.jpeg,.png' });
  picker.style.display = 'none';
  picker.addEventListener('change', () => {
    if (picker.files[0]) uploadInto(dir, picker.files[0], onDone);
    picker.value = '';
  });
  return el(
    'span',
    {},
    el('button', { className: 'btn btn--small', type: 'button', onclick: () => picker.click() }, T(label)),
    picker,
  );
}

// ---------------------------------------------------------------- tabs

/* One tab per page of the site, in the order the nav has them.
 *
 * The tabs used to be named after the shapes in the JSON - Videos, Releases,
 * Milestones, Images, Hero & nav - which meant knowing which file a thing
 * lived in before you could find it. They are now named after the pages, so
 * "change the wording under Music" is one tab, and each page's own title,
 * heading, text and pictures sit together the way they do on the page.
 *
 * Milestones are inside About and the images sit with whatever references
 * them, because that is how the pages are actually put together.
 */
const TABS = [
  { id: 'home', label: 'Tony D', render: renderHome },
  { id: 'music', label: 'Music', render: renderMusic },
  { id: 'visuals', label: 'Visuals', render: renderVisuals },
  { id: 'about', label: 'About', render: renderAboutPage },
  { id: 'making', label: 'In the Making', render: renderMaking },
  { id: 'contact', label: 'Contact & footer', render: renderContactPage },
  { id: 'raw', label: 'Raw JSON', render: renderRaw },
];

/* Tab names are editable: double-click one and type.
 *
 * A rename is stored in `shared.adminTabs`, keyed by tab id, and only when it
 * differs from the built-in name above - so the defaults can be improved later
 * without every site carrying a frozen copy of them, and renaming a tab back
 * to its default removes the override rather than pinning it.
 *
 * It lives in shared.json rather than in this browser because the admin has
 * two editors: a name only one of them could see would be worse than no
 * renaming at all. That does mean a rename is a content change like any other
 * - it marks the panel dirty, and it takes Save draft and Publish to stick.
 * build.py ignores the key, so it never reaches the pages.
 */
const DEFAULT_TAB_LABEL = Object.fromEntries(TABS.map((t) => [t.id, t.label]));

/* A rename is stored once and shown in both interface languages: it is one
 * editor telling the other what this tab is, not a translation. Only the
 * built-in names follow the switch. */
function tabLabel(id) {
  const names = state.files ? SHARED().adminTabs : null;
  return (names && names[id]) || T(DEFAULT_TAB_LABEL[id]);
}

function setTabLabel(id, label) {
  const shared = SHARED();
  const names = shared.adminTabs || (shared.adminTabs = {});
  // Typing the built-in name back in clears the override rather than pinning
  // it - compared against the name actually on screen, so it works in either
  // language.
  if (label === T(DEFAULT_TAB_LABEL[id])) delete names[id];
  else names[id] = label;
  if (!Object.keys(names).length) delete shared.adminTabs;
}

// The page keys build.py uses. `press` is the In the Making page: the file is
// making.html but the key kept its old name, so that existing #press links
// still land somewhere sensible. See render_making in build.py.
const PAGE_KEY = { home: 'home', music: 'music', visuals: 'videos',
                   about: 'about', making: 'press' };

/** Title and meta description for one page. */
function pageMeta(tabId) {
  const key = PAGE_KEY[tabId];
  return card('Browser tab & search results', null, el('div', {},
    bi('Page title', 'title', (l) => LOC(l).pages[key]),
    bi('Meta description', 'description', (l) => LOC(l).pages[key], { multiline: true, rows: 2 }),
  ));
}

/** The numbered heading at the top of one section, in both locales. */
function sectionHeading(key, pv) {
  const en = LOC('en').sections[key];
  const zh = LOC('zh').sections[key];
  if (!en || !zh) return null;
  const sec = { en, zh };
  return card('Heading', null, el('div', {},
    el('p', { className: 'hint' },
      T('The heading and the line under it. You can also double-click either of them in '
        + 'the preview and type straight into it.')),
    el('span', { className: 'hint' }, `#${key}`),
    row(
      ...langOrder().map((lang) =>
        field('Title', input(sec[lang.code], 'title', { lang: lang.attr }), null, lang)),
    ),
    row(
      ...langOrder().map((lang, i) =>
        field('Description',
              input(sec[lang.code], 'desc', { multiline: true, rows: 2, lang: lang.attr }),
              i === 0
                ? 'Stays on one line when the window is wide enough. Press Enter where you want it to break instead.'
                : null,
              lang)),
    ),
  ), pv);
}

// ---------------------------------------------------------------- videos

function renderVideos() {
  const shared = SHARED();
  const rerender = () => renderPanel();
  const out = [];

  shared.videos.forEach((v, i) => {
    const enV = LOC('en').videos[v.id] || (LOC('en').videos[v.id] = { title: '', sub: '' });
    const zhV = LOC('zh').videos[v.id] || (LOC('zh').videos[v.id] = { title: '', sub: '' });

    const badge = v.bv
      ? el('span', { className: 'live' }, T('B站 live'))
      : el('span', { className: 'pending' }, T('B站 pending'));

    const title = el(
      'span',
      {},
      enV.title || T('(untitled)'),
      ' ',
      badge,
      v.feature ? el('span', { className: 'live' }, T('feature')) : null,
      el('small', {}, v.id),
    );

    const thumb = el('img', {
      className: 'vidrow__thumb',
      src: '/' + v.poster,
      alt: '',
      loading: 'lazy',
    });

    const body = el(
      'div',
      { className: 'vidrow' },
      el(
        'div',
        {},
        thumb,
        el('div', { style: 'margin-top:8px' },
          uploadButton('img/video', 'Replace poster', (path) => {
            v.poster = path;
            markDirty();
            rerender();
          })),
      ),
      el(
        'div',
        { className: 'vidrow__fields' },
        row(
          field('YouTube ID', input(v, 'yt', { mono: true }),
                'The part after <code>youtu.be/</code>. Also names the poster file.'),
          field('Bilibili BV ID', input(v, 'bv', { mono: true, placeholder: 'BV1xx411c7mD', onChange: rerenderSoon }),
                'Leave empty until the video is on B站.'),
        ),
        bi('Title', 'title', (l) => (l === 'en' ? enV : zhV)),
        bi('Subtitle', 'sub', (l) => (l === 'en' ? enV : zhV)),
        v.feature ? bi('Kicker', 'kicker', (l) => (l === 'en' ? enV : zhV),
                       { hint: 'Small label above the title on the feature tile.' }) : null,
        row(
          check('Feature tile (large, above the grid)', v, 'feature', rerender),
          field('Poster path', input(v, 'poster', { mono: true }),
                'Posters are kept in this repository on purpose. They used to be hot-linked '
                + 'from i.ytimg.com, which is blocked in mainland China — the Chinese page '
                + 'showed thirteen broken images. Do not paste a YouTube thumbnail URL here.'),
          v.feature ? null : field('Size in the grid', choice(v, 'size', PHOTO_SIZES)),
        ),
        el('details', {}, el('summary', { className: 'hint' }, T('Language attributes')),
           row(
             field('EN title lang attr', input(enV, 'titleLang', { mono: true, dropWhenEmpty: true }),
                   'Set to <code>zh</code> if this title is Chinese on the English page.'),
             field('中文 title lang attr', input(zhV, 'titleLang', { mono: true, dropWhenEmpty: true }),
                   'Set to <code>en</code> if this title stays English on the Chinese page.'),
           )),
      ),
    );

    out.push(card(title, listControls(shared.videos, i, rerender, {
      onDelete: (gone) => {
        delete LOC('en').videos[gone.id];
        delete LOC('zh').videos[gone.id];
      },
    }), body));
  });

  out.push(addButton('+ Add a video', () => {
    const id = newId('video', shared.videos.map((v) => v.id));
    shared.videos.push({ id, yt: '', bv: '', poster: 'img/video/placeholder.webp', feature: false });
    LOC('en').videos[id] = { title: '', sub: '' };
    LOC('zh').videos[id] = { title: '', sub: '' };
    markDirty();
    rerender();
  }));

  return out;
}

let rerenderTimer = null;
function rerenderSoon() {
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(renderPanel, 600);
}

// ---------------------------------------------------------------- releases

function linksEditor(locale, obj) {
  const rerender = () => renderPanel();
  const list = obj.links || (obj.links = []);

  return el(
    'div',
    {},
    el('span', { className: 'hint' }, T('Links ({locale})', { locale: LANG[locale].label })),
    ...list.map((link, i) =>
      row(
        field('Label', input(link, 'label', { lang: locale === 'zh' ? 'zh-Hans' : 'en' })),
        field('URL', input(link, 'url', { mono: true }),
              'Leave empty and tick “unknown” to grey it out.'),
        el('div', { style: 'flex:0 0 auto;display:flex;gap:8px;align-items:flex-end' },
           check('unknown', link, 'missing'),
           el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                          onclick: () => { list.splice(i, 1); markDirty(); rerender(); } }, '×')),
      ),
    ),
    el('button', { className: 'btn btn--small', type: 'button',
                   onclick: () => { list.push({ label: '', url: '' }); markDirty(); rerender(); } },
       T('+ link')),
  );
}

/* The labels over a sleeve.
 *
 * This was one checkbox and one word. A record can want more than one - new,
 * and a single, and whatever else - so it is a list now, and each language
 * keeps its own, because "New" is not a word the Chinese page should show.
 *
 * The old boolean is migrated the first time a tag is edited rather than on
 * render, so opening the tab never marks the panel dirty.
 */
function releaseTags(rel, c) {
  if (Array.isArray(c.tags)) return c.tags;
  return (rel.badge && c.badge) ? [c.badge] : [];
}

function tagsEditor(rel) {
  const rerender = () => renderPanel();

  return el('div', { className: 'row' }, ...langOrder().map((lang) => {
    const c = LOC(lang.code).releases[rel.id];
    const tags = releaseTags(rel, c);

    const commit = (next) => {
      c.tags = next;
      // the boolean and the single label have no meaning once there is a list
      delete c.badge;
      delete rel.badge;
      markDirty();
      rerender();
    };

    return el('div', { className: 'tags' },
      el('span', { className: 'hint' },
        T('Tags'), ' ', el('span', { className: 'tag ' + lang.cls }, lang.label)),
      el('div', { className: 'tags__row' },
        ...tags.map((text, i) => {
          const box = el('input', { type: 'text', className: 'tags__input', lang: lang.attr });
          box.value = text;
          box.addEventListener('input', () => {
            const next = tags.slice();
            next[i] = box.value;
            c.tags = next;
            delete c.badge;
            delete rel.badge;
            markDirty();
            renderPreviewSoon();
          });
          return el('span', { className: 'tags__item' },
            box,
            el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                           onclick: () => commit(tags.filter((_, j) => j !== i)) }, '×'));
        }),
        el('button', { className: 'btn btn--small', type: 'button',
                       onclick: () => commit([...tags, '']) }, T('+ tag'))),
      tags.length ? null : el('p', { className: 'hint' }, T('No labels on this cover.')));
  }));
}

/* ---- the disc behind a sleeve ----
 *
 * Pull a record out of its sleeve on the Music page and the track list is
 * written around the rim, with the title track picked out in the accent and
 * a word on the label in the middle - the easter egg. All three are per
 * language, because the Chinese page names the same songs differently.
 *
 * Track order is the order they are written round the ring, so it matters.
 */
function discEditor(rel) {
  const rerender = () => renderPanel();
  if (rel.disc === false) return null;

  const body = el('div', {},
    el('p', { className: 'hint' },
      T('The track list written around the rim of the record, the one picked out in colour, '
        + 'and the word on the label in the middle. Drag to reorder — the order here is the '
        + 'order round the ring.')),
    el('div', { className: 'row' }, ...langOrder().map((lang) => {
      const c = LOC(lang.code).releases[rel.id];
      const tracks = c.discTracks || (c.discTracks = []);

      const rows = tracks.map((name, i) => {
        // a holder object, so the rich box can write through to the array
        const slot = { get value() { return tracks[i]; }, set value(v) { tracks[i] = v; } };
        const box = richBox(slot, 'value', {
          lang: lang.attr,
          onChange: (html) => {
            // the title track is stored by name, so renaming it has to follow
            if (c.discTitleTrack === name && name !== html) c.discTitleTrack = html;
          },
        });
        const node = el('div', { className: 'ms' },
          el('span', { className: 'ms__grip', title: T('Drag to reorder') }, '⠿'),
          el('div', { className: 'ms__fields' },
            el('div', { className: 'rich__inline' }, box, richToolbar(box, lang))),
          el('div', { className: 'ms__ctl' },
            el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                           onclick: () => {
                             const [gone] = tracks.splice(i, 1);
                             if (c.discTitleTrack === gone) delete c.discTitleTrack;
                             markDirty();
                             rerender();
                           } }, '×')));
        return dragReorder(node, i, tracks, () => { markDirty(); rerender(); });
      });

      // stored by name rather than index, so the picker lists what is there
      const titleSel = el('select', {});
      titleSel.append(el('option', { value: '' }, T('none')));
      tracks.forEach((n) => {
        const opt = el('option', { value: n, html: n });
        if (c.discTitleTrack === n) opt.selected = true;
        titleSel.append(opt);
      });
      titleSel.addEventListener('change', () => {
        if (titleSel.value) c.discTitleTrack = titleSel.value;
        else delete c.discTitleTrack;
        markDirty();
      });

      return el('div', { style: 'flex:1;min-width:0' },
        el('span', { className: 'hint' },
          T('Tracks'), ' ', el('span', { className: 'tag ' + lang.cls }, lang.label)),
        ...rows,
        tracks.length ? null : el('p', { className: 'hint' }, T('No tracks on this record yet.')),
        el('button', { className: 'btn btn--small', type: 'button',
                       onclick: () => { tracks.push(''); markDirty(); rerender(); } },
           T('+ track')),
        field('Picked out in colour', titleSel,
              'The track that shares its name with the record, usually.'),
        field('Word on the label', input(c, 'discSecret', { lang: lang.attr, dropWhenEmpty: true }),
              'The easter egg in the middle of the disc. Leave empty for none.'));
    })),
  );

  return card('The record inside', null, body, 'music.release.' + rel.id);
}

/* Which year groups are open. UI state, so it is kept here rather than on
 * the content - everything on those objects is written to GitHub on the
 * next save, and whether someone expanded a list is not the site's business.
 * Keyed by record, language and year so two languages can differ. */
const singlesOpen = new Set();

/* ---- the singles card ----
 * Not one record but a list of years, each with what came out in it. Five
 * years across two languages is a long scroll of one-line fields, so each
 * year is shut until it is opened. */
function singlesEditor(rel) {
  const rerender = () => renderPanel();
  const any = ['en', 'zh'].some((l) => Array.isArray(LOC(l).releases[rel.id].singlesByYear));
  if (!any) return null;

  return card('Singles by year', null, el('div', {},
    el('p', { className: 'hint' },
      T('The list inside the singles card. Newest year first is how it reads on the page — '
        + 'drag a year to move it.')),
    el('div', { className: 'row' }, ...langOrder().map((lang) => {
      const c = LOC(lang.code).releases[rel.id];
      const years = c.singlesByYear || (c.singlesByYear = []);

      const addYear = el('button', { className: 'btn btn--small', type: 'button',
        onclick: () => {
          const year = String(new Date().getFullYear());
          years.unshift({ year, tracks: [] });
          // a year you just made is one you are about to fill in
          singlesOpen.add(`${rel.id}:${lang.code}:${year}`);
          markDirty();
          rerender();
        } }, T('+ year'));

      return el('div', { className: 'singles' },
        el('span', { className: 'hint' },
          T('Years'), ' ', el('span', { className: 'tag ' + lang.cls }, lang.label)),
        // newest first on the page, so the way in is at the top
        addYear,
        ...years.map((y, yi) => {
          const tracks = y.tracks || (y.tracks = []);
          const mark = `${rel.id}:${lang.code}:${y.year}`;

          const node = el('details', {
            className: 'singles__year',
            open: singlesOpen.has(mark) || null,
          },
            el('summary', { className: 'singles__head' },
              el('span', { className: 'ms__grip', title: T('Drag to reorder') }, '⠿'),
              el('span', { className: 'singles__year-label' }, y.year || T('(no year)')),
              el('span', { className: 'singles__count' },
                T(tracks.length === 1 ? '{n} single' : '{n} singles', { n: tracks.length }))),
            el('div', { className: 'singles__body' },
              row(
                field('Year', input(y, 'year', { mono: true, onChange: rerenderSoon })),
                el('div', { style: 'display:flex;align-items:flex-end' },
                  el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                                 onclick: () => {
                                   if (!confirm(T('Remove this year and everything in it?'))) return;
                                   years.splice(yi, 1);
                                   markDirty();
                                   rerender();
                                 } }, T('Remove the year')))),
              ...tracks.map((name, ti) => {
                const slot = {
                  get value() { return tracks[ti]; },
                  set value(v) { tracks[ti] = v; },
                };
                const box = richBox(slot, 'value', { lang: lang.attr });
                return el('div', { className: 'singles__track' },
                  box, richToolbar(box, lang),
                  el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                                 onclick: () => { tracks.splice(ti, 1); markDirty(); rerender(); } },
                     '×'));
              }),
              el('button', { className: 'btn btn--small', type: 'button',
                             onclick: () => { tracks.push(''); markDirty(); rerender(); } },
                 T('+ single'))));

          node.addEventListener('toggle', () => {
            if (node.open) singlesOpen.add(mark);
            else singlesOpen.delete(mark);
          });
          return dragReorder(node, yi, years, () => { markDirty(); rerender(); });
        }));
    })),
  ), 'music.release.' + rel.id);
}

function renderReleases() {
  const shared = SHARED();
  const rerender = () => renderPanel();
  const out = [];

  shared.releases.forEach((r, i) => {
    const enR = LOC('en').releases[r.id];
    const pick = (l) => LOC(l).releases[r.id];

    const body = el('div', {},
      row(
        el('div', {},
          el('img', { src: '/' + r.art, alt: '', loading: 'lazy',
                      style: 'width:120px;border-radius:5px;display:block;margin-bottom:8px' }),
          uploadButton('img', 'Replace cover', (path) => { r.art = path; markDirty(); rerender(); })),
        el('div', {},
          field('Cover path', input(r, 'art', { mono: true })),
          bi('Cover description', 'alt', pick,
             { hint: 'Describes the cover for screen readers.' })),
      ),
      bi('Name', 'title', pick,
         { hint: 'One language or two. Select the part in the other language and press the '
                 + '<b>EN</b> / <b>中文</b> button — it marks that span, which is what makes a '
                 + 'screen reader switch voice and the right typeface load.' }),
      bi('Kind and year', 'meta', pick,
         { hint: 'The line under the name — <b>Album · 2025</b>, or a range for the singles. '
                 + 'Leave it empty for nothing.', dropWhenEmpty: true }),
      bi('Publisher', 'label', pick,
         { hint: 'Shown after the year on the Music page only, not on the homepage. Leave it '
                 + 'empty for nothing.', dropWhenEmpty: true }),
      bi('Description', 'copy', pick, { multiline: true, rows: 2, dropWhenEmpty: true }),
      el('p', { className: 'hint' },
        T('Labels shown over the top-left corner of the cover. Add as many as the record needs.')),
      tagsEditor(r),
      row(...langOrder().map((lang) => linksEditor(lang.code, pick(lang.code)))),
    );

    const node = card(
      el('span', {}, el('span', { className: 'ms__grip', title: T('Drag to reorder') }, '⠿'), ' ',
         enR.title.replace(/<[^>]+>/g, ''), el('small', {}, r.id)),
      listControls(shared.releases, i, rerender, {
        onDelete: (gone) => { delete LOC('en').releases[gone.id]; delete LOC('zh').releases[gone.id]; },
      }),
      body,
      'music.release.' + r.id,
    );
    out.push(dragReorder(node, i, shared.releases, () => { markDirty(); rerender(); }));

    const disc = discEditor(r);
    if (disc) out.push(disc);
    const singles = singlesEditor(r);
    if (singles) out.push(singles);
  });

  out.push(addButton('+ Add a release', () => {
    const id = newId('release', shared.releases.map((r) => r.id));
    shared.releases.push({ id, art: 'img/album-overthinking.webp' });
    for (const l of ['en', 'zh']) {
      LOC(l).releases[id] = { alt: '', title: '', meta: '', copy: '', tags: [], links: [] };
    }
    markDirty();
    rerender();
  }));

  return out;
}


// ---------------------------------------------------------------- about

function paragraphList(locale, aboutObj, key, label) {
  const rerender = () => renderPanel();
  const list = aboutObj[key] || (aboutObj[key] = []);
  const lang = locale === 'zh' ? 'zh-Hans' : 'en';

  return el(
    'div',
    {},
    ...list.map((_, i) =>
      el('div', { style: 'margin-bottom:10px' },
         field(`${T(label)} ${i + 1}`,
               input(list, String(i), { multiline: true, rows: 4, lang }),
               null,
               LANG[locale]),
         el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                        onclick: () => { list.splice(i, 1); markDirty(); rerender(); } },
            T('Remove paragraph'))),
    ),
    el('button', { className: 'btn btn--small', type: 'button',
                   onclick: () => { list.push(''); markDirty(); rerender(); } }, T('+ paragraph')),
  );
}

function renderAbout() {
  const rerender = () => renderPanel();
  const enA = LOC('en').about;
  const zhA = LOC('zh').about;
  const out = [];

  const about = { en: enA, zh: zhA };

  out.push(card('Bio paragraphs', null, el('div', {},
    row(...langOrder().map((lang) => paragraphList(lang.code, about[lang.code], 'prose', 'Paragraph'))),
  ), 'about.prose'));

  out.push(card('Blurb', null, el('div', {},
    el('p', { className: 'hint' },
      T('The line set apart from the rest of the bio, between the paragraphs.')),
    bi('Blurb', 'quote', (l) => about[l])), 'about.quote'));

  out.push(card('Paragraphs after the quote', null, el('div', {},
    row(...langOrder().map((lang) =>
      paragraphList(lang.code, about[lang.code], 'proseAfterQuote', 'Paragraph'))),
  )));

  // Profile table
  const facts = el('div', { className: 'row' }, ...langOrder().map((lang) => {
    const list = about[lang.code].facts;
    return el('div', { style: 'flex:1' },
      el('span', { className: 'hint' }, T('Profile rows ({lang})', { lang: lang.label })),
      ...list.map((item, i) => row(
        field('Term', input(item, 'term', { lang: lang.attr })),
        field('Value', input(item, 'value', { lang: lang.attr })),
        el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                       onclick: () => { list.splice(i, 1); markDirty(); rerender(); } }, '×'),
      )),
      el('button', { className: 'btn btn--small', type: 'button',
                     onclick: () => { list.push({ term: '', value: '' }); markDirty(); rerender(); } },
         T('+ row')),
    );
  }));
  out.push(card('Stats', null, el('div', {},
    el('p', { className: 'hint' },
      T('The table beside the bio. Each row is a label and a value; add and remove as many '
        + 'as you like, and each language keeps its own rows.')),
    facts), 'about.stats'));

  out.push(card('Headings', null, el('div', {},
    bi('Stats heading', 'profileHeading', (l) => about[l]),
  ), 'about.stats'));


  return out;
}

// ------------------------------------------------------------- rich text

/* Text fields that show the words rather than the markup.
 *
 * Every string in content/ is authored HTML, and the form used to hand it
 * over raw: a track called "If It's True" appeared in the box as
 * `If It&rsquo;s True`, and a bold word as `<b>…</b>`. That is fine if you
 * know HTML and awful if you do not, which is the wrong way round for a
 * panel Tony is meant to use.
 *
 * So the box is contenteditable: the stored HTML goes in as HTML, so it
 * renders, and what comes back out is serialised to the same small subset.
 * The whole site only uses <b>, <strong>, <em>, <span lang> and one
 * class="key", so that subset is short and everything outside it is thrown
 * away rather than trusted - a paste from Word arrives wrapped in font tags
 * and inline styles, and none of it survives.
 *
 * A consequence worth knowing: saving a field rewrites its entities as the
 * characters they stand for. `&rsquo;` becomes ’ and `&middot;` becomes ·.
 * The rendered page is identical - the JSON is UTF-8 and so are the pages -
 * and the next person to open the field sees words instead of codes. Only
 * `&`, `<` and `>` are still escaped, because those three would otherwise
 * be read as markup.
 */

/* Only these three have to be escaped. Everything else - apostrophes,
 * dashes, middots, Chinese - is a character the file can hold directly. */
function richEscape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* What a box gives back. Anything not on the list contributes its text and
 * loses its tag, so unknown markup degrades to words rather than surviving
 * into the page. */
function richSerialize(node) {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) { out += richEscape(child.data); return; }
    if (child.nodeType !== Node.ELEMENT_NODE) return;

    const inner = richSerialize(child);
    switch (child.tagName) {
      case 'BR':
        out += '<br>';
        return;
      case 'B':
      case 'STRONG': {
        // class="key" is the accent colour in the hero's bio line, and the
        // only class the content uses
        if (child.getAttribute('class') === 'key') { out += `<b class="key">${inner}</b>`; return; }
        out += child.tagName === 'STRONG' ? `<strong>${inner}</strong>` : `<b>${inner}</b>`;
        return;
      }
      case 'I':
      case 'EM':
        out += `<em>${inner}</em>`;
        return;
      case 'U':
        out += `<u>${inner}</u>`;
        return;
      case 'SPAN': {
        const lang = child.getAttribute('lang');
        out += lang ? `<span lang="${richEscape(lang)}">${inner}</span>` : inner;
        return;
      }
      // These carry code rather than copy, so their text goes too. An
      // unknown *tag* is stripped and its words kept, which is right for a
      // font tag off a paste and wrong for a script.
      case 'SCRIPT':
      case 'STYLE':
      case 'TEMPLATE':
        return;
      default:
        // a div the browser made pressing Enter, a font tag from a paste
        out += inner;
    }
  });
  return out;
}

/* Wrap the selection in a tag the browser has no command for. */
function richWrap(box, tag, attrs) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!box.contains(range.commonAncestorContainer) || range.collapsed) return;

  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  node.appendChild(range.extractContents());
  range.insertNode(node);

  sel.removeAllRanges();
  const after = document.createRange();
  after.selectNodeContents(node);
  sel.addRange(after);
  box.dispatchEvent(new Event('input', { bubbles: true }));
}

/* The characters the copy actually uses that are awkward to type. */
const RICH_CHARS = ['·', '—', '–', '’', '“', '”', '…', '&'];

function richToolbar(box, lang) {
  const other = lang && (lang.code === 'en' ? 'zh' : 'en');

  /* document.execCommand is deprecated and has no replacement. Every browser
   * still implements bold and italic, and writing them by hand over Ranges
   * is a great deal of code to arrive in the same place, so this uses it
   * and normalises whatever it produces on the way out. */
  const cmd = (name) => (e) => {
    e.preventDefault();
    box.focus();
    document.execCommand('styleWithCSS', false, false);
    document.execCommand(name);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const btn = (label, title, onDown, cls) =>
    el('button', {
      className: 'rich__btn' + (cls ? ' ' + cls : ''), type: 'button',
      title: T(title), tabindex: '-1',
      onmousedown: onDown,
    }, label);

  const chars = el('div', { className: 'rich__chars' },
    ...RICH_CHARS.map((ch) => el('button', {
      className: 'rich__char', type: 'button', title: ch, tabindex: '-1',
      onmousedown: (e) => {
        e.preventDefault();
        box.focus();
        document.execCommand('insertText', false, ch);
        box.dispatchEvent(new Event('input', { bubbles: true }));
      },
    }, ch)));

  const more = el('span', { className: 'rich__more' },
    btn('…', 'Insert a character', (e) => {
      e.preventDefault();
      chars.classList.toggle('is-open');
    }),
    chars);

  return el('span', { className: 'rich' },
    btn('B', 'Bold', cmd('bold')),
    btn('I', 'Italic', cmd('italic')),
    btn('U', 'Underline', cmd('underline')),
    other
      ? btn(LANG[other].label, 'Mark the selection as the other language',
            (e) => { e.preventDefault(); richWrap(box, 'span', { lang: other }); },
            'rich__btn--wide')
      : null,
    btn('⦰', 'Remove formatting', (e) => {
      e.preventDefault();
      box.focus();
      document.execCommand('removeFormat');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }),
    more);
}

/* A box that shows the words and stores the markup. */
function richBox(obj, key, opts = {}) {
  const box = el('div', {
    className: 'rich__box' + (opts.multiline ? ' rich__box--tall' : ''),
    contenteditable: 'true',
    role: 'textbox',
    'aria-multiline': opts.multiline ? 'true' : 'false',
  });
  if (opts.lang) box.setAttribute('lang', opts.lang);
  if (opts.multiline) box.setAttribute('aria-multiline', 'true');
  box.innerHTML = obj[key] == null ? '' : String(obj[key]);

  box.addEventListener('input', () => {
    const html = richSerialize(box);
    if (!html && opts.dropWhenEmpty) delete obj[key];
    else obj[key] = html;
    if (opts.onChange) opts.onChange(html);
    markDirty();
    renderPreviewSoon();
  });

  // One line on the page means one line here
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !opts.multiline) e.preventDefault();
  });

  // A paste carries the formatting of wherever it came from. Take the words.
  box.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  return box;
}

/** A rich box with its toolbar, as one labelled field. */
function richField(label, obj, key, lang, opts = {}) {
  const box = richBox(obj, key, { ...opts, lang: lang && lang.attr });
  return el('label', { className: 'f f--rich', 'data-pv-target': opts.pv },
    el('span', {}, T(label),
      lang ? el('span', { className: `tag ${lang.cls}` }, lang.label) : null,
      richToolbar(box, lang)),
    box,
    opts.hint ? el('p', { className: 'hint', html: T(opts.hint) }) : null);
}

// ---------------------------------------------------------------- milestones

/* How many bullets a year shows before it stops. The timeline is the longest
 * thing in the admin - five years of entries in two languages is a couple of
 * hundred boxes - and scrolling past all of it to reach the press items was
 * the main reason the About tab felt endless. */
const MILESTONES_VISIBLE = 6;

/* Which years have been opened out. Kept here rather than on the year itself:
 * everything on that object is content and goes to GitHub on the next save,
 * and whether someone expanded a list is not something the site should carry
 * around. Keyed by year label so it survives a re-render. */
const msOpen = new Set();


/* Drag to reorder, with a line showing where it will land.
 *
 * The line is the whole point: without it you are dropping into a list and
 * hoping. Which half of the row the pointer is in decides whether the line
 * sits above or below it, so the answer is always the edge you can see.
 *
 * The arrows stay alongside. Dragging is not available to everyone, and a
 * list that can only be dragged is a list some people cannot sort.
 */
function dragReorder(node, index, list, onDrop) {
  const clear = () => node.classList.remove('is-drop-above', 'is-drop-below');

  node.draggable = true;
  node.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(index));
    e.dataTransfer.effectAllowed = 'move';
    node.classList.add('is-dragging');
  });
  node.addEventListener('dragend', () => {
    node.classList.remove('is-dragging');
    clear();
  });
  node.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const box = node.getBoundingClientRect();
    const above = (e.clientY - box.top) < box.height / 2;
    node.classList.toggle('is-drop-above', above);
    node.classList.toggle('is-drop-below', !above);
  });
  node.addEventListener('dragleave', clear);
  node.addEventListener('drop', (e) => {
    e.preventDefault();
    const above = node.classList.contains('is-drop-above');
    clear();

    const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (Number.isNaN(from)) return;

    // The line sits before this row or after it; taking the dragged row out
    // first shifts everything below it up by one, so a downward move lands
    // one short without this.
    let to = above ? index : index + 1;
    if (from < to) to -= 1;
    if (to === from || to < 0 || to > list.length - 1) return;

    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    onDrop();
  });
  return node;
}

function renderMilestones() {
  const shared = SHARED();
  const rerender = () => renderPanel();
  const out = [];

  shared.milestones.forEach((yearRow, yi) => {
    const enM = LOC('en').milestones;
    const zhM = LOC('zh').milestones;
    const box = { en: enM, zh: zhM };

    const bullet = (itemId, ii) => {
      const node = el('div', { className: 'ms' },
        el('span', { className: 'ms__grip', title: T('Drag to reorder') }, '⠿'),
        el('div', { className: 'ms__fields' },
          row(...langOrder().map((lang) =>
            richField('Entry', box[lang.code], itemId, lang, { multiline: true, rows: 2 }))),
          el('p', { className: 'hint' }, `id: ${itemId}`)),
        el('div', { className: 'ms__ctl' },
          el('button', { className: 'btn btn--small btn--ghost', type: 'button', title: T('Move up'),
                         onclick: () => {
                           if (ii === 0) return;
                           const [m] = yearRow.items.splice(ii, 1);
                           yearRow.items.splice(ii - 1, 0, m);
                           markDirty();
                           rerender();
                         } }, '↑'),
          el('button', { className: 'btn btn--small btn--ghost', type: 'button', title: T('Move down'),
                         onclick: () => {
                           if (ii >= yearRow.items.length - 1) return;
                           const [m] = yearRow.items.splice(ii, 1);
                           yearRow.items.splice(ii + 1, 0, m);
                           markDirty();
                           rerender();
                         } }, '↓'),
          el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                         onclick: () => {
                           if (!confirm(T('Remove this milestone from both languages?'))) return;
                           yearRow.items.splice(ii, 1);
                           delete enM[itemId];
                           delete zhM[itemId];
                           markDirty();
                           rerender();
                         } }, '×')));
      return dragReorder(node, ii, yearRow.items, () => { markDirty(); rerender(); });
    };

    // only the first few, unless this year has been opened out
    const many = yearRow.items.length > MILESTONES_VISIBLE;
    const showAll = msOpen.has(yearRow.year);
    const shown = many && !showAll ? yearRow.items.slice(0, MILESTONES_VISIBLE) : yearRow.items;

    const colour = el('input', { type: 'color', className: 'swatch' });
    colour.value = yearRow.color || '#05F93B';
    colour.addEventListener('change', () => {
      yearRow.color = colour.value;
      markDirty();
      rerender();
    });

    const body = el('div', {},
      row(
        field('Year label', input(yearRow, 'year')),
        el('div', { style: 'display:flex;align-items:flex-end' },
           check('Highlight as current year', yearRow, 'current', rerender)),
        field('Year colour', el('span', { className: 'swatchrow' },
          colour,
          yearRow.color
            ? el('button', { className: 'btn btn--small btn--ghost', type: 'button',
                             onclick: () => {
                               delete yearRow.color;
                               markDirty();
                               rerender();
                             } }, T('Default'))
            : el('span', { className: 'hint' }, T('Using the default'))),
          'Overrides the colour of the year. The default is the accent green on the current year.'),
      ),
      // Five years of entries, in two languages, is the longest thing in the
      // admin - about a hundred and sixty boxes on this tab alone. Each year
      // is shut until you open it, so the page is a list of years rather
      // than a wall, and the one being worked on is open to begin with.
      el('details', { className: 'msyear', open: (yearRow.current || msOpen.has(yearRow.year)) || null },
        el('summary', { className: 'hint' },
          T('{n} entries', { n: yearRow.items.length }),
          ' — ', T('open to edit')),
        ...shown.map((itemId, ii) => bullet(itemId, ii)),
        many
          ? el('button', { className: 'btn btn--small btn--ghost', type: 'button',
                           onclick: () => {
                             if (showAll) msOpen.delete(yearRow.year);
                             else msOpen.add(yearRow.year);
                             rerender();
                           } },
               showAll
                 ? T('Show fewer')
                 : T('Show all {n}', { n: yearRow.items.length }))
          : null,
        el('button', { className: 'btn btn--small', type: 'button', onclick: () => {
        const label = prompt(T('Short name for this milestone (used as its internal id):'), '');
        if (label === null) return;
        const id = newId(slug(label) || 'milestone', Object.keys(enM));
        yearRow.items.push(id);
        enM[id] = label || '';
        zhM[id] = '';
        msOpen.add(yearRow.year);
        markDirty();
        rerender();
      } }, T('+ milestone'))),
    );

    out.push(card(
      el('span', {}, yearRow.year,
         yearRow.color
           ? el('i', { className: 'dot', style: `background:${yearRow.color}` })
           : null,
         el('small', {}, T('{n} entries', { n: yearRow.items.length }))),
      listControls(shared.milestones, yi, rerender, {
        onDelete: (gone) => gone.items.forEach((id) => { delete enM[id]; delete zhM[id]; }),
      }),
      body,
      'milestones.year.' + yearRow.year,
    ));
  });

  out.push(addButton('+ Add a year', () => {
    shared.milestones.push({ year: String(new Date().getFullYear()), current: false, items: [] });
    markDirty();
    rerender();
  }));

  return out;
}

// ---------------------------------------------------------------- press

function renderPress() {
  const shared = SHARED();
  const rerender = () => renderPanel();
  const out = [];

  shared.press.forEach((item, i) => {
    const enP = LOC('en').press[item.id] || (LOC('en').press[item.id] = { src: '', title: '', gloss: '' });
    const zhP = LOC('zh').press[item.id] || (LOC('zh').press[item.id] = { src: '', title: '', gloss: '' });

    const body = el('div', {},
      field('Link', input(item, 'url', { mono: true })),
      bi('Source', 'src', (l) => (l === 'en' ? enP : zhP)),
      bi('Headline', 'title', (l) => (l === 'en' ? enP : zhP)),
      bi('Gloss / subtitle', 'gloss', (l) => (l === 'en' ? enP : zhP)),
    );

    out.push(card(el('span', {}, enP.title || T('(untitled)'), el('small', {}, item.id)),
                  listControls(shared.press, i, rerender, {
                    onDelete: (gone) => { delete LOC('en').press[gone.id]; delete LOC('zh').press[gone.id]; },
                  }), body, 'press.item.' + item.id));
  });

  out.push(addButton('+ Add a press item', () => {
    const id = newId('press', shared.press.map((p) => p.id));
    shared.press.push({ id, url: '' });
    LOC('en').press[id] = { src: 'Weibo', title: '', titleLang: 'zh', gloss: '' };
    LOC('zh').press[id] = { src: '微博', title: '', gloss: '' };
    markDirty();
    rerender();
  }));

  return out;
}

// ---------------------------------------------------------------- contact

function renderContact() {
  const shared = SHARED();
  const rerender = () => renderPanel();
  const out = [];

  out.push(card('Shared', null, el('div', {},
    row(
      field('Contact email', input(shared, 'contactEmail', { mono: true })),
      field('Copyright year', input(shared, 'copyrightYear')),
    ),
  ), 'contact.email'));

  out.push(card('Contact heading', null, el('div', {},
    bi('Who to contact', 'who', (l) => LOC(l).contact),
  ), 'contact.email'));

  if (LOC('en').contact.form && LOC('zh').contact.form) {
    const form = (l) => LOC(l).contact.form;
    out.push(card('Message window', null, el('div', {},
      // no vars passed, so T() leaves this one's {to} and {email} alone -
      // they are placeholders the site fills in, not ones this file fills in
      el('p', { className: 'hint', html:
        T('The window the "Message Tony" button opens. Sending is not connected online yet, so on the '
          + 'deployed site it shows the error line; the local preview accepts messages. '
          + '<code>{to}</code> and <code>{email}</code> are filled in for you — leave them in.') }),
      bi('Button', 'open', form),
      bi('Window title', 'title', form),
      bi('Introduction', 'intro', form, { multiline: true, rows: 2 }),
      bi('Message label', 'messageLabel', form),
      bi('Name label', 'nameLabel', form),
      bi('Name hint', 'nameHint', form),
      bi('Email/phone label', 'replyLabel', form),
      bi('Email/phone hint', 'replyHint', form, { multiline: true, rows: 2 }),
      bi('Send button', 'send', form),
      bi('Cancel button', 'cancel', form),
      bi('Close button (screen readers)', 'close', form),
      bi('While sending', 'sending', form),
      bi('After sending', 'sent', form, { multiline: true, rows: 2 }),
      bi('If it fails', 'error', form, { multiline: true, rows: 2 }),
      bi('No message written', 'needMessage', form),
      bi('No email or phone', 'needReply', form),
    )));
  }

  langOrder().forEach((lang) => {
    const contact = LOC(lang.code).contact;
    const cols = contact.columns;
    const body = el('div', {}, ...cols.map((col, ci) =>
      el('div', { style: 'margin-bottom:16px' },
        row(
          field('Column heading', input(col, 'heading', { lang: lang.attr })),
          el('div', { style: 'flex:0 0 auto;display:flex;align-items:flex-end' },
             el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                            onclick: () => { cols.splice(ci, 1); markDirty(); rerender(); } }, T('Remove column'))),
        ),
        ...col.items.map((item, ii) => row(
          field('Label', input(item, 'label', { lang: lang.attr })),
          field('URL', input(item, 'url', { mono: true, dropWhenEmpty: true }),
                'Empty = plain text, no link.'),
          field('Muted suffix', input(item, 'muted', { lang: lang.attr, dropWhenEmpty: true }),
                'e.g. <code>（海外）</code> or <code>— distribution</code>'),
          el('div', { style: 'flex:0 0 auto;display:flex;gap:6px;align-items:flex-end' },
             check('tight', item, 'mutedTight'),
             el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                            onclick: () => { col.items.splice(ii, 1); markDirty(); rerender(); } }, '×')),
        )),
        el('button', { className: 'btn btn--small', type: 'button',
                       onclick: () => { col.items.push({ label: '' }); markDirty(); rerender(); } }, T('+ item')),
      )),
      el('button', { className: 'btn btn--small', type: 'button',
                     onclick: () => { cols.push({ heading: '', items: [] }); markDirty(); rerender(); } },
         T('+ column')),
    );
    out.push(card(el('span', {}, T('Contact columns'), ' ', el('span', { className: `tag ${lang.cls}` }, lang.label)), null, body, 'contact.columns'));
  });

  out.push(card('Footer', null, el('div', {},
    bi('Copyright line', 'copyright', (l) => LOC(l).footer,
       { hint: 'Follows the © and the year. Inline HTML allowed.' }),
    bi('Back-to-top label', 'backToTop', (l) => LOC(l).footer),
  ), 'footer'));

  return out;
}

// ---------------------------------------------------------------- chrome

/* Pieces of the site that are not one section's own: the nav, and the two
 * boxes that exist on the Chinese page only. */

function navCard() {
  return card('Navigation', null, el('div', {},
    bi('Skip-to-content link', 'skip', (l) => LOC(l).nav),
    ...LOC('en').nav.links.map((_, i) => row(
      // the href is shared by both pages, so it is one field rather than a pair
      field('Link target', input(LOC('en').nav.links[i], 'href', { mono: true })),
      ...langOrder().map((lang) =>
        field('Label', input(LOC(lang.code).nav.links[i], 'label', { lang: lang.attr }), null, lang)),
    )),
    row(
      ...langOrder().map((lang) =>
        field('Contact button', input(LOC(lang.code).nav.cta, 'label', { lang: lang.attr }), null, lang)),
    ),
  ), 'nav');
}

/** The notice above the Chinese video grid, and the flags on tiles with no BV id. */
function bilibiliCards() {
  const rerender = () => renderPanel();
  const out = [];

  const notice = LOC('zh').notice;
  if (notice) {
    out.push(card(el('span', {}, T('Bilibili notice'), ' ', el('span', { className: 'tag tag--zh' }, T('中文 only'))), null,
      el('div', {},
        el('p', { className: 'hint' },
          T('The box above the video grid on the Chinese page. Delete it once every video has a BV id.')),
        field('Title', input(notice, 'title', { lang: 'zh-Hans' })),
        field('Body', input(notice, 'body', { multiline: true, rows: 4, lang: 'zh-Hans' }),
              'Inline links allowed.'),
        el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                       onclick: () => {
                         if (!confirm(T('Remove the Bilibili notice box from the Chinese page?'))) return;
                         delete LOC('zh').notice;
                         markDirty();
                         rerender();
                       } }, T('Remove the notice box')),
      )));
  }

  const flag = LOC('zh').videoFlag;
  if (flag) {
    out.push(card(el('span', {}, T('Pending-video flags'), ' ', el('span', { className: 'tag tag--zh' }, T('中文 only'))), null,
      el('div', {},
        el('p', { className: 'hint' }, T('Shown on tiles whose Bilibili BV id is still empty.')),
        field('Feature tile', input(flag, 'feature', { lang: 'zh-Hans' })),
        field('Grid tiles', input(flag, 'default', { lang: 'zh-Hans' })),
      )));
  }

  return out;
}

// ---------------------------------------------------------------- images

/* There was an Images tab once, then a grid of every image on a page. Both
 * meant the same picture could be set from two places - the grid and the
 * card it actually belongs to - which is how you end up with two upload
 * buttons and no way to tell what either one does. A picture is now edited
 * where it is used, and only there. */

const UPLOAD_NOTE =
  'Uploads commit to the draft branch straight away, so a new picture is on the preview URL immediately — ' +
  'but it will 404 in this admin until you publish, because this page loads previews from the live site.';

// ---------------------------------------------------------------- photos

/* The shapes build.py's PHOTO_SPANS knows, with the width:height each one is
 * cut to. An uploaded photo is given the nearest one automatically; the
 * picture is cropped to fill its slot, so a close match loses very little. */
const PHOTO_SHAPES = [
  ['square', 1, 'Square'], ['portrait', 4 / 5, 'Portrait (4:5)'], ['tall', 2 / 3, 'Tall (2:3)'],
  ['landscape', 3 / 2, 'Landscape (3:2)'], ['wide', 2, 'Wide (2:1)'], ['panorama', 3, 'Panorama (3:1)'],
];
const PHOTO_SIZES = [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']];

function choice(obj, key, options, onChange) {
  const node = el('select', {});
  options.forEach(([value, label]) => {
    // labels can be authored HTML ("Live &amp; behind the scenes"), so they go in as markup
    // a shape or size name is the admin's own word and translates; a photo
    // category is content, and T() hands anything it does not know straight back
    const opt = el('option', { value, html: T(label) });
    if (obj[key] === value) opt.selected = true;
    node.append(opt);
  });
  node.addEventListener('change', () => { obj[key] = node.value; markDirty(); if (onChange) onChange(); });
  return node;
}

/** The nearest shape to an image file's own proportions. */
function shapeOf(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const r = img.naturalWidth / img.naturalHeight;
      URL.revokeObjectURL(url);
      let best = PHOTO_SHAPES[0];
      for (const s of PHOTO_SHAPES) {
        if (Math.abs(Math.log(r / s[1])) < Math.abs(Math.log(r / best[1]))) best = s;
      }
      resolve(best[0]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve('square'); };
    img.src = url;
  });
}

/* Whether a picture opens into the larger view when it is clicked.
 *
 * It used to be decided by whether a description had been written, which
 * tied two unrelated things together. The checkbox writes the flag; until
 * someone touches it, the old rule still answers, so nothing changes on its
 * own. Clicking it is what makes the choice explicit. */
function opensInto(item, enC, zhC) {
  if ('opens' in item) return !!item.opens;
  return !!(enC.desc || zhC.desc);
}

function opensCheck(item, enC, zhC, rerender) {
  const boxEl = el('input', { type: 'checkbox' });
  boxEl.checked = opensInto(item, enC, zhC);
  boxEl.addEventListener('change', () => {
    item.opens = boxEl.checked;
    markDirty();
    rerender();
  });
  return el('label', { className: 'check' }, boxEl,
    el('span', {}, T('Opens into a larger view')));
}

const DESC_HINT =
  'Optional. Write something and the picture opens into a card with this text when it is clicked; ' +
  'leave it empty and it stays a still picture. A blank line starts a new paragraph.';

/* The Visuals grid's order: photos and videos in one list. build.py adds
 * anything missing from it at the end, so this shows the same fill-in -
 * what you see here is exactly what the page shows. */
function visualsOrderCard() {
  const shared = SHARED();
  const rerender = () => renderPanel();
  const photos = new Map((shared.photos || []).map((p) => [`photo:${p.id}`, p]));
  const videos = new Map(shared.videos.filter((v) => !v.feature).map((v) => [`video:${v.id}`, v]));
  const order = (shared.visualsOrder || []).filter((r, i, a) => (photos.has(r) || videos.has(r)) && a.indexOf(r) === i);
  for (const r of [...photos.keys(), ...videos.keys()]) if (!order.includes(r)) order.push(r);

  const move = (i, to) => {
    if (to < 0 || to >= order.length) return;
    const [r] = order.splice(i, 1);
    order.splice(to, 0, r);
    shared.visualsOrder = order;
    markDirty();
    rerender();
  };
  const rows = order.map((ref, i) => {
    const isPhoto = photos.has(ref);
    const item = isPhoto ? photos.get(ref) : videos.get(ref);
    const label = isPhoto
      ? (LOC('en').photos?.[item.id]?.caption || item.id)
      : (LOC('en').videos[item.id]?.title || item.id);
    const shape = isPhoto ? `${item.shape} · ${item.size}` : `video · ${item.size || 's'}`;
    return el('div', { style: 'display:flex;align-items:center;gap:10px;padding:5px 0;border-top:1px solid var(--line)' },
      el('span', { className: 'mono', style: 'width:2.2em;opacity:.6' }, String(i + 1)),
      el('img', { src: '/' + (isPhoto ? item.src : item.poster), alt: '', loading: 'lazy',
                  style: 'width:56px;height:36px;object-fit:cover;border-radius:4px' }),
      el('span', { style: 'flex:1;min-width:0' }, el('span', { html: label }), ' ',
         el('small', { className: 'hint' }, shape)),
      el('button', { className: 'btn btn--small btn--ghost', type: 'button', title: T('Earlier'), onclick: () => move(i, i - 1) }, '↑'),
      el('button', { className: 'btn btn--small btn--ghost', type: 'button', title: T('Later'), onclick: () => move(i, i + 1) }, '↓'));
  });
  return card('Grid order', null, el('details', {},
    el('summary', { className: 'hint' }, T('{n} pieces — open to reorder', { n: order.length })),
    el('p', { className: 'hint' },
      T('Top to bottom here is left-to-right, row by row on the page. The grid fills gaps with later, '
        + 'smaller pieces, so a big piece followed by several small ones packs best.')),
    ...rows));
}

function renderPhotos() {
  const shared = SHARED();
  const rerender = () => renderPanel();
  if (!shared.photos) shared.photos = [];
  for (const l of ['en', 'zh']) {
    if (!LOC(l).photos) LOC(l).photos = {};
    if (!LOC(l).photoTags) LOC(l).photoTags = {};
  }
  const tagKeys = Object.keys(LOC('en').photoTags);
  const out = [
    intro(
      'One grid under the title video holds the photos and the videos together. Its order is set in ' +
      '<b>Grid order</b> below; the grid packs the pieces, so mixing shapes and sizes is what makes it look ' +
      'designed. The gradient pictures are placeholders — use <b>Replace</b> as the real photos arrive.',
    ),
    visualsOrderCard(),
    card('Photo categories', null, el('div', {},
      ...tagKeys.map((k) => bi(T('Category: {key}', { key: k }), k, (l) => LOC(l).photoTags)),
      bi('"Open" label (screen readers)', 'open', (l) => LOC(l).lens),
      bi('"Close" label (screen readers)', 'close', (l) => LOC(l).lens),
    )),
  ];

  shared.photos.forEach((ph, i) => {
    const enP = LOC('en').photos[ph.id] || (LOC('en').photos[ph.id] = { caption: '' });
    const zhP = LOC('zh').photos[ph.id] || (LOC('zh').photos[ph.id] = { caption: '' });
    const opens = opensInto(ph, enP, zhP) ? el('span', { className: 'live' }, T('opens')) : null;
    const title = el('span', {}, enP.caption || T('(no caption)'), ' ', opens, el('small', {}, ph.id));

    const body = el('div', { className: 'vidrow' },
      el('div', {},
        el('img', { className: 'vidrow__thumb', src: '/' + ph.src, alt: '', loading: 'lazy',
                    style: 'aspect-ratio:auto;max-height:180px;object-fit:contain' }),
        el('div', { style: 'margin-top:8px' },
          uploadButton('img/photos', 'Replace', async (path, file) => {
            ph.src = path;
            ph.shape = await shapeOf(file);
            markDirty();
            rerender();
          }))),
      el('div', { className: 'vidrow__fields' },
        row(
          field('Shape', choice(ph, 'shape', PHOTO_SHAPES.map(([v, , label]) => [v, label])),
                'Set automatically when you upload.'),
          field('Size', choice(ph, 'size', PHOTO_SIZES)),
          field('Category', choice(ph, 'tag', tagKeys.map((k) => [k, LOC('en').photoTags[k]]))),
        ),
        bi('Caption', 'caption', (l) => (l === 'en' ? enP : zhP)),
        opensCheck(ph, enP, zhP, rerender),
        bi('Description', 'desc', (l) => (l === 'en' ? enP : zhP),
           { multiline: true, rows: 4, dropWhenEmpty: true,
             hint: opensInto(ph, enP, zhP)
               ? DESC_HINT
               : 'This picture does not open, so nothing here is shown. Tick the box above to '
                 + 'use it.' }),
      ));

    const remove = el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
      onclick: () => {
        if (!confirm(T('Remove this photo? It disappears from both languages.'))) return;
        shared.photos.splice(i, 1);
        delete LOC('en').photos[ph.id];
        delete LOC('zh').photos[ph.id];
        shared.visualsOrder = (shared.visualsOrder || []).filter((r) => r !== `photo:${ph.id}`);
        markDirty();
        rerender();
      } }, T('Remove'));
    out.push(card(title, remove, body));
  });

  out.push(el('div', { style: 'margin-bottom:24px' },
    uploadButton('img/photos', '+ Add a photo', async (path, file) => {
      const id = newId('photo', shared.photos.map((p) => p.id));
      shared.photos.push({ id, src: path, shape: await shapeOf(file), size: 'm', tag: tagKeys[0] || '' });
      (shared.visualsOrder || (shared.visualsOrder = [])).push(`photo:${id}`);
      LOC('en').photos[id] = { caption: '' };
      LOC('zh').photos[id] = { caption: '' };
      markDirty();
      rerender();
    })));
  return out;
}

// ---------------------------------------------------------------- recording

function renderRecording() {
  const shared = SHARED();
  const rec = shared.recording;
  if (!rec) return [];
  const rerender = () => renderPanel();
  for (const l of ['en', 'zh']) {
    if (!LOC(l).recording) LOC(l).recording = { title: '', photos: {} };
    if (!LOC(l).recording.photos) LOC(l).recording.photos = {};
  }

  const out = [
    card('Now Recording', null, el('div', {},
      el('p', { className: 'hint' },
        T('The block at the top of In the Making: a heading, a line of text, and a second ring that turns '
          + 'as the page scrolls. It sits above the original ring, which is edited further down.')),
      bi('Heading', 'title', (l) => LOC(l).recording),
      bi('Text', 'desc', (l) => LOC(l).recording, { multiline: true, rows: 2 }),
      el('div', { className: 'vidrow', style: 'margin-top:10px' },
        el('div', {},
          el('img', { className: 'vidrow__thumb', src: '/' + rec.centre, alt: '',
                      style: 'aspect-ratio:1' }),
          el('div', { style: 'margin-top:8px' },
            uploadButton('img/recording', 'Replace centre', (path) => {
              rec.centre = path; markDirty(); rerender();
            }))),
        el('div', { className: 'vidrow__fields' },
          el('p', { className: 'hint' }, T('The still picture in the middle of the ring, shown square.')),
          bi('Centre description (alt text)', 'centreAlt', (l) => LOC(l).recording))),
    ), 'making.recording'),
  ];

  rec.photos.forEach((ph, i) => {
    const enP = LOC('en').recording.photos[ph.id] || (LOC('en').recording.photos[ph.id] = { caption: '' });
    const zhP = LOC('zh').recording.photos[ph.id] || (LOC('zh').recording.photos[ph.id] = { caption: '' });
    const opens = opensInto(ph, enP, zhP) ? el('span', { className: 'live' }, T('opens')) : null;
    const title = el('span', {}, enP.caption || T('(no caption)'), ' ', opens, el('small', {}, `ring · ${ph.id}`));
    const body = el('div', { className: 'vidrow' },
      el('div', {},
        el('img', { className: 'vidrow__thumb', src: '/' + ph.src, alt: '', loading: 'lazy',
                    style: 'aspect-ratio:auto;max-height:160px;object-fit:contain' }),
        el('div', { style: 'margin-top:8px' },
          uploadButton('img/recording', 'Replace', (path) => { ph.src = path; markDirty(); rerender(); }))),
      el('div', { className: 'vidrow__fields' },
        el('p', { className: 'hint' },
          T('Any shape works: the ring keeps each picture’s own proportions.')),
        opensCheck(ph, enP, zhP, rerender),
        bi('Caption', 'caption', (l) => (l === 'en' ? enP : zhP),
           { hint: 'The heading of the card it opens into. Not shown on the ring itself.' }),
        bi('Description', 'desc', (l) => (l === 'en' ? enP : zhP),
           { multiline: true, rows: 3, dropWhenEmpty: true, hint: DESC_HINT }),
      ));
    out.push(card(title, listControls(rec.photos, i, rerender, {
      onDelete: (gone) => {
        delete LOC('en').recording.photos[gone.id];
        delete LOC('zh').recording.photos[gone.id];
      },
    }), body));
  });

  out.push(el('div', { style: 'margin-bottom:24px' },
    uploadButton('img/recording', '+ Add a ring photo', (path) => {
      const id = newId('ring', rec.photos.map((p) => p.id));
      rec.photos.push({ id, src: path });
      LOC('en').recording.photos[id] = { caption: '' };
      LOC('zh').recording.photos[id] = { caption: '' };
      markDirty();
      rerender();
    })));
  return out;
}

// ---------------------------------------------------------------- raw

function renderRaw() {
  const out = [intro(
    'Direct access to the three content files, for anything the forms above do not cover. ' +
    'Invalid JSON will refuse to save.',
  )];

  for (const path of Object.keys(state.files)) {
    const area = el('textarea', { className: 'mono', rows: 24 });
    area.value = JSON.stringify(state.files[path], null, 2);
    const status = el('p', { className: 'hint' }, T('Parsed OK'));

    area.addEventListener('input', () => {
      try {
        state.files[path] = JSON.parse(area.value);
        status.textContent = T('Parsed OK');
        status.style.color = '';
        markDirty();
      } catch (err) {
        status.textContent = T('Not valid JSON — {message}', { message: err.message });
        status.style.color = '#FF6B93';
      }
    });

    out.push(card(path, null, el('div', {}, area, status)));
  }
  return out;
}

// ---------------------------------------------------------------- pages

/* The seven tabs, each one a page of the site.
 *
 * These are compositions, not new editors: the section renderers above still
 * do the work, and a tab decides which of them belong to its page and in what
 * order. Adding a section to a page is a line here rather than a new form.
 */

// ---------------------------------------------------- hero loop and audio

/* How long each piece of handwriting holds before the next takes over. The
 * stylesheet used to carry this as a 12s keyframe cycle split between two
 * images; it is a number now, so the form can ask for it. */
const HERO_LOOP_SECONDS = 6;

function heroLoopSeconds(shared) {
  const loop = (shared.images || {}).inkLoop;
  const n = loop && Number(loop.seconds);
  return n > 0 ? n : HERO_LOOP_SECONDS;
}

/* Several files at once, from a drop or from the picker.
 *
 * Uploads go up one at a time rather than in parallel: each one is its own
 * commit to the draft branch, and firing five commits at the same head means
 * four of them lose the race. */
function dropZone(dir, accept, label, onEach) {
  const picker = el('input', { type: 'file', accept, multiple: true });
  picker.style.display = 'none';

  const zone = el('div', { className: 'drop', tabindex: '0', role: 'button' },
    el('span', { className: 'drop__label' }, T(label)),
    picker);

  const take = async (files) => {
    for (const file of [...files]) {
      await uploadInto(dir, file, (path) => onEach(path, file));
    }
    markDirty();
    renderPanel();
  };

  picker.addEventListener('change', () => {
    if (picker.files.length) take(picker.files);
    picker.value = '';
  });
  zone.addEventListener('click', (e) => { if (e.target !== picker) picker.click(); });
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); }
  });
  ['dragenter', 'dragover'].forEach((t) => zone.addEventListener(t, (e) => {
    e.preventDefault();
    zone.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach((t) => zone.addEventListener(t, () => zone.classList.remove('is-over')));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) take(e.dataTransfer.files);
  });
  return zone;
}

/** The handwriting in the hero, and how long each piece holds. */
function heroLoopCard() {
  const shared = SHARED();
  const images = shared.images;
  const rerender = () => renderPanel();
  const frames = heroLoopFrames(shared);

  /* Writing the list is also what migrates off the old ink/inkName pair. It
   * happens on the first edit rather than on render, so opening this tab and
   * changing nothing never marks the panel dirty. */
  const commit = (next, seconds) => {
    images.inkLoop = { seconds: seconds === undefined ? heroLoopSeconds(shared) : seconds, frames: next };
    delete images.ink;
    delete images.inkName;
    markDirty();
    rerender();
  };

  const move = (i, to) => {
    if (to < 0 || to >= frames.length) return;
    const next = frames.slice();
    const [f] = next.splice(i, 1);
    next.splice(to, 0, f);
    commit(next);
  };

  const secs = el('input', { type: 'number', min: '1', max: '30', step: '.5', className: 'num' });
  secs.value = heroLoopSeconds(shared);
  // `change`, not `input`: this re-renders, and doing that between the two
  // keystrokes of "12" would take the field away mid-number
  secs.addEventListener('change', () => {
    const v = parseFloat(secs.value);
    if (v > 0) commit(frames, v);
  });

  const items = frames.map((src, i) => el('div', { className: 'loopitem' },
    el('img', { className: 'loopitem__img', src: '/' + src, alt: '', loading: 'lazy' }),
    el('span', { className: 'imgcard__path' }, src),
    el('div', { className: 'listctl' },
      el('button', { className: 'btn btn--small btn--ghost', type: 'button', title: T('Move up'),
                     onclick: () => move(i, i - 1) }, '↑'),
      el('button', { className: 'btn btn--small btn--ghost', type: 'button', title: T('Move down'),
                     onclick: () => move(i, i + 1) }, '↓'),
      el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                     onclick: () => {
                       if (!confirm(T('Remove this picture from the loop?'))) return;
                       commit(frames.filter((_, j) => j !== i));
                     } }, T('Remove')))));

  return card('Handwriting loop', null, el('div', {},
    el('p', { className: 'hint' },
      T('The handwriting over the photograph. Each picture is drawn on, holds, then wipes off '
        + 'for the next one. With a single picture it simply stays put.')),
    field('Seconds each picture holds', secs),
    ...items,
    frames.length ? null : el('p', { className: 'hint' }, T('Nothing in the loop yet.')),
    dropZone('img', '.webp,.png,.jpg,.jpeg', 'Drop pictures here, or click to choose',
             (path) => { commit([...heroLoopFrames(SHARED()), path]); }),
  ), 'hero.loop');
}

/* The hero player.
 *
 * `tracks` is the library - every file on disk - and `playlists` picks which
 * of them each language queues, in order. They are separate so a file can
 * sit in the library unused instead of having to be deleted, and so the two
 * pages can lead with different songs the way they lead with different
 * streaming services. */
function renderHeroAudio() {
  const shared = SHARED();
  const rerender = () => renderPanel();
  const tracks = shared.tracks || (shared.tracks = []);
  const lists = shared.playlists || (shared.playlists = {});

  const titleOf = (id) => {
    const box = LOC(UI.lang).tracks;
    return (box && box[id] && box[id].title) || id;
  };

  const library = tracks.map((t, i) => el('div', { className: 'trackrow' },
    el('audio', { className: 'trackrow__play', src: '/' + t.file, controls: '', preload: 'none' }),
    el('div', { className: 'trackrow__fields' },
      bi('Track title', 'title', (l) => {
        const box = LOC(l).tracks || (LOC(l).tracks = {});
        return box[t.id] || (box[t.id] = { title: '' });
      }),
      el('div', { className: 'imgcard__path' }, t.file)),
    el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                   onclick: () => {
                     if (!confirm(T('Remove this track? It is taken out of both playlists too.'))) return;
                     tracks.splice(i, 1);
                     for (const l of ['en', 'zh']) {
                       if (LOC(l).tracks) delete LOC(l).tracks[t.id];
                       if (lists[l]) lists[l] = lists[l].filter((id) => id !== t.id);
                     }
                     markDirty();
                     rerender();
                   } }, T('Remove'))));

  const perLang = langOrder().map((lang) => {
    const chosen = lists[lang.code] || (lists[lang.code] = []);
    const move = (i, to) => {
      if (to < 0 || to >= chosen.length) return;
      const [id] = chosen.splice(i, 1);
      chosen.splice(to, 0, id);
      markDirty();
      rerender();
    };
    const spare = tracks.filter((t) => !chosen.includes(t.id));
    const add = el('select', {});
    add.append(el('option', { value: '' }, T('Add a track…')));
    spare.forEach((t) => add.append(el('option', { value: t.id }, titleOf(t.id))));
    add.addEventListener('change', () => {
      if (!add.value) return;
      chosen.push(add.value);
      markDirty();
      rerender();
    });

    return el('div', { className: 'playlist' },
      el('span', { className: 'hint' },
        T('Plays on the {lang} page', { lang: lang.label }), ' ',
        el('span', { className: 'tag ' + lang.cls }, lang.label)),
      ...chosen.map((id, i) => el('div', { className: 'playlist__row' },
        el('span', { className: 'mono playlist__n' }, String(i + 1)),
        el('span', { className: 'playlist__name' }, titleOf(id)),
        el('button', { className: 'btn btn--small btn--ghost', type: 'button', title: T('Move up'),
                       onclick: () => move(i, i - 1) }, '↑'),
        el('button', { className: 'btn btn--small btn--ghost', type: 'button', title: T('Move down'),
                       onclick: () => move(i, i + 1) }, '↓'),
        el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                       onclick: () => { chosen.splice(i, 1); markDirty(); rerender(); } }, '×'))),
      chosen.length
        ? null
        : el('p', { className: 'hint' },
             T('Nothing chosen — the player falls back to the synthesised pad.')),
      spare.length ? add : null);
  });

  return [card('Audio', null, el('div', {},
    el('p', { className: 'hint' },
      T('Music for the play button in the hero. Upload the files once, then choose what each '
        + 'language plays — the two are separate lists, so the Chinese page can lead with a '
        + 'different song. mp3, m4a or ogg, up to 8MB each.')),
    ...library,
    dropZone('audio', '.mp3,.m4a,.ogg', 'Drop tracks here, or click to choose', (path, file) => {
      const base = file.name.replace(/\.[^.]+$/, '');
      const id = newId(slug(base) || 'track', tracks.map((t) => t.id));
      tracks.push({ id, file: path });
      for (const l of ['en', 'zh']) {
        const box = LOC(l).tracks || (LOC(l).tracks = {});
        box[id] = { title: base };
      }
    }),
    el('div', { className: 'row' }, ...perLang),
  ), 'hero.audio')];
}


/* One picture, with its own Replace button. `imageCard` is for a set of
 * them; this is for the ones that are the whole point of their section. */
function singleImage(path, dir, onPick, { missingNote } = {}) {
  const rerender = () => renderPanel();
  return el('div', { className: 'onepic' },
    path
      ? el('img', { className: 'onepic__img', src: '/' + path, alt: '', loading: 'lazy' })
      : el('div', { className: 'onepic__img onepic__img--none' }, T(missingNote || 'Nothing uploaded yet')),
    el('div', { className: 'onepic__side' },
      path ? el('div', { className: 'imgcard__path' }, path) : null,
      uploadButton(dir, path ? 'Replace' : 'Upload', (p, f) => { onPick(p, f); markDirty(); rerender(); })),
  );
}

/* The Visuals block as the homepage shows it.
 *
 * The homepage carries a trimmed copy of Visuals: the heading, the title
 * video, and a link through to the rest. Those are the same fields the
 * Visuals tab edits - this is a second way in, on the tab for the page they
 * appear on, because "change the video on the homepage" should not mean
 * knowing that the video belongs to another page.
 */


/* ---- the homepage, and the pages it borrows from ----
 *
 * The Tony D tab is the homepage and nothing else. That matters because the
 * homepage does not show whole sections - it shows a trimmed copy of each
 * one, and every field it does not show belongs on that section's own tab.
 * Editing a record's track list here would be editing something you cannot
 * see, which is how this got confusing in the first place.
 *
 * So: the folds below carry exactly what the homepage renders. The Music,
 * Visuals and About tabs carry the full pages. Both write to the same JSON,
 * so a title changed in either place changes in both.
 */
const foldOpen = new Set();

function fold(title, section, count, ...children) {
  // `section` is documentation now: the whole homepage is drawn in the rail
  // at once, so opening a fold no longer has to point it anywhere.
  const open = foldOpen.has(title);
  const head = el('summary', { className: 'fold__head' },
    el('span', { className: 'fold__title' }, T(title)),
    count ? el('span', { className: 'fold__count' }, count) : null);

  const node = el('details', { className: 'fold', open: open || null }, head,
    el('div', { className: 'fold__body' }, ...children.flat().filter(Boolean)));

  node.addEventListener('toggle', () => {
    if (node.open) foldOpen.add(title);
    else foldOpen.delete(title);
  });
  return node;
}

/* A line pointing at where the rest of a section lives. */
function moreOn(tabId, text) {
  return el('p', { className: 'intro' },
    T(text), ' ',
    el('button', {
      className: 'btn btn--small', type: 'button',
      onclick: () => { selectTab(tabId); window.scrollTo(0, 0); },
    }, T('Open the {tab} tab', { tab: tabLabel(tabId) })));
}

/* ---- what the homepage shows of Releases ----
 * The cover, its labels, the name, the one-line meta and the links. The
 * description paragraph, the track list and the singles-by-year list are
 * only rendered on the Music page, so they are only edited there. */
function homeReleaseCards() {
  const shared = SHARED();
  const rerender = () => renderPanel();
  const out = [];

  shared.releases.forEach((r, i) => {
    const enR = LOC('en').releases[r.id];
    const zhR = LOC('zh').releases[r.id];
    const pick = (l) => (l === 'en' ? enR : zhR);

    const body = el('div', {},
      row(
        el('div', {},
          el('img', { src: '/' + r.art, alt: '', loading: 'lazy',
                      style: 'width:120px;border-radius:5px;display:block;margin-bottom:8px' }),
          uploadButton('img', 'Replace cover', (path) => { r.art = path; markDirty(); rerender(); })),
        el('div', {},
          field('Cover path', input(r, 'art', { mono: true })),
          bi('Cover description', 'alt', pick,
             { hint: 'Describes the cover for screen readers.' })),
      ),
      bi('Name', 'title', pick,
         { hint: 'Inline HTML is allowed, e.g. <code>&lt;span lang="zh"&gt;想太多&lt;/span&gt;</code>.' }),
      bi('Kind and date', 'meta', pick,
         { hint: 'The line under the name — <b>Album · 2025</b>, or a range for the singles.' }),
      el('p', { className: 'hint' },
        T('Labels shown over the top-left corner of the cover. Add as many as the record needs.')),
      tagsEditor(r),
      row(...langOrder().map((lang) => linksEditor(lang.code, pick(lang.code)))),
    );

    out.push(card(
      el('span', {}, enR.title.replace(/<[^>]+>/g, ''), el('small', {}, r.id)),
      listControls(shared.releases, i, rerender, {
        onDelete: (gone) => { delete LOC('en').releases[gone.id]; delete LOC('zh').releases[gone.id]; },
      }),
      body,
      'music.release.' + r.id,
    ));
  });

  out.push(addButton('+ Add a release', () => {
    const id = newId('release', shared.releases.map((r) => r.id));
    shared.releases.push({ id, art: 'img/album-overthinking.webp' });
    for (const l of ['en', 'zh']) {
      LOC(l).releases[id] = { alt: '', title: '', meta: '', copy: '', tags: [], links: [] };
    }
    markDirty();
    rerender();
  }));

  return out;
}

/* ---- what the homepage shows of About ----
 * A photograph, the line he leads with, and the profile table. The bio
 * paragraphs are on the About page only. Note the picture is `aboutBottom`:
 * the homepage and the About page deliberately use different photographs. */
function homeAboutCards() {
  const shared = SHARED();
  const images = shared.images;
  const about = { en: LOC('en').about, zh: LOC('zh').about };
  const rerender = () => renderPanel();

  const facts = el('div', { className: 'row' }, ...langOrder().map((lang) => {
    const list = about[lang.code].facts;
    return el('div', { style: 'flex:1' },
      el('span', { className: 'hint' }, T('Profile rows ({lang})', { lang: lang.label })),
      ...list.map((item, i) => row(
        field('Term', input(item, 'term', { lang: lang.attr })),
        field('Value', input(item, 'value', { lang: lang.attr })),
        el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                       onclick: () => { list.splice(i, 1); markDirty(); rerender(); } }, '×'),
      )),
      el('button', { className: 'btn btn--small', type: 'button',
                     onclick: () => { list.push({ term: '', value: '' }); markDirty(); rerender(); } },
         T('+ row')));
  }));

  return [
    card('Photograph', null, el('div', {},
      el('p', { className: 'hint' },
        T('The portrait beside the profile. The About page uses a different one of its own.')),
      singleImage(images.aboutBottom, 'img', (p) => { images.aboutBottom = p; }),
      bi('Image description', 'altBottom', (l) => about[l],
         { hint: 'Describes the photograph for screen readers.' }),
    ), 'about.image'),

    card('Blurb', null, el('div', {},
      el('p', { className: 'hint' }, T('The line set in large italics beside the photograph.')),
      bi('Blurb', 'quote', (l) => about[l]),
    ), 'about.quote'),

    card('Profile', null, el('div', {},
      el('p', { className: 'hint' },
        T('The table beside the bio. Each row is a label and a value; add and remove as many '
          + 'as you like, and each language keeps its own rows.')),
      bi('Table heading', 'profileHeading', (l) => about[l]),
      facts,
    ), 'about.stats'),
  ];
}

function renderHome() {
  const shared = SHARED();
  const images = shared.images;

  return [
    intro(
      'The homepage, top to bottom. Each section under the hero is a trimmed copy of another '
      + 'page — what the homepage shows of it is edited here, and the rest on that page’s '
      + 'own tab.',
    ),

    card('Browser tab', null, el('div', {},
      bi('Page title', 'title', (l) => LOC(l).pages.home,
         { hint: 'Shown on the browser tab and as the headline in search results.' }),
      bi('Search description', 'description', (l) => LOC(l).pages.home, { multiline: true, rows: 2 }),
      field('Tab icon', singleImage(images.favicon, 'img', (p) => { images.favicon = p; }),
            'The little picture on the browser tab. A square image works best — it is shown '
            + 'at about 16 pixels, so a crop of the logo reads better than the whole thing.'),
    ), 'tab'),

    card('Header description', null, el('div', {},
      bi('Header description', 'eyebrow', (l) => LOC(l).hero,
         { hint: 'The line above the handwriting, with a dot before it.' }),
    ), 'hero.eyebrow'),

    card('Background image', null, el('div', {},
      el('p', { className: 'hint' }, T('The photograph behind the whole top of the page.')),
      singleImage(images.hero, 'img', (p) => { images.hero = p; }),
      bi('Image description', 'imageAlt', (l) => LOC(l).hero,
         { hint: 'Describes the photograph for screen readers and for search engines.' }),
    ), 'hero.image'),

    heroLoopCard(),

    card('Bio', null, el('div', {},
      bi('Bio', 'count', (l) => LOC(l).hero,
         { hint: 'The line under the handwriting. <code>&lt;b&gt;…&lt;/b&gt;</code> makes a '
                 + 'part of it bold, and <code>&lt;b class="key"&gt;…&lt;/b&gt;</code> makes it '
                 + 'the accent colour.' }),
    ), 'hero.count'),

    card('Latest', null, el('div', {},
      bi('Latest', 'outNow', (l) => LOC(l).hero,
         { hint: 'The release line at the foot of the hero.' }),
    ), 'hero.outNow'),

    ...renderHeroAudio(),

    card('Hidden heading', null, el('div', {},
      bi('Hidden heading (screen readers)', 'srTitle', (l) => LOC(l).hero,
         { hint: 'The handwriting is an image, so this is the real <code>h1</code> text. It is '
                 + 'not shown on the page — it is what a screen reader announces.' }),
      bi('Subheading', 'sub', (l) => LOC(l).hero,
         { multiline: true, rows: 2,
           hint: 'Optional, and currently empty: a line between the handwriting and the bio.' }),
    )),

    navCard(),

    fold('01  Releases', 'music', SHARED().releases.length, [
      sectionHeading('music', 'music.heading'),
      ...homeReleaseCards(),
      moreOn('music', 'Track lists, the singles by year and each record’s description are on the '
                      + 'Music page, not the homepage.'),
    ]),

    fold('02  Visuals', 'visuals', null, [
      sectionHeading('videos', 'visuals.heading'),
      homeVisualCard(),
      moreOn('visuals', 'The photo grid and the rest of the videos are on the Visuals page.'),
    ]),

    fold('03  About', 'about', null, [
      sectionHeading('about', 'about.heading'),
      ...homeAboutCards(),
      moreOn('about', 'The bio paragraphs, the full timeline and the press items are on the '
                      + 'About page.'),
    ]),

    fold('04  Timeline', 'milestones', 6, [
      el('p', { className: 'intro' },
        T('The homepage shows the six most recent entries, newest first. There is nothing to '
          + 'set here — it follows the timeline on the About page, so adding an entry there '
          + 'pushes the oldest one off the homepage by itself.')),
      moreOn('about', 'The timeline itself is on the About page.'),
    ]),
  ];
}


function homeVisualCard() {
  const shared = SHARED();
  const images = shared.images;
  const rerender = () => renderPanel();
  const feature = (shared.videos || []).find((v) => v.feature);
  const usingPicture = !!images.homeVisual;

  const choose = (picture) => {
    if (picture === usingPicture) return;
    if (!picture) delete images.homeVisual;
    markDirty();
    rerender();
  };

  const pick = el('div', { className: 'pickrow' },
    el('button', {
      className: 'btn btn--small' + (usingPicture ? ' btn--ghost' : ''),
      type: 'button', onclick: () => choose(false),
    }, T('The title video')),
    el('button', {
      className: 'btn btn--small' + (usingPicture ? '' : ' btn--ghost'),
      type: 'button',
      onclick: () => {
        if (usingPicture) return;
        // nothing to switch to until a picture is uploaded, so say so
        toast(T('Upload a picture below and it takes over from the video.'));
      },
    }, T('A picture')));

  const body = el('div', {},
    el('p', { className: 'hint' },
      T('What the homepage shows under the Visuals heading. Whichever you choose is shown at '
        + 'the same width and the same 16:9 shape.')),
    pick,
  );

  if (!usingPicture && feature) {
    const fv = (LOC(UI.lang).videos || {})[feature.id] || {};
    body.append(
      row(
        el('div', {},
          el('img', { src: '/' + feature.poster, alt: '', loading: 'lazy',
                      style: 'width:180px;border-radius:6px;display:block;margin-bottom:8px' }),
          uploadButton('img/video', 'Replace poster', (path) => {
            feature.poster = path;
            markDirty();
            rerender();
          })),
        el('div', {},
          field('YouTube ID', input(feature, 'yt', { mono: true }),
                'The part after <code>youtu.be/</code>.'),
          field('Bilibili BV ID', input(feature, 'bv', { mono: true, placeholder: 'BV1xx411c7mD' }),
                'Leave empty until the video is on B站.')),
      ),
      bi('Video title', 'title', (l) => {
        const box = LOC(l).videos || (LOC(l).videos = {});
        return box[feature.id] || (box[feature.id] = { title: '', sub: '' });
      }),
      bi('Small label above the title', 'kicker', (l) => LOC(l).videos[feature.id],
         { dropWhenEmpty: true, hint: 'Leave empty for no label.' }),
      bi('Line under the title', 'sub', (l) => LOC(l).videos[feature.id],
         { dropWhenEmpty: true, hint: 'Leave empty for no line.' }),
    );
  }

  body.append(
    el('p', { className: 'hint' },
      usingPicture
        ? T('This picture is shown instead of the video.')
        : T('Upload a picture here to show it instead of the video.')),
    singleImage(images.homeVisual, 'img', (p) => { images.homeVisual = p; },
                { missingNote: 'No picture — the video is shown' }),
    usingPicture
      ? el('div', {},
          bi('Image description', 'homeVisualAlt', (l) => LOC(l),
             { hint: 'Describes the picture for screen readers.' }),
          el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                         onclick: () => {
                           if (!confirm(T('Go back to showing the video?'))) return;
                           delete images.homeVisual;
                           markDirty();
                           rerender();
                         } }, T('Use the video instead')))
      : null,
    bi('Link to the rest', 'more', (l) => LOC(l).sections.videos,
       { hint: 'The way through to the Visuals page from the homepage.' }),
  );

  return card('What the homepage shows', null, body, 'home.visuals');
}

function renderMusic() {
  return [
    intro(
      'The Music page — the full catalogue. What the homepage shows of it (the covers, the '
      + 'names and the links) is edited on the Tony D tab; everything below is this page only.',
    ),
    pageMeta('music'),
    sectionHeading('music', 'music.heading'),
    ...renderReleases(),
  ];
}

/* The optional picture under the title video. It is rendered at the same
 * width as the video, so nothing here asks for a size - whatever is
 * uploaded is shown full width and the page keeps its own margins. */
/* The All / Photos / Videos switch beside the Visuals heading. The labels
 * are content - they are the only words on that page that were not
 * reachable from here, because the switch was added after this tab was
 * built. `label` is not printed: it names the group for a screen reader. */
function visualsFilterCard() {
  if (!LOC('en').visualsFilter) return null;
  const both = (SHARED().photos || []).length && (SHARED().videos || []).length;
  return card('Filter buttons', null, el('div', {},
    el('p', { className: 'hint' },
      T('The three buttons beside the heading. They only appear when the grid holds both '
        + 'photos and videos - with only one kind, all three would show the same grid.')),
    both ? null : el('p', { className: 'hint' },
      T('Not showing on the page at the moment: the grid holds only one kind.')),
    bi('All', 'all', (l) => LOC(l).visualsFilter),
    bi('Photos', 'photos', (l) => LOC(l).visualsFilter),
    bi('Videos', 'videos', (l) => LOC(l).visualsFilter),
    bi('Group name (screen readers)', 'label', (l) => LOC(l).visualsFilter,
       { hint: 'Not shown on the page. Announced when a screen reader reaches the buttons.' }),
  ), 'visuals.filter');
}

function visualsBannerCard() {
  const shared = SHARED();
  const images = shared.images;
  const rerender = () => renderPanel();

  return card('Picture under the video', null, el('div', {},
    el('p', { className: 'hint' },
      T('Sits between the title video and the grid, the same width as the video. '
        + 'A wide picture works best. Leave it empty and nothing is shown.')),
    singleImage(images.visualsBanner, 'img', (p) => { images.visualsBanner = p; },
                { missingNote: 'No picture here yet' }),
    images.visualsBanner
      ? el('div', {},
          bi('Image description', 'visualsBannerAlt', (l) => LOC(l),
             { hint: 'Describes the picture for screen readers. Leave empty if it is decoration.' }),
          el('button', { className: 'btn btn--small btn--ghost btn--danger', type: 'button',
                         onclick: () => {
                           if (!confirm(T('Remove the picture under the video?'))) return;
                           delete images.visualsBanner;
                           markDirty();
                           rerender();
                         } }, T('Remove the picture')))
      : null,
  ), 'visuals.banner');
}

function renderVisuals() {
  return [
    intro(
      'The Visuals page. Each tile is a link with a poster until someone clicks it — nothing '
      + 'loads from YouTube or Bilibili on page load. The <b>Bilibili BV id</b> is the one to '
      + 'fill in when a video goes up on B站: a tile with an empty BV id stays an ordinary '
      + 'outbound link on the Chinese page instead of becoming a player that cannot load in China.',
    ),
    pageMeta('visuals'),
    sectionHeading('videos', 'visuals.heading'),
    visualsFilterCard(),
    visualsBannerCard(),
    ...renderPhotos(),
    intro('The videos: the title video at the top of the page, and the grid under the heading.'),
    ...renderVideos(),
    ...bilibiliCards(),
  ];
}

function renderAboutPage() {
  return [
    intro(
      'The About page. The bio is the part of the site most likely to be read by a label or a '
      + 'journalist — every claim here should be something the resume PDF actually supports.',
    ),
    pageMeta('about'),
    sectionHeading('about', 'about.heading'),
    ...renderAbout(),
    // Only the one this page renders. The other portrait is the homepage's
    // and is edited there; `aboutWide` is not rendered anywhere at all.
    card('Photograph', null, el('div', {},
      el('p', { className: 'hint' },
        T('The portrait beside the bio on this page. The homepage uses a different one, '
          + 'edited on its own tab.')),
      singleImage(SHARED().images.aboutTop, 'img', (v) => { SHARED().images.aboutTop = v; }),
      bi('Image description', 'altTop', (l) => LOC(l).about,
         { hint: 'Describes the photograph for screen readers.' }),
    ), 'about.image'),
    intro(
      'The timeline, at the foot of the same page. Each entry exists once and carries an English '
      + 'and a Chinese wording. The homepage shows the six most recent of these automatically.',
    ),
    sectionHeading('milestones', 'milestones.heading'),
    ...renderMilestones(),
    intro(
      'Press &amp; Mentions, which closes the About page. The English page shows an English '
      + 'title with a gloss underneath; those are descriptions for readers, not official '
      + 'headlines, so keep them descriptive rather than authoritative.',
    ),
    sectionHeading('coverage', 'press.heading'),
    ...renderPress(),
  ];
}

function renderMaking() {
  const shared = SHARED();
  const rerender = () => renderPanel();
  const out = [
    intro(
      'The In the Making page. It carries its heading and the scroll orbit; the notes that belong ' +
      'underneath have not been written yet. Press coverage moved to the foot of the About page.',
    ),
    pageMeta('making'),
    sectionHeading('press', 'making.heading'),
    ...renderRecording(),
  ];

  const orbit = shared.orbit;
  if (orbit) {
    const centre = el('select', {});
    shared.releases.forEach((r) => {
      const opt = el('option', { value: r.id }, LOC('en').releases[r.id]?.title || r.id);
      if (r.id === orbit.centre) opt.selected = true;
      centre.append(opt);
    });
    centre.addEventListener('change', () => { orbit.centre = centre.value; markDirty(); rerender(); });

    out.push(card('Scroll orbit', null, el('div', {},
      field('Centre', centre,
            'The still cover in the middle of the ring. Its artwork and alt text come from that release, ' +
            'so the ring circles something the rest of the site already shows.'),
      el('p', { className: 'hint' },
        T('The ring, in the order it goes round. These are decorative and carry no alt text.') + ' ' + T(UPLOAD_NOTE)),
      el('div', { className: 'imggrid' }, ...orbit.photos.map((path, i) =>
        el('div', { className: 'imgcard' },
          el('img', { src: '/' + path, alt: '', loading: 'lazy' }),
          el('div', { className: 'imgcard__body' },
            el('div', { className: 'imgcard__path' }, path),
            listControls(orbit.photos, i, rerender))))),
      uploadButton('img/orbit', '+ Add a photo',
                   (path) => { orbit.photos.push(path); markDirty(); rerender(); }),
    ), 'making.orbit'));
  }

  return out;
}

function renderContactPage() {
  return [
    intro(
      'The contact block and the footer, which finish every page. The email here is the public-facing ' +
      'management address — it appears in both languages and in the mailto link.',
    ),
    sectionHeading('contact', 'contact.heading'),
    ...renderContact(),
  ];
}

// ---------------------------------------------------------------- shell

function renderTabs() {
  const nav = document.getElementById('tabs');
  nav.replaceChildren(...TABS.map((tab) => {
    const btn = el('button', {
      type: 'button',
      role: 'tab',
      'data-tab': tab.id,
      title: T('Double-click to rename'),
      'aria-selected': String(tab.id === state.tab),
      onclick: () => selectTab(tab.id),
      ondblclick: () => renameTab(btn, tab.id),
    }, tabLabel(tab.id));
    return btn;
  }));
}

/* Selecting a tab moves the underline in place rather than rebuilding the bar.
 * A rebuild would replace the button between the two halves of a double-click,
 * leaving the rename to happen on a node no longer in the document. */
function selectTab(id) {
  if (state.tab === id) return;
  state.tab = id;
  // the folds belong to the tab being left; their preview goes with them
  state.section = null;
  foldOpen.clear();
  for (const btn of document.getElementById('tabs').children) {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === state.tab));
  }
  renderPanel();
  window.scrollTo(0, 0);
}

/** Edit a tab's name in place. Enter or clicking away keeps it, Escape does not. */
function renameTab(btn, id) {
  if (btn.isContentEditable) return;
  const before = tabLabel(id);

  // plaintext-only keeps pasted markup out; not every browser has it yet.
  btn.contentEditable = 'plaintext-only';
  if (btn.contentEditable !== 'plaintext-only') btn.contentEditable = 'true';
  btn.classList.add('is-editing');
  btn.focus();

  const range = document.createRange();
  range.selectNodeContents(btn);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    btn.removeEventListener('keydown', onKey);
    btn.removeEventListener('blur', onBlur);
    btn.contentEditable = 'false';
    btn.classList.remove('is-editing');
    window.getSelection().removeAllRanges();

    const next = btn.textContent.replace(/\s+/g, ' ').trim();
    if (keep && next && next !== before) {
      setTabLabel(id, next);
      markDirty();
    }
    // Whether kept, cancelled or left empty, the button shows what is stored.
    btn.textContent = tabLabel(id);
  };

  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  const onBlur = () => finish(true);

  btn.addEventListener('keydown', onKey);
  btn.addEventListener('blur', onBlur);
}

function renderPanel() {
  renderPreview();
  const panel = document.getElementById('panel');
  const tab = TABS.find((t) => t.id === state.tab);
  try {
    panel.replaceChildren(...[tab.render()].flat().filter(Boolean));
  } catch (err) {
    panel.replaceChildren(el('p', { className: 'intro' },
      T('Could not render this tab: {message}. The Raw JSON tab still works.', { message: err.message })));
  }
}

/* Everything in index.html that is not built by JS. It is written from here
 * rather than sitting in the markup so that one function repaints the whole
 * shell when the language changes. */
function renderChrome() {
  const set = (id, text) => { document.getElementById(id).textContent = text; };
  set('barSub', T('site admin'));
  set('reloadBtn', T('Reload'));
  set('saveBtn', T('Save draft'));
  set('publishBtn', T('Publish'));
  set('logoutBtn', T('Sign out'));

  const msg = document.getElementById('msg');
  msg.placeholder = T('What changed?');
  msg.setAttribute('aria-label', T('Change note'));

  const loading = document.getElementById('loading');
  if (loading) loading.textContent = T('Loading content…');
  // before the first /status comes back there is nothing to report but this
  if (!state.status) document.getElementById('status').textContent = T('Loading…');

  document.getElementById('tabs').setAttribute('aria-label', T('Sections'));
  document.getElementById('uiLang').setAttribute('aria-label', T('Interface language'));
  for (const btn of document.getElementById('uiLang').children) {
    btn.setAttribute('aria-pressed', String(btn.dataset.uiLang === UI.lang));
  }
  document.documentElement.lang = UI.lang === 'zh' ? 'zh-Hans' : 'en';
}

/* Switching language re-renders rather than reloading: unsaved edits live in
 * state.files, and a reload would throw them away to change a label. */
function setUiLang(lang) {
  if (lang === UI.lang) return;
  UI.lang = lang;
  saveUiLang(lang);
  renderChrome();
  if (state.files) {
    renderTabs();
    renderPanel();
  } else if (document.querySelector('.login')) {
    // Before signing in there is no content to re-render, but there is a
    // form - and it was being left in the language it was built in, so the
    // toolbar went Chinese over an English sign-in box.
    showLogin(loginMessage);
  }
  renderStatus();
}

document.getElementById('uiLang').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-ui-lang]');
  if (btn) setUiLang(btn.dataset.uiLang);
});

function renderStatus() {
  const node = document.getElementById('status');
  const s = state.status;
  const bits = [];

  if (state.dirty) bits.push(`<span class="warn">${T('unsaved changes')}</span>`);
  if (s) {
    bits.push(T('signed in'));
    if (s.ahead > 0) {
      bits.push(T(s.ahead === 1 ? '{n} change waiting to publish' : '{n} changes waiting to publish',
                  { n: `<b>${s.ahead}</b>` }));
    } else if (!state.dirty) bits.push(T('live site is up to date'));
    if (!s.canPublish) bits.push(T('edit &amp; preview only'));
  }
  node.innerHTML = bits.join(' &middot; ');

  document.getElementById('publishBtn').disabled =
    !s || !s.canPublish || s.ahead === 0 || state.dirty;
}

async function refreshStatus() {
  try {
    state.status = await api('/status');
  } catch (err) {
    state.status = null;
    toast(err.message, 'bad', err.detail);
  }
  renderStatus();
}

async function load() {
  const data = await api('/content');
  state.headSha = data.headSha;
  state.files = data.files;
  state.dirty = false;
  document.getElementById('saveBtn').disabled = true;
  renderTabs();
  renderPanel();
  await refreshStatus();
}

async function save() {
  const btn = document.getElementById('saveBtn');
  const msgInput = document.getElementById('msg');
  btn.disabled = true;
  try {
    const message = msgInput.value.trim() || 'Update content';
    const res = await api('/content', {
      method: 'PUT',
      body: JSON.stringify({ files: state.files, headSha: state.headSha, message }),
    });
    state.headSha = res.commit;
    state.dirty = false;
    msgInput.value = '';
    toast(T('Saved to the draft branch'), 'good',
          state.status && !state.status.canPublish
            ? T('The site owner can publish it to the live site.')
            : T('Press Publish to put it live.'));
    await refreshStatus();
  } catch (err) {
    btn.disabled = false;
    toast(err.message, 'bad',
          err.status === 401
            ? T('Your changes are still on this page. Open the admin in a new tab, sign in, then come back and press Save draft again.')
            : err.detail);
  }
}

async function publish() {
  if (!confirm(T('Publish all saved changes to the live site?'))) return;
  const btn = document.getElementById('publishBtn');
  btn.disabled = true;
  try {
    await api('/publish', { method: 'POST' });
    toast(T('Published'), 'good', T('Cloudflare is rebuilding — the live site updates in a minute or two.'));
    await refreshStatus();
  } catch (err) {
    toast(err.message, 'bad', err.detail);
    await refreshStatus();
  }
}

window.addEventListener('beforeunload', (e) => {
  if (!state.dirty) return;
  e.preventDefault();
  e.returnValue = '';
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    if (state.dirty) save();
  }
});

document.getElementById('saveBtn').addEventListener('click', save);
document.getElementById('publishBtn').addEventListener('click', publish);
document.getElementById('reloadBtn').addEventListener('click', async () => {
  if (state.dirty && !confirm(T('Reload and discard your unsaved changes?'))) return;
  await load();
  toast(T('Reloaded from the draft branch'));
});

// ---------------------------------------------------------------- sign in

/* What the form is currently saying, so it can be rebuilt in the other
 * language. Ours are passed as English source strings and translated here;
 * anything from the server falls through T() unchanged. */
let loginMessage = '';

function showLogin(message) {
  loginMessage = message || '';
  const password = el('input', { type: 'password', autocomplete: 'current-password', required: true });
  const error = el('p', { className: 'hint login__error' }, loginMessage ? T(loginMessage) : '');
  const submit = el('button', { className: 'btn btn--go', type: 'submit' }, T('Sign in'));

  const form = el('form', { className: 'card login' },
    el('div', { className: 'card__head' }, el('span', { className: 'card__title' }, T('Sign in'))),
    el('div', { className: 'card__body' },
      field('Password', password),
      error,
      submit,
    ),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    error.textContent = '';
    try {
      await api('/login', {
        method: 'POST',
        body: JSON.stringify({ password: password.value }),
      });
      await start();
    } catch (err) {
      error.textContent = err.message;
      submit.disabled = false;
      password.select();
    }
  });

  document.getElementById('tabs').replaceChildren();
  document.getElementById('panel').replaceChildren(form);
  document.getElementById('status').textContent = T('Not signed in');
  document.getElementById('saveBtn').disabled = true;
  document.getElementById('publishBtn').disabled = true;
  document.getElementById('logoutBtn').hidden = true;
  password.focus();
}

async function start() {
  renderChrome();
  wirePreviewHover();
  wirePreviewEditing();
  try {
    await load();
    document.getElementById('logoutBtn').hidden = false;
  } catch (err) {
    if (err.status === 401) return showLogin(err.detail);
    document.getElementById('panel').replaceChildren(
      el('p', { className: 'intro' },
        T('Could not load content: {message}', { message: err.message })
          + (err.detail ? ' — ' + err.detail : '')),
    );
    document.getElementById('status').textContent = T('Not connected');
  }
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (state.dirty && !confirm(T('Sign out and discard your unsaved changes?'))) return;
  try { await api('/logout', { method: 'POST' }); } catch { /* signed out either way */ }
  state.dirty = false;
  state.status = null;
  showLogin('Signed out.');
});

start();

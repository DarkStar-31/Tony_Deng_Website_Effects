/* The little page in the top-left corner.
 *
 * It is a map, not a screenshot. The real pages are rendered by build.py, in
 * Python, at deploy time — there is no way to run that in here, and an
 * <iframe> of the built page would show the last thing that was *saved*
 * rather than what is being typed. So this is a schematic: the same pieces
 * in the same order, carrying the real text and the real images, laid out
 * loosely enough to fit a 320px rail.
 *
 * What it is actually for is the hover: put the pointer on a field in the
 * form and the part of the page it changes lights up over here. Every region
 * carries `data-pv="<key>"`, every form control that edits one carries
 * `data-pv-target="<key>"`, and wirePreviewHover() joins them up. That is
 * also why it is worth keeping the layout vaguely faithful — the answer it
 * gives is "the line under the handwriting", not "field 7".
 *
 * Text goes in as HTML rather than as text, on purpose: the content is
 * authored HTML, so `Signed Writer &middot; …` renders here as the middle
 * dot it will be on the page rather than as the entity you typed.
 *
 * It follows the interface language, so switching to 中文 previews the
 * Chinese homepage.
 */

const PV_EMPTY = '<span class="pv__empty"></span>';

/* The admin has its own motion check; the site's lives in main.js. */
const REDUCED_UI = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Authored HTML, or a dash when the field is empty. */
function pvHtml(text) {
  return (text && String(text).trim()) ? text : PV_EMPTY;
}

function pvRegion(key, className, ...kids) {
  return el('div', { className: `pv__${className}`, 'data-pv': key }, ...kids);
}

/* The browser tab above the page: the icon and the title as a tab actually
 * shows them, which is the only place on the site those two appear together. */
/* `page` is the content's key for it, which is not always what the page is
 * called: the Visuals page is `videos` and In the Making is `press`. The
 * filenames were renamed to match the nav; these keys were not, because
 * every #anchor and every content file would have had to move with them. */
function pvChrome(loc, shared, page = 'home') {
  const icon = shared.images && shared.images.favicon;
  return pvRegion('tab', 'chrome',
    el('span', { className: 'pv__dots' }, el('i', {}), el('i', {}), el('i', {})),
    el('span', { className: 'pv__tab' },
      icon
        ? el('img', { className: 'pv__fav', src: '/' + icon, alt: '' })
        : el('span', { className: 'pv__fav pv__fav--none' }),
      el('span', { className: 'pv__tabname' }, (loc.pages[page] || {}).title || '')),
  );
}

function pvNav(loc) {
  const nav = loc.nav || { links: [], cta: {} };
  return pvRegion('nav', 'nav',
    el('span', { className: 'pv__mark' }, 'TONY D'),
    ...(nav.links || []).map((l) => el('span', { className: 'pv__navitem', html: l.label || '' })),
    el('span', { className: 'pv__cta', html: (nav.cta && nav.cta.label) || '' }),
  );
}

/* The hero, which is nearly the whole homepage: the portrait behind
 * everything, then the four lines stacked over it in page order. */
function pvHero(loc, shared) {
  const hero = loc.hero || {};
  const img = shared.images || {};
  const frames = heroLoopFrames(shared);

  return el('div', { className: 'pv__hero' },
    img.hero
      ? el('img', { className: 'pv__bg', src: '/' + img.hero, alt: '', 'data-pv': 'hero.image' })
      : el('div', { className: 'pv__bg pv__bg--none', 'data-pv': 'hero.image' }),
    el('div', { className: 'pv__scrim' }),
    el('div', { className: 'pv__heroinner' },
      pvRegion('hero.eyebrow', 'eyebrow',
        el('i', { className: 'pv__dot' }),
        el('span', { html: pvHtml(hero.eyebrow) })),

      // the handwriting: every frame of the loop, stacked the way they take
      // turns on the page, so the region lights as one thing
      pvRegion('hero.loop', 'ink',
        ...(frames.length
          ? frames.map((src, i) =>
              el('img', { src: '/' + src, alt: '', className: i ? 'pv__inkimg pv__inkimg--alt' : 'pv__inkimg' }))
          : [el('span', { className: 'pv__empty' })])),

      pvRegion('hero.count', 'count', el('span', { html: pvHtml(hero.count) })),
      pvRegion('hero.outNow', 'out', el('span', { html: pvHtml(hero.outNow) })),
      pvRegion('hero.audio', 'actions',
        el('span', { className: 'pv__play' }, '▶'),
        el('span', { className: 'pv__playlabel', html: pvHtml(hero.playLabel) }),
        el('span', { className: 'pv__secondary',
                     html: pvHtml(hero.secondary && hero.secondary.label) })),
    ),
  );
}

/* A small numbered heading, the way each homepage section opens. */
function pvHomeHead(loc, key, pvKey) {
  const sec = (loc.sections || {})[key] || {};
  return el('div', { className: 'pv__section', 'data-pv': pvKey },
    pvEditable(el('h4', { className: 'pv__h', html: pvHtml(sec.title) }), sec, 'title'),
    sec.desc
      ? pvEditable(el('p', { className: 'pv__desc', html: pvHtml(sec.desc) }), sec, 'desc')
      : null);
}

/* 01 — the three records, as the homepage shows them: cover, labels, name
 * and the one-line meta. No description paragraph; that is the Music page. */
function pvHomeReleases(loc, shared) {
  const cards = (shared.releases || []).map((r) => {
    const c = (loc.releases || {})[r.id] || {};
    const tags = Array.isArray(c.tags) ? c.tags.filter(Boolean)
               : (r.badge && c.badge) ? [c.badge] : [];
    return el('div', { className: 'pv__rel', 'data-pv': 'music.release.' + r.id },
      el('div', { className: 'pv__relart' },
        el('img', { src: '/' + r.art, alt: '', loading: 'lazy' }),
        tags.length
          ? el('span', { className: 'pv__reltags' },
              ...tags.map((t) => el('span', { className: 'pv__reltag', html: t })))
          : null),
      el('span', { className: 'pv__reltitle', html: pvHtml(c.title) }),
      el('span', { className: 'pv__relmeta', html: pvHtml(c.meta) }));
  });
  return el('div', { className: 'pv__block' },
    pvHomeHead(loc, 'music', 'music.heading'),
    el('div', { className: 'pv__rels' }, ...cards));
}

/* 02 — the one thing the homepage leads with: the title video, or the
 * picture standing in for it. Not the grid; that is the Visuals page. */
function pvHomeVisuals(loc, shared) {
  const images = shared.images || {};
  const feature = (shared.videos || []).find((v) => v.feature);
  const fv = feature ? (loc.videos || {})[feature.id] || {} : {};
  const sec = (loc.sections || {}).videos || {};
  const pic = images.homeVisual;

  return el('div', { className: 'pv__block' },
    pvHomeHead(loc, 'videos', 'visuals.heading'),
    el('div', { className: 'pv__feature', 'data-pv': 'home.visuals' },
      el('img', { src: '/' + (pic || (feature && feature.poster) || ''), alt: '', loading: 'lazy' }),
      pic ? null : el('span', { className: 'pv__playdot' }, '▶')),
    (!pic && (fv.kicker || fv.title || fv.sub))
      ? el('span', { className: 'pv__featmeta' },
          fv.kicker ? el('span', { className: 'pv__featkicker', html: fv.kicker }) : null,
          fv.title ? el('span', { html: fv.title }) : null,
          fv.sub ? el('span', { className: 'pv__featsub', html: fv.sub }) : null)
      : null,
    sec.more ? el('span', { className: 'pv__more', html: sec.more }) : null);
}

/* 03 — the portrait, the line he leads with, and the profile table. */
function pvHomeAbout(loc, shared) {
  const a = loc.about || {};
  const photo = (shared.images || {}).aboutBottom;
  const facts = (a.facts || []).slice(0, 6);

  return el('div', { className: 'pv__block' },
    pvHomeHead(loc, 'about', 'about.heading'),
    el('div', { className: 'pv__about' },
      el('div', { className: 'pv__aboutshot', 'data-pv': 'about.image' },
        photo
          ? el('img', { src: '/' + photo, alt: '', loading: 'lazy' })
          : el('span', { className: 'pv__bannernone' }, T('no picture'))),
      el('div', { className: 'pv__aboutcol' },
        a.quote
          ? el('p', { className: 'pv__quote', 'data-pv': 'about.quote', html: a.quote })
          : null,
        facts.length
          ? el('div', { className: 'pv__stats', 'data-pv': 'about.stats' },
              a.profileHeading
                ? el('span', { className: 'pv__statshead', html: a.profileHeading })
                : null,
              ...facts.map((f) => el('span', { className: 'pv__stat' },
                el('span', { className: 'pv__statterm', html: f.term || '' }),
                el('span', { className: 'pv__statval', html: f.value || '' }))))
          : null)));
}

/* 04 — the six most recent entries, which the homepage takes from the
 * About page's timeline. Shown here the way build.py trims them, so what
 * drops off the bottom is visible rather than something to find out later. */
function pvHomeTimeline(loc, shared) {
  const text = loc.milestones || {};
  const rows = [];
  let left = 6;
  for (const row of [...(shared.milestones || [])].reverse()) {
    if (left <= 0) break;
    const taken = (row.items || []).slice(0, left);
    if (!taken.length) continue;
    rows.push({ ...row, items: taken });
    left -= taken.length;
  }

  return el('div', { className: 'pv__block' },
    pvHomeHead(loc, 'milestones', 'milestones.heading'),
    el('div', { className: 'pv__tl' },
      ...rows.map((y) => el('div', {
        className: 'pv__tlrow', 'data-pv': 'milestones.year.' + y.year,
      },
        el('span', {
          className: 'pv__tlyear' + (y.current ? ' is-now' : ''),
          style: y.color ? `color:${y.color}` : null,
        }, y.year),
        el('span', { className: 'pv__tllist' },
          ...y.items.map((id) =>
            el('span', { className: 'pv__tlitem', html: text[id] || id })))))));
}

/* The homepage, all of it.
 *
 * Every section is drawn at once rather than swapped in when a fold opens:
 * the rail is a map of the page, and a map that only shows the bit you are
 * standing on is not much of a map. It also means hovering any field lights
 * its part without the rail having to be showing that section first. The
 * rail scrolls on its own when the page outgrows the window. */
function previewHome() {
  const loc = LOC(UI.lang);
  const shared = SHARED();
  return el('div', { className: 'pv' },
    pvChrome(loc, shared, 'home'),
    el('div', { className: 'pv__page' },
      pvNav(loc),
      pvHero(loc, shared),
      el('div', { className: 'pv__body' },
        pvHomeReleases(loc, shared),
        pvHomeVisuals(loc, shared),
        pvHomeAbout(loc, shared),
        pvHomeTimeline(loc, shared))),
  );
}


/* ---------------------------------------------------------------- editing

   Double-click a heading in the preview and type into it. Same gesture as
   renaming a tab, and it writes to exactly the place the form field writes
   to, so the two never disagree.

   Offered only on text that is plain. A lot of the content is authored HTML
   - the bio is `<b class="key">Tony D</b>: …` - and editing that as plain
   text would eat the markup, so anything carrying a tag is left to the form,
   where you can see what you are changing.
*/
function pvEditable(node, obj, key) {
  const value = obj && obj[key];
  if (typeof value !== 'string' || value.includes('<')) return node;
  node.classList.add('pv__edit');
  node.title = T('Double-click to edit');
  node.pvEdit = { obj, key };
  return node;
}

function startPvEdit(node) {
  if (node.isContentEditable) return;
  const { obj, key } = node.pvEdit;
  const before = obj[key];

  node.contentEditable = 'plaintext-only';
  if (node.contentEditable !== 'plaintext-only') node.contentEditable = 'true';
  node.classList.add('is-editing');
  node.focus();
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    node.removeEventListener('keydown', onKey);
    node.removeEventListener('blur', onBlur);
    node.contentEditable = 'false';
    node.classList.remove('is-editing');
    window.getSelection().removeAllRanges();

    const next = node.textContent.replace(/\s+/g, ' ').trim();
    if (keep && next !== before) {
      obj[key] = next;
      markDirty();
      // the form is showing the same value in a box somewhere; repaint both
      renderPanel();
    } else {
      node.textContent = before;
    }
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  const onBlur = () => finish(true);
  node.addEventListener('keydown', onKey);
  node.addEventListener('blur', onBlur);
}

function wirePreviewEditing() {
  const rail = document.getElementById('preview');
  if (!rail) return;
  rail.addEventListener('dblclick', (e) => {
    const node = e.target.closest('.pv__edit');
    if (node && node.pvEdit) startPvEdit(node);
  });
}

/* A numbered section heading and its standfirst, both editable in place. */
function pvSection(loc, key, pvKey) {
  const sec = (loc.sections || {})[key] || {};
  return el('div', { className: 'pv__section', 'data-pv': pvKey },
    pvEditable(el('h4', { className: 'pv__h', html: pvHtml(sec.title) }, ), sec, 'title'),
    sec.desc
      ? pvEditable(el('p', { className: 'pv__desc', html: pvHtml(sec.desc) }), sec, 'desc')
      : null,
  );
}

/* The Music page: the heading, then the three records. */
function previewMusic() {
  const loc = LOC(UI.lang);
  const shared = SHARED();
  const releases = shared.releases || [];

  const cards = releases.map((r) => {
    const c = (loc.releases || {})[r.id] || {};
    const tags = Array.isArray(c.tags) ? c.tags.filter(Boolean)
               : (r.badge && c.badge) ? [c.badge] : [];
    return el('div', { className: 'pv__rel', 'data-pv': 'music.release.' + r.id },
      el('div', { className: 'pv__relart' },
        el('img', { src: '/' + r.art, alt: '', loading: 'lazy' }),
        tags.length
          ? el('span', { className: 'pv__reltags' },
              ...tags.map((t) => el('span', { className: 'pv__reltag', html: t })))
          : null),
      el('span', { className: 'pv__reltitle', html: pvHtml(c.title) }),
      el('span', { className: 'pv__relmeta', html: pvHtml(c.meta) }));
  });

  return el('div', { className: 'pv' },
    pvChrome(loc, shared, 'music'),
    el('div', { className: 'pv__page' },
      pvNav(loc),
      el('div', { className: 'pv__body' },
        pvSection(loc, 'music', 'music.heading'),
        el('div', { className: 'pv__rels' }, ...cards))),
  );
}

/* The Visuals page: the heading, the title video, the optional picture
 * under it, and the grid it all sits above. */
function previewVisuals() {
  const loc = LOC(UI.lang);
  const shared = SHARED();
  const feature = (shared.videos || []).find((v) => v.feature);
  const fv = feature ? (loc.videos || {})[feature.id] || {} : {};
  const banner = (shared.images || {}).visualsBanner;
  const vf = loc.visualsFilter;

  // the whole grid, not a sample: each cell is hoverable from its own card,
  // and a cell that is not drawn cannot be pointed at
  const cells = typeof visualsOrderPreview === 'function' ? visualsOrderPreview(shared) : [];

  return el('div', { className: 'pv' },
    pvChrome(loc, shared, 'videos'),
    el('div', { className: 'pv__page' },
      pvNav(loc),
      el('div', { className: 'pv__body' },
        pvSection(loc, 'videos', 'visuals.heading'),
        // Only when the grid actually holds both kinds, which is the same
        // condition build.py prints it under - a preview that showed the
        // switch on a photos-only grid would be promising a control the
        // page does not render.
        (vf && (shared.photos || []).length && (shared.videos || []).length)
          ? el('div', { className: 'pv__filter', 'data-pv': 'visuals.filter' },
              ...['all', 'photos', 'videos'].map((k, i) =>
                el('span', { className: 'pv__fbtn' + (i === 0 ? ' is-on' : '') }, vf[k] || '')))
          : null,
        feature
          ? el('div', { className: 'pv__feature', 'data-pv': 'visuals.feature' },
              el('img', { src: '/' + feature.poster, alt: '', loading: 'lazy' }),
              el('span', { className: 'pv__playdot' }, '▶'),
              (fv.kicker || fv.title || fv.sub)
                ? el('span', { className: 'pv__featmeta' },
                    fv.kicker ? el('span', { className: 'pv__featkicker', html: fv.kicker }) : null,
                    fv.title ? el('span', { html: fv.title }) : null,
                    fv.sub ? el('span', { className: 'pv__featsub', html: fv.sub }) : null)
                : null)
          : null,
        el('div', { className: 'pv__banner', 'data-pv': 'visuals.banner' },
          banner
            ? el('img', { src: '/' + banner, alt: '', loading: 'lazy' })
            : el('span', { className: 'pv__bannernone' }, T('no picture'))),
        el('div', { className: 'pv__gwrap' },
          el('div', { className: 'pv__gallery' },
            ...cells.map((c) => el('div', {
              className: 'pv__cell' + (c.kind === 'video' ? ' pv__cell--video' : ''),
              'data-pv': 'visuals.cell.' + c.key,
              style: `--c:${c.c};--r:${c.r}`,
            },
              el('img', { src: '/' + c.src, alt: '', loading: 'lazy' }),
              c.kind === 'video' ? el('span', { className: 'pv__celldot' }, '▶') : null))))),
    ),
  );
}

/* The first few things in the Visuals grid, whatever kind they are. */
/* Mirrors PHOTO_SPANS / VIDEO_SPANS in build.py. Duplicated rather than
 * derived because the rail has no way to ask the Python that renders the
 * page - keep the two in step when a shape or size is added. Columns by
 * rows, out of twelve. */
const PV_PHOTO_SPANS = {
  square:    { s: [3, 3], m: [4, 4], l: [6, 6] },
  portrait:  { s: [3, 4], m: [4, 5], l: [6, 8] },
  tall:      { s: [2, 3], m: [4, 6], l: [6, 9] },
  landscape: { s: [3, 2], m: [6, 4], l: [9, 6] },
  wide:      { s: [4, 2], m: [8, 4], l: [12, 6] },
  panorama:  { s: [6, 2], m: [9, 3], l: [12, 4] },
};
const PV_VIDEO_SPANS = { s: [4, 2], m: [6, 3], l: [8, 4] };

/* The grid in reading order, each cell carrying the span build.py will give
 * it. Same fallbacks as the page: an unknown shape or size lands on the
 * middle of the table rather than dropping the cell. */
function visualsOrderPreview(shared) {
  const cell = (key, kind, src, span) => ({ key, kind, src, c: span[0], r: span[1] });
  const photos = new Map((shared.photos || []).map((p) => [
    `photo:${p.id}`,
    cell(`photo:${p.id}`, 'photo', p.src,
         ((PV_PHOTO_SPANS[p.shape] || PV_PHOTO_SPANS.square)[p.size]
          || PV_PHOTO_SPANS.square.m)),
  ]));
  const videos = new Map((shared.videos || []).filter((v) => !v.feature).map((v) => [
    `video:${v.id}`,
    cell(`video:${v.id}`, 'video', v.poster, PV_VIDEO_SPANS[v.size] || PV_VIDEO_SPANS.s),
  ]));
  const order = (shared.visualsOrder || []).filter((r) => photos.has(r) || videos.has(r));
  for (const k of [...photos.keys(), ...videos.keys()]) if (!order.includes(k)) order.push(k);
  return order.map((r) => photos.get(r) || videos.get(r)).filter((c) => c && c.src);
}

/* The About page: the photograph beside the bio, and the stats under it. */
function previewAbout() {
  const loc = LOC(UI.lang);
  const shared = SHARED();
  const a = loc.about || {};
  const photo = (shared.images || {}).aboutTop;
  const facts = (a.facts || []).slice(0, 5);

  return el('div', { className: 'pv' },
    pvChrome(loc, shared, 'about'),
    el('div', { className: 'pv__page' },
      pvNav(loc),
      el('div', { className: 'pv__body' },
        pvSection(loc, 'about', 'about.heading'),
        el('div', { className: 'pv__about' },
          el('div', { className: 'pv__aboutshot', 'data-pv': 'about.image' },
            photo
              ? el('img', { src: '/' + photo, alt: '', loading: 'lazy' })
              : el('span', { className: 'pv__bannernone' }, T('no picture'))),
          el('div', { className: 'pv__aboutcol' },
            el('div', { className: 'pv__prose', 'data-pv': 'about.prose' },
              ...(a.prose || []).slice(0, 2).map((para) =>
                el('p', { className: 'pv__para', html: para }))),
            a.quote
              ? el('p', { className: 'pv__quote', 'data-pv': 'about.quote', html: a.quote })
              : null)),
        facts.length
          ? el('div', { className: 'pv__stats', 'data-pv': 'about.stats' },
              a.profileHeading
                ? el('span', { className: 'pv__statshead', html: a.profileHeading })
                : null,
              ...facts.map((f) => el('span', { className: 'pv__stat' },
                el('span', { className: 'pv__statterm', html: f.term || '' }),
                el('span', { className: 'pv__statval', html: f.value || '' }))))
          : null)),
  );
}


/* The timeline: a year, then what happened in it. */
function previewMilestones() {
  const loc = LOC(UI.lang);
  const shared = SHARED();
  const text = loc.milestones || {};
  const years = [...(shared.milestones || [])].reverse();

  return el('div', { className: 'pv' },
    pvChrome(loc, shared, 'about'),
    el('div', { className: 'pv__page' },
      pvNav(loc),
      el('div', { className: 'pv__body' },
        pvSection(loc, 'milestones', 'milestones.heading'),
        el('div', { className: 'pv__tl' },
          ...years.map((y) => el('div', {
            className: 'pv__tlrow', 'data-pv': 'milestones.year.' + y.year,
          },
            el('span', {
              className: 'pv__tlyear' + (y.current ? ' is-now' : ''),
              style: y.color ? `color:${y.color}` : null,
            }, y.year),
            el('span', { className: 'pv__tllist' },
              ...(y.items || []).slice(0, 4).map((id) =>
                el('span', { className: 'pv__tlitem', html: text[id] || id })),
              (y.items || []).length > 4
                ? el('span', { className: 'pv__tlmore' },
                    T('+{n} more', { n: y.items.length - 4 }))
                : null))))),
    ),
  );
}

/* Press & mentions, at the foot of the About page. */
function previewPress() {
  const loc = LOC(UI.lang);
  const shared = SHARED();
  const text = loc.press || {};

  return el('div', { className: 'pv' },
    pvChrome(loc, shared, 'about'),
    el('div', { className: 'pv__page' },
      pvNav(loc),
      el('div', { className: 'pv__body' },
        pvSection(loc, 'coverage', 'press.heading'),
        el('div', { className: 'pv__press' },
          ...(shared.press || []).map((item) => {
            const c = text[item.id] || {};
            return el('div', { className: 'pv__pressitem', 'data-pv': 'press.item.' + item.id },
              el('span', { className: 'pv__presssrc', html: pvHtml(c.src) }),
              el('span', { className: 'pv__presstitle', html: pvHtml(c.title) }),
              c.gloss ? el('span', { className: 'pv__pressgloss', html: c.gloss }) : null);
          }))),
    ),
  );
}

/* In the Making: the heading, Now Recording, and the ring that turns. */
function previewMaking() {
  const loc = LOC(UI.lang);
  const shared = SHARED();
  const rec = shared.recording;
  const recText = loc.recording || {};
  const orbit = shared.orbit;

  return el('div', { className: 'pv' },
    pvChrome(loc, shared, 'press'),
    el('div', { className: 'pv__page' },
      pvNav(loc),
      el('div', { className: 'pv__body' },
        pvSection(loc, 'press', 'making.heading'),
        rec
          ? el('div', { className: 'pv__rec', 'data-pv': 'making.recording' },
              el('h5', { className: 'pv__rech', html: pvHtml(recText.title) }),
              recText.desc ? el('p', { className: 'pv__recdesc', html: recText.desc }) : null,
              el('div', { className: 'pv__ring' },
                el('img', { className: 'pv__ringmid', src: '/' + rec.centre, alt: '', loading: 'lazy' }),
                ...(rec.photos || []).slice(0, 5).map((ph) =>
                  el('img', { className: 'pv__ringpic', src: '/' + ph.src, alt: '', loading: 'lazy' }))))
          : null,
        orbit
          ? el('div', { className: 'pv__rec', 'data-pv': 'making.orbit' },
              el('div', { className: 'pv__ring' },
                ...(orbit.photos || []).slice(0, 6).map((src) =>
                  el('img', { className: 'pv__ringpic', src: '/' + src, alt: '', loading: 'lazy' }))))
          : null)),
  );
}

/* Contact and the footer, which finish every page. */
function previewContact() {
  const loc = LOC(UI.lang);
  const shared = SHARED();
  const contact = loc.contact || {};
  const footer = loc.footer || {};

  return el('div', { className: 'pv' },
    pvChrome(loc, shared, 'home'),
    el('div', { className: 'pv__page' },
      el('div', { className: 'pv__body' },
        pvSection(loc, 'contact', 'contact.heading'),
        el('div', { className: 'pv__mail', 'data-pv': 'contact.email' },
          el('span', { className: 'pv__who', html: pvHtml(contact.who) }),
          el('span', { className: 'pv__addr' }, shared.contactEmail || '')),
        el('div', { className: 'pv__cols', 'data-pv': 'contact.columns' },
          ...(contact.columns || []).map((col) =>
            el('div', { className: 'pv__col' },
              el('span', { className: 'pv__colhead', html: pvHtml(col.heading) }),
              ...(col.items || []).slice(0, 5).map((it) =>
                el('span', { className: 'pv__colitem' },
                  el('span', { html: it.label || '' }),
                  it.muted ? el('span', { className: 'pv__muted', html: it.muted }) : null))))),
        el('div', { className: 'pv__footer', 'data-pv': 'footer' },
          el('span', {}, '© ' + (shared.copyrightYear || '') + ' '),
          el('span', { html: pvHtml(footer.copyright) })))),
  );
}

/* Every part of the site has one. A tab with no preview says so rather than
 * showing an empty frame, so it does not read as something broken. */
const PREVIEWS = {
  home: previewHome,
  music: previewMusic,
  visuals: previewVisuals,
  about: previewAbout,
  milestones: previewMilestones,
  press: previewPress,
  making: previewMaking,
  contact: previewContact,
};

/* Which of them the rail is showing.
 *
 * Usually it follows the tab. But the Tony D tab now carries the whole site
 * in folds, and a rail stuck on the hero while you edit the timeline is a
 * rail nobody looks at - so opening a fold points it at that section, and
 * closing them all points it back at the top of the page. `state.section`
 * is that override; it is cleared whenever the tab changes. */
function previewKey() {
  return state.section || state.tab;
}

function setPreviewSection(key) {
  if (state.section === key) return;
  state.section = key;
  renderPreview();
}

function renderPreview() {
  const rail = document.getElementById('preview');
  if (!rail) return;
  const make = state.files ? PREVIEWS[previewKey()] : null;
  if (!make) {
    rail.replaceChildren(el('p', { className: 'pv__none' }, T('No preview for this section yet.')));
    return;
  }
  try {
    rail.replaceChildren(
      el('p', { className: 'pv__title' }, T('Preview'), el('span', { className: 'pv__lang' }, LANG[UI.lang].label)),
      make(),
    );
  } catch (err) {
    rail.replaceChildren(el('p', { className: 'pv__none' }, T('Preview unavailable: {message}', { message: err.message })));
  }
}

/* Typing repaints the preview, but not on every keystroke: rebuilding the
 * whole rail mid-word is wasted work, and the images would flicker. */
let pvTimer = null;
function renderPreviewSoon() {
  clearTimeout(pvTimer);
  pvTimer = setTimeout(renderPreview, 250);
}

/* Pointing at a field lights the piece of the page it changes.
 *
 * Delegated from the panel rather than bound per field, so it survives every
 * re-render, and `closest` resolves to the innermost target — which is what
 * lets a single field inside a card claim a smaller region than the card.
 *
 * Focus counts as well as hover: tabbing through the form lights the same
 * regions, which is the only way to get this with a keyboard.
 */
/* Put a position of the rail in view.
 *
 * Assigning scrollTop, rather than scrollTo({behavior:'smooth'}): smooth is
 * a no-op in some browsers and whenever smooth scrolling is off at the OS or
 * browser level, and it fails silently - the rail simply never moved. The
 * rail is a small map and the jump is short, so there is nothing here worth
 * animating at the cost of it sometimes not happening at all.
 */
function railScrollTo(rail, to) {
  const limit = rail.scrollHeight - rail.clientHeight;
  rail.scrollTop = Math.max(0, Math.min(to, limit));
}

function wirePreviewHover() {
  const panel = document.getElementById('panel');
  const rail = document.getElementById('preview');
  if (!panel || !rail) return;

  let lit = null;
  const clear = () => {
    if (!lit) return;
    rail.querySelectorAll('.is-lit').forEach((n) => n.classList.remove('is-lit'));
    rail.classList.remove('is-pointing');
    lit = null;
  };
  const light = (key) => {
    // `lit` alone is not enough to skip the work: the rail is rebuilt
    // whenever the preview changes or the content is edited, and that throws
    // the highlight away while this closure still remembers the key. Check
    // that something is actually lit before deciding there is nothing to do.
    if (key === lit && rail.querySelector('.is-lit')) return;
    clear();
    const nodes = rail.querySelectorAll(`[data-pv="${CSS.escape(key)}"]`);
    if (!nodes.length) return;
    nodes.forEach((n) => n.classList.add('is-lit'));
    rail.classList.add('is-pointing');
    lit = key;

    // The rail holds the whole page and scrolls on its own, so the part
    // being pointed at may be out of sight. Bring it into view - but only
    // when it actually is, or every hover would nudge the rail about.
    // scrollIntoView() is no good here: it walks up to the nearest scrolling
    // ancestor, which for a sticky rail is the window, so it moved the form
    // instead. Scroll the rail itself, by hand.
    const box = nodes[0].getBoundingClientRect();
    const view = rail.getBoundingClientRect();
    if (box.top < view.top + 4 || box.bottom > view.bottom - 4) {
      const centred = (box.top - view.top) - (view.height - box.height) / 2;
      railScrollTo(rail, rail.scrollTop + centred);
    }
  };

  const from = (e) => {
    const hit = e.target.closest('[data-pv-target]');
    if (hit) light(hit.dataset.pvTarget);
    else clear();
  };

  panel.addEventListener('mouseover', from);
  panel.addEventListener('mouseleave', clear);
  panel.addEventListener('focusin', from);
  panel.addEventListener('focusout', clear);
}

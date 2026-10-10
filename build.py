#!/usr/bin/env python3
"""Render index.html and zh/index.html from content/*.json.

No template engine and no third-party dependencies — the page structure is
fixed, so it lives here as code, and everything that changes lives in
content/. That keeps the Cloudflare Pages build to a bare `python build.py`
with no requirements.txt to install.

    python build.py            # write index.html and zh/index.html in place
    python build.py --dist     # assemble a deployable dist/ (what Pages runs)
    python build.py --check    # render and diff against what is on disk

content/shared.json holds the spine: ids, order, media paths and the
non-text attributes (which video is the feature, which release gets the
badge). content/en.json and content/zh.json hold every string, keyed by
those same ids, so the two locales stay paired and adding an item is one
edit rather than two.

String values are authored HTML, not escaped text: they may contain <em>,
<strong>, <b>, <span lang="..."> and entities, because the real copy needs
them. Attribute values (urls, alt text, ids) ARE escaped.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"

BANNER = (
    "<!-- GENERATED FILE — do not edit by hand.\n"
    "     Source: content/*.json + build.py. Hand edits are lost on the next\n"
    "     build. Edit the JSON (or use the admin at /admin) and re-run\n"
    "     `python build.py`. -->"
)


# ---------------------------------------------------------------- helpers

def asset(rel: str, prefix: str) -> str:
    """`css/styles.css?v=<hash of its contents>`.

    Without this a browser keeps serving the stylesheet it already has, and an
    edit looks like it silently did nothing - new markup wearing old CSS.
    """
    digest = hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()[:8]
    return f"{prefix}{rel}?v={digest}"


def attr(value: str) -> str:
    """Escape a value for use inside a double-quoted HTML attribute."""
    return escape(str(value), quote=True)


def lang_attr(value: str | None) -> str:
    return f' lang="{attr(value)}"' if value else ""


def indent(lines: list[str], by: int) -> list[str]:
    pad = " " * by
    return [pad + line if line else line for line in lines]


# The site is five pages per locale. The homepage carries a trimmed version
# of each section and links through; the other four carry the full thing.
# The file each page is written to. The keys are the content's own names
# for the sections and do not all match: `videos` is the Visuals page and
# `press` is In the Making. Renaming the keys would mean migrating every
# content file and every #anchor with them, so the keys stayed and the
# filenames follow what the nav calls them.
PAGE_FILE = {
    "home": "index.html",
    "music": "music.html",
    "videos": "visuals.html",
    "about": "about.html",
    "press": "inthemaking.html",
}

# What the pages used to be called. Anything already linking to them gets a
# redirect rather than a 404 - see build_dist.
RENAMED_PAGES = {
    "videos.html": "visuals.html",
    "making.html": "inthemaking.html",
}


ARROW_PREV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4l-8 8 8 8"/></svg>'
ARROW_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4l8 8-8 8"/></svg>'

PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>'
# two stacked frames: "there is more than one picture in here"
ALBUM_SVG = ('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="14" height="14" rx="2"/>'
             '<path d="M17 21H5a2 2 0 0 1-2-2V7"/></svg>')


# ---------------------------------------------------------------- sections

def render_head(loc: dict, page: str, shared: dict | None = None,
                own: tuple[str, str, str] | None = None) -> list[str]:
    """`own` is (title, description, file) for a page that is not one of
    the five - a journal post - which still borrows its section's head."""
    p = loc["assetPrefix"]
    head = loc["pages"][page]
    rel = PAGE_FILE[page]
    if own:
        head = {"title": own[0], "description": own[1]}
        rel = own[2]
    # The tab icon, if one has been uploaded. No entry means no <link>, which
    # is what the site did before there was a field for it: browsers then ask
    # for /favicon.ico, get a 404, and show their own placeholder.
    icon = (shared or {}).get("images", {}).get("favicon")
    return [
        "<head>",
        '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        f'<title>{head["title"]}</title>',
        f'<meta name="description" content="{attr(head["description"])}">',
        *([f'<link rel="icon" href="{p}{attr(icon)}">'] if icon else []),
        "<!-- fonts are self-hosted: fonts.googleapis.com is blocked in mainland China -->",
        f'<link rel="preload" href="{p}fonts/inter-400-latin.woff2" as="font" type="font/woff2" crossorigin>',
        f'<link rel="preload" href="{p}fonts/instrument-serif-400-latin.woff2" as="font" type="font/woff2" crossorigin>',
        f'<link rel="stylesheet" href="{asset("css/styles.css", p)}">',
        # each page points at its own counterpart, not back at the two homepages
        f'<link rel="alternate" hreflang="en" href="/{rel}">',
        f'<link rel="alternate" hreflang="zh-Hans" href="/zh/{rel}">',
        f'<link rel="alternate" hreflang="x-default" href="/{rel}">',
        "<!-- scroll-reveal is a progressive enhancement: without JS the content",
        "     must still be visible, so opt in to the hidden state only when JS runs -->",
        "<script>document.documentElement.classList.add('js');</script>",
        "</head>",
    ]


def render_nav(loc: dict, page: str, rel: str | None = None) -> list[str]:
    """Six evenly spaced slots; CSS orders the wordmark into the middle.

    `rel` is the file this page really is, when that is not its section's
    own (a journal post sits under In the Making but is its own file)."""
    nav = loc["nav"]
    mark = "#top" if page == "home" else "index.html"

    def link(l: dict) -> str:
        # the page you are on is marked rather than linked away from
        cur = " is-active" if l["href"] == PAGE_FILE[page] else ""
        aria = ' aria-current="page"' if cur else ""
        slug = l["href"].split(".")[0]
        return (f'    <a href="{attr(l["href"])}"'
                f' class="nav__item nav__item--{slug}{cur}"{aria}>{l["label"]}</a>')

    cta = nav["cta"]
    # contact sits at the foot of every page now, so this stays a local anchor
    cta_href = cta["href"]
    alt = nav["altLang"]
    # the other locale's copy of *this* page, not its homepage
    alt_href = ("zh/" if loc["assetPrefix"] == "" else "../") + (rel or PAGE_FILE[page])

    out = [
        "<!-- nav -->",
        '<header class="nav" id="nav">',
        f'  <nav class="nav__links" id="navLinks" aria-label="{attr(nav["ariaPrimary"])}">',
    ]
    out += [link(l) for l in nav["links"]]
    out += [
        "",
        "    <!-- contact and the language switch travel together as one slot -->",
        '    <span class="nav__pair">',
        f'      <a href="{attr(cta_href)}" class="nav__cta">{cta["label"]}</a>',
        f'      <a href="{attr(alt_href)}" class="nav__lang" lang="{attr(alt["lang"])}"'
        f' hreflang="{attr(alt["lang"])}">{alt["label"]}</a>',
        "    </span>",
        "  </nav>",
        "",
        "  <!-- outside .nav__links so it stays in the bar when the menu is a panel -->",
        f'  <a class="nav__mark" href="{mark}">TONY&nbsp;D</a>',
        "",
        "  <!-- shown under 900px, where the link row collapses -->",
        f'  <button class="nav__burger" id="navBurger" aria-expanded="false" aria-controls="navLinks" aria-label="{attr(nav["burgerLabel"])}">',
        "    <span></span><span></span><span></span>",
        "  </button>",
        "</header>",
    ]
    return out


def render_hero(loc: dict, shared: dict) -> list[str]:
    p = loc["assetPrefix"]
    hero = loc["hero"]
    sec = hero["secondary"]
    out = [
        "<!-- ================= HERO ================= -->",
        '<section class="hero">',
        '  <div class="hero__media">',
        f'    <img src="{p}{shared["images"]["hero"]}" alt="{attr(hero["imageAlt"])}" fetchpriority="high">',
        "  </div>",
        '  <div class="hero__scrim" aria-hidden="true"></div>',
        "",
        '  <div class="hero__inner">',
        '    <p class="hero__eyebrow reveal">',
        '      <span class="dot" aria-hidden="true"></span>',
        f'      {hero["eyebrow"]}',
        "    </p>",
        "",
        '    <h1 class="hero__title">',
        f'      <span class="sr-only">{hero["srTitle"]}</span>',
    ]
    # The handwriting, taking turns: the song title in his own hand, his
    # name in the same hand, and whatever else the admin has added since.
    #
    # This used to be exactly two images timed against each other by the
    # stylesheet. It is a list now, with the hold as a number, because the
    # admin needed to be able to add a third - so the hand-over is driven by
    # InkLoop in main.js rather than by keyframes that only ever knew how to
    # count to two. All the frames share one box; the first one is the
    # resting state, so a page with no JS shows the wordmark and nothing
    # moves, which is what it did before.
    frames = hero_loop_frames(shared)
    seconds = hero_loop_seconds(shared)
    if frames:
        out.append(
            f'      <span class="inks" aria-hidden="true"'
            f' data-loop="{seconds}" style="--n:{len(frames)}">'
        )
        for i, frame in enumerate(frames):
            rest = "" if i == 0 else " ink--queued"
            out.append(f'        <img class="ink{rest}" style="--i:{i}" src="{p}{frame}" alt="">')
        out.append("      </span>")
    out += [
        "    </h1>",
        "",
    ]

    # Either line can be emptied in the JSON without leaving a blank <p>
    # behind; putting the text back brings the line back.
    if hero.get("sub"):
        out += ['    <p class="hero__sub reveal">', f'      {hero["sub"]}', "    </p>", ""]
    if hero.get("count"):
        out += [f'    <p class="hero__count reveal">{hero["count"]}</p>', ""]

    out += [
        f'    <p class="hero__out reveal">{hero["outNow"]}</p>',
        "",
        '    <div class="hero__actions reveal">',
        # aria-label carries the name because the visible label is two
        # words deep and rolls between them; aria-pressed carries the state.
        f'      <button class="btn btn--play" id="playBtn" aria-pressed="false"'
        f' aria-label="{attr(hero["playLabel"])}">',
        # A record rather than a triangle. The disc, the glyph on its
        # label and the morph between the two are all one <svg>: the spin
        # is driven from JS so it can be eased up and down, and the play
        # mark and the note cross-fade so neither ever snaps.
        '        <span class="btn__icon" aria-hidden="true">',
        '          <svg class="cd" viewBox="0 0 40 40">',
        "            <defs>",
        '              <linearGradient id="cdSheen" x1="0" y1="0" x2="1" y2="1">',
        '                <stop offset="0" stop-color="#fff" stop-opacity=".95"/>',
        '                <stop offset=".35" stop-color="#fff" stop-opacity=".55"/>',
        '                <stop offset=".62" stop-color="#fff" stop-opacity=".85"/>',
        '                <stop offset="1" stop-color="#fff" stop-opacity=".5"/>',
        "              </linearGradient>",
        "            </defs>",
        '            <g class="cd__disc">',
        '              <circle cx="20" cy="20" r="19" fill="url(#cdSheen)"/>',
        # two faint grooves: enough to read as a pressed surface at 22px
        '              <circle cx="20" cy="20" r="15.2" fill="none"'
        ' stroke="currentColor" stroke-opacity=".18" stroke-width=".7"/>',
        '              <circle cx="20" cy="20" r="12.4" fill="none"'
        ' stroke="currentColor" stroke-opacity=".12" stroke-width=".7"/>',
        '              <circle cx="20" cy="20" r="9.4" fill="#fff"/>',
        '              <g class="cd__glyph" fill="currentColor">',
        '                <path class="cd__play" d="M16.9 14.6v10.8l9-5.4z"/>',
        # a quaver, drawn to sit in the same 10-unit box as the triangle
        # The quaver is drawn off-centre and small for the label it sits
        # on, so the shape is kept and the group placed instead: scaled up,
        # then translated so its bounding box centres on the spindle. The
        # static transform lives on the inner <g> so the CSS morph, which
        # owns .cd__note's own transform, has nothing to fight over.
        '                <g class="cd__note">',
        '                  <g transform="translate(-1.1 -2.1) scale(1.15)">',
        '                    <path d="M17.4 13.2h1.7v9.1a2.9 2.9 0 1 1-1.7-2.6z'
        'M19.1 13.2c2.6.5 4.3 1.9 4.3 4 0 .8-.2 1.5-.7 2.2.1-2.4-1.5-3.6-3.6-4.2z"/>',
        "                  </g>",
        "                </g>",
        "              </g>",
        "            </g>",
        "          </svg>",
        "        </span>",
        # Both words ship, stacked in a one-line window that slides. That
        # fixes the width jump swapping textContent used to cause - "Pause"
        # is longer than "Play" - and gives the change somewhere to go.
        '        <span class="btn__label" aria-hidden="true">',
        '          <span class="btn__roll">',
        f'            <span class="btn__word">{hero["playLabel"]}</span>',
        f'            <span class="btn__word">{hero["pauseLabel"]}</span>',
        "          </span>",
        "        </span>",
        "      </button>",
        # Revealed by JS only once a real playlist has loaded — with the
        # synth fallback there is nothing to skip to.
        f'      <button class="btn btn--skip" id="skipBtn" aria-label="{attr(hero["nextLabel"])}" hidden>',
        '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5.5v13l9-6.5z"/><rect x="16" y="5.5" width="2.6" height="13" rx="1"/></svg>',
        "      </button>",
        f'      <a class="btn btn--ghost" href="{attr(sec["href"])}">{sec["label"]}</a>',
        "    </div>",
        "  </div>",
        "",
        "  <!-- audio-reactive spectrum -->",
        '  <canvas class="hero__wave" id="wave" aria-hidden="true"></canvas>',
        f'  <p class="hero__note" id="audioNote" data-now="{attr(hero["nowPlaying"])}" hidden></p>',
        "",
        *render_playlist(loc, shared),
        "</section>",
    ]
    return out


def render_playlist(loc: dict, shared: dict) -> list[str]:
    """The hero player's queue, as inert JSON the page reads at boot.

    Kept out of main.js on purpose: the file paths and the track titles are
    content, they differ per locale, and the admin already round-trips
    anything it finds in the JSON.
    """
    files = {t["id"]: t["file"] for t in shared.get("tracks") or []}
    # Each locale queues its own selection: the English homepage opens on
    # "I Do", the Chinese one on the album's title track. Anything in
    # `tracks` that no locale names simply never loads.
    code = loc["lang"].split("-")[0]
    wanted = (shared.get("playlists") or {}).get(code, [])
    missing = [i for i in wanted if i not in files]
    if missing:
        raise SystemExit(f"playlists[{code}]: no track named {', '.join(missing)}")
    if not wanted:
        return []

    p = loc["assetPrefix"]
    titles = loc.get("tracks", {})
    queue = [
        {
            "id": tid,
            "src": f"{p}{files[tid]}",
            "title": titles.get(tid, {}).get("title", tid),
        }
        for tid in wanted
    ]
    # `<` escaped so a title can never close this script element early.
    body = json.dumps(queue, ensure_ascii=False).replace("<", "\u003c")
    return [
        '  <script type="application/json" id="playlist">' + body + "</script>",
    ]


def with_breaks(text: str) -> str:
    """A line break typed in the admin (Enter in a textarea) becomes a real
    one. Without it a standfirst runs on one line wherever there is room."""
    return text.replace("\r\n", "\n").replace("\n", "<br>")


def section_head(loc: dict, key: str, href: str | None = None,
                 aside: list[str] | None = None) -> list[str]:
    """`href` makes the heading itself the way through, with no extra label.

    `aside` is markup that sits to the right of the title on a wide window
    and drops under it on a narrow one - the Visuals filter is the only
    thing that uses it."""
    sec = loc["sections"][key]
    title = sec["title"]
    if href:
        title = f'<a class="section__link" href="{attr(href)}">{title}</a>'
    split = " section__head--split" if aside else ""
    out = [
        f'  <div class="section__head{split} reveal">',
    ]
    if aside:
        out.append('    <div class="section__headline">')
    pad = "      " if aside else "    "
    out += [
        f'{pad}<h2 class="section__title">{title}</h2>',
    ]
    # a standfirst is optional - Visuals carries none
    if sec.get("desc"):
        out.append(f'{pad}<p class="section__desc">{with_breaks(sec["desc"])}</p>')
    if aside:
        out.append("    </div>")
        out += ["    " + l for l in aside]
    out.append("  </div>")
    return out


def render_links(links: list[dict], pad: int) -> list[str]:
    out = []
    for link in links:
        if link.get("missing"):
            out.append(" " * pad + f'<a href="#" class="is-missing">{link["label"]}</a>')
        else:
            out.append(
                " " * pad
                + f'<a href="{attr(link["url"])}" target="_blank" rel="noopener">{link["label"]}</a>'
            )
    return out


# The record's type ring. A circle of radius 38 in a 0-100 viewBox, drawn
# clockwise from twelve o'clock, so a track list laid on it starts at the
# top and reads the way a pressed CD's matrix ring does.
RING_PATH = "M 50,12 a 38,38 0 1,1 0,76 a 38,38 0 1,1 0,-76"
RING_LEN = 238.76          # 2*pi*38, one lap


def render_disc(rel: dict, c: dict, full: bool) -> list[str]:
    """The record that slides out from behind the sleeve.

    Three different discs come out of this:

      * the singles card gets none at all ("disc": false) - its tracks are
        already listed as text in the card body, and there is no single
        album for a record to be;
      * on the homepage an album gets the plain disc it always had;
      * on the music page an album's disc carries its own track list around
        the outer ring, turning slowly so that every title passes through
        the crescent that clears the sleeve.

    The album name is set separately, near the hub and to the left - the
    part of the disc the sleeve never uncovers at rest. It is only there to
    be found.
    """
    if not rel.get("disc", True):
        return []

    s = "        "
    out = [f'{s}<span class="card__disc" aria-hidden="true">',
           f'{s}  <span class="card__disc-face"></span>']

    tracks = c.get("discTracks") if full else None
    if tracks:
        rid = rel["id"]
        # Non-breaking spaces, not ordinary ones. The ring ends on a
        # separator so the last title joins back onto the first, but XML
        # strips trailing whitespace - so that final space disappeared and
        # the seam read as "...TRUE ·CURIOSITY". A nbsp is a glyph and
        # survives, and using it throughout keeps every gap identical.
        sep = "&#160;&middot;&#160;"
        # The track that shares its name with the record is set in the
        # accent, the way a title track is the one you are pointed at.
        title = c.get("discTitleTrack")
        chunks = [
            f'<tspan class="card__ring-title">{n}</tspan>' if n == title else n
            for n in tracks
        ]
        # The trailing separator is the join that closes the circle. Without
        # it the last title ran straight into the first with nothing between
        # them - the one seam on the ring that had no bullet.
        ring = sep.join(chunks) + sep
        # tags draw nothing and entities - named or numeric - render as one
        # glyph, so measure the text as it will actually look
        seen = len(re.sub(r"<[^>]+>", "", re.sub(r"&#?[a-zA-Z0-9]+;", "x", ring)))
        size = max(2.5, min(4.2, RING_LEN / (seen * 0.62)))
        out += [
            f'{s}  <svg class="card__ring" viewBox="0 0 100 100">',
            f'{s}    <defs><path id="ring-{rid}" d="{RING_PATH}"></path></defs>',
            f'{s}    <text class="card__ring-t" font-size="{size:.2f}">',
            # textLength pins the list to exactly one lap: it always closes
            # the circle, with no gap and no overlap, whatever the titles are
            f'{s}      <textPath href="#ring-{rid}" startOffset="0"'
            f' textLength="{RING_LEN}" lengthAdjust="spacing">{ring}</textPath>',
            f'{s}    </text>',
            f'{s}  </svg>',
        ]
        if c.get("discSecret"):
            out += [
                f'{s}  <svg class="card__secret" viewBox="0 0 100 100">',
                f'{s}    <text x="30" y="51" text-anchor="middle">{c["discSecret"]}</text>',
                f'{s}  </svg>',
            ]

    out.append(f'{s}</span>')
    return out


def render_singles_years(loc: dict, c: dict) -> list[str]:
    """The singles card, one year per panel, newest first.

    Every panel is rendered and they are stacked in a single grid cell, so
    the card is always as tall as the busiest year and never resizes as you
    step through. Panels are hidden with visibility rather than [hidden] for
    exactly that reason - display:none would collapse the cell and put the
    jumping right back.

    With JS off, the first panel is the one marked on, so the card still
    shows a year of singles rather than nothing.
    """
    nav = loc["singlesNav"]
    years = c["singlesByYear"]
    # The right-hand arrow walks *backwards* through the years and the
    # left-hand one comes forward again - the panels are a stack being dealt
    # through rather than a timeline being scrubbed. Only the left arrow has
    # an end; the right one wraps from the oldest year round to the newest.
    out = [
        f'        <div class="years" data-years{lang_attr(c.get("copyLang"))}>',
        '          <div class="years__head">',
        f'            <button class="years__arrow" type="button" data-dir="-1"'
        f' aria-label="{attr(nav["next"])}">'
        f'<svg viewBox="0 0 24 24" aria-hidden="true">'
        f'<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor"'
        f' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
        f"</svg></button>",
        '            <span class="years__label" data-years-label>'
        f'{years[0]["year"]}</span>',
        f'            <button class="years__arrow" type="button" data-dir="1"'
        f' aria-label="{attr(nav["prev"])}">'
        f'<svg viewBox="0 0 24 24" aria-hidden="true">'
        f'<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor"'
        f' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
        f"</svg></button>",
        "          </div>",
        '          <div class="years__stack">',
    ]
    for i, y in enumerate(years):
        on = " is-on" if i == 0 else ""
        out.append(f'            <ul class="card__tracks years__panel{on}"'
                   f' data-year="{attr(y["year"])}">')
        for name in y["tracks"]:
            out.append(f"              <li>{name}</li>")
        out.append("            </ul>")
    out += ["          </div>", "        </div>"]
    return out


def render_stats_strip(loc: dict) -> list[str]:
    """The catalogue in figures, above the cards on the music page.

    Every value here is stated outright in the resume PDF - the two stream
    counts belong to named songs on named platforms and are quoted that way
    rather than summed into one catalogue-wide total the PDF never claims.
    """
    out = ['  <dl class="stats reveal">']
    for s in loc["stats"]:
        # A figure that belongs to one song links to that song. Which link
        # that is differs by locale on purpose: the English page can point at
        # the video, the Chinese one has to stay on a platform reachable from
        # the mainland, so it points at the artist on the platform the count
        # was measured on.
        url = s.get("url")
        out.append('    <div class="stat">')
        out.append(f'      <dt class="stat__value">{s["value"]}</dt>')
        if url:
            out += [
                '      <dd class="stat__label">',
                f'        <a href="{attr(url)}" target="_blank" rel="noopener">{s["label"]}</a>',
                "      </dd>",
            ]
        else:
            out.append(f'      <dd class="stat__label">{s["label"]}</dd>')
        out.append("    </div>")
    out.append("  </dl>")
    return out


def render_playlist_rail(loc: dict) -> list[str]:
    """The listening links as a looping strip, under a heading.

    The English page's are all YouTube, so it says so. The Chinese page's are
    not - YouTube is unreachable from the mainland, so that locale lists the
    platforms its audience actually uses and titles the strip accordingly.
    The labels come from the locale file; nothing here assumes either set.
    """
    # "All releases" and "Original songs" are two names for one YouTube
    # playlist; in a strip of five that reads as a mistake, so the same URL
    # is only ever listed once, under the first name it is given.
    links, seen = [], set()
    for l in loc["releases"]["singles"]["links"] + loc["playlists"]:
        if l["url"] in seen:
            continue
        seen.add(l["url"])
        links.append(l)

    out = [
        f'  <h3 class="rail__heading reveal">{loc["playlistsHeading"]}</h3>',
        f'  <div class="rail rail--links" aria-label="{attr(loc["railAria"]["playlists"])}">',
        '    <div class="rail__track" id="playlistRailTrack">',
        '      <span class="rail__set">',
    ]
    for l in links:
        out.append(
            f'        <a class="rail__link" href="{attr(l["url"])}"'
            f' target="_blank" rel="noopener">{l["label"]}</a>'
        )
    out += ["      </span>", "    </div>", "  </div>"]
    return out


def render_press_rail(loc: dict, shared: dict) -> list[str]:
    """Every press item, looping - the homepage shows them all this way rather
    than listing the first three."""
    out = [
        f'  <div class="rail rail--press" aria-label="{attr(loc["railAria"]["press"])}">',
        '    <div class="rail__track" id="pressRailTrack">',
        '      <span class="rail__set">',
    ]
    for item in shared["press"]:
        c = loc["press"][item["id"]]
        out += [
            f'        <a class="chip" href="{attr(item["url"])}" target="_blank" rel="noopener">',
            f'          <span class="chip__src">{c["src"]}</span>',
            f'          <span class="chip__title"{lang_attr(c.get("titleLang"))}>{c["title"]}</span>',
            "        </a>",
        ]
    out += ["      </span>", "    </div>", "  </div>"]
    return out


def render_press(loc: dict, shared: dict) -> list[str]:
    """Press and Weibo coverage, closing the About page.

    The client asked for it under About rather than a page of its own. It is
    the full list as cards, not the looping rail: at the foot of a page
    people have scrolled to on purpose, every item should be readable.
    """
    out = [
        "<!-- ================= PRESS & MENTIONS (about page) ================= -->",
        '<section class="section" id="coverage">',
    ] + section_head(loc, "coverage") + ["", '  <ul class="press">']
    for item in shared["press"]:
        c = loc["press"][item["id"]]
        out += [
            '    <li class="press__item reveal">',
            f'      <a href="{attr(item["url"])}" target="_blank" rel="noopener">',
            f'        <span class="press__src">{c["src"]}</span>',
            f'        <span class="press__title"{lang_attr(c.get("titleLang"))}>{c["title"]}</span>',
        ]
        if c.get("gloss"):
            out.append(f'        <span class="press__gloss">{c["gloss"]}</span>')
        out += ["      </a>", "    </li>"]
    out += ["  </ul>", "</section>"]
    return out


# The Photos grid is twelve columns whose rows are as tall as a column is
# wide, so a span of (columns, rows) is also the picture's shape. Each shape
# comes in three sizes; the placeholders in img/placeholder/ are cut to these.
PHOTO_SPANS = {
    "square":    {"s": (3, 3), "m": (4, 4), "l": (6, 6)},
    "portrait":  {"s": (3, 4), "m": (4, 5), "l": (6, 8)},
    "tall":      {"s": (2, 3), "m": (4, 6), "l": (6, 9)},
    "landscape": {"s": (3, 2), "m": (6, 4), "l": (9, 6)},
    "wide":      {"s": (4, 2), "m": (8, 4), "l": (12, 6)},
    "panorama":  {"s": (6, 2), "m": (9, 3), "l": (12, 4)},
}
# A photo with no size of its own (the admin's "Auto", which is what a new
# upload gets) takes one from this rhythm by its place in shared["photos"]:
# mostly small, a medium now and then, one large in every eight - the mix
# the grid packs best with, so nobody has to hand-tune it. A size set by
# hand always wins. AUTO_SIZES in admin/admin.js must match.
AUTO_SIZES = ("m", "s", "s", "l", "s", "m", "s", "s")


def photo_size(shared: dict, ph: dict) -> str:
    size = ph.get("size")
    if size in ("s", "m", "l"):
        return size
    k = next((i for i, other in enumerate(shared.get("photos", [])) if other is ph), 0)
    return AUTO_SIZES[k % len(AUTO_SIZES)]


# Video tiles in the same grid. 2:1 is the nearest whole-number fit to 16:9;
# the poster is cropped by a sliver top and bottom. When one is played it
# takes the whole row (see .photo.is-playing in the stylesheet).
VIDEO_SPANS = {"s": (4, 2), "m": (6, 3), "l": (8, 4)}

# How many pieces of the Visuals grid show before "Load more". The rest are
# on the page from the start - images are lazy, so they cost nothing until
# shown - but held back until asked for, so the grid stays one screenful of
# choices however long the catalogue gets. shared["visualsPage"] overrides.
VISUALS_PAGE = 24


def visuals_page(shared: dict) -> int:
    try:
        n = int(shared.get("visualsPage", VISUALS_PAGE))
    except (TypeError, ValueError):
        return VISUALS_PAGE
    return n if n > 0 else VISUALS_PAGE


HERO_LOOP_SECONDS = 6


def hero_loop_frames(shared: dict) -> list[str]:
    """The pictures in the hero's handwriting loop, in order.

    `images.inkLoop.frames` is what the admin writes. The older `ink` /
    `inkName` pair is still read when there is no list, so content that has
    not been through the new form renders exactly as it did."""
    images = shared.get("images", {})
    loop = images.get("inkLoop")
    if isinstance(loop, dict) and isinstance(loop.get("frames"), list):
        return [f for f in loop["frames"] if f]
    return [f for f in (images.get("ink"), images.get("inkName")) if f]


def hero_loop_seconds(shared: dict) -> float:
    """How long each frame holds before the next takes over."""
    loop = shared.get("images", {}).get("inkLoop")
    if isinstance(loop, dict):
        try:
            n = float(loop.get("seconds"))
            if n > 0:
                return n
        except (TypeError, ValueError):
            pass
    return HERO_LOOP_SECONDS


def safe_colour(value: str | None) -> str:
    """A colour, or nothing at all.

    This goes into a `style` attribute, so it is matched against a pattern
    rather than escaped: `attr()` would stop it breaking out of the quotes,
    but `red;background:url(...)` would still be a second declaration riding
    in on the first. A hex code or a plain colour word cannot be."""
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if re.fullmatch(r"#[0-9A-Fa-f]{3,8}", value) or re.fullmatch(r"[A-Za-z]{3,20}", value):
        return value
    return ""


def plain(html_text: str) -> str:
    """Authored HTML reduced to text, for alt and aria-label."""
    return re.sub(r"<[^>]+>", "", html_text).replace("&amp;", "&")


def opens_into_lens(item: dict, desc: str) -> bool:
    """Whether a picture opens into the detail view when it is clicked.

    This used to be implicit: a picture opened if it had something to say,
    which meant the two could never be separated. You could not offer a
    closer look at a photograph without writing a paragraph about it, and
    you could not park a note against one without turning it into a button.

    `opens` says so outright. Without it the old rule still applies, so
    nothing that predates the flag changes."""
    if "opens" in item:
        return bool(item["opens"])
    return bool(desc)


def lens_template(tid: str, kicker: str, title: str, desc: str,
                  entry: tuple[list[str], list[str], list[str]] | None = None) -> list[str]:
    """What the detail view shows for one picture. A <template> is inert, so
    none of this is on the page until someone opens it. Blank lines in the
    description split it into paragraphs.

    `entry` is a diary entry's three parts - see entry_parts - placed the
    way the client's mock-ups have them: date and tags above the title, the
    media between the title and the words, "view all" at the very end."""
    top, media, tail = entry or ([], [], [])
    out = [f'<template id="{attr(tid)}">']
    out += ["  " + l for l in top]
    if kicker:
        out.append(f'  <p class="lens__kicker">{kicker}</p>')
    out.append(f'  <h3 class="lens__title">{title}</h3>')
    out += ["  " + l for l in media]
    # A picture can open without carrying any text, so this is guarded:
    # splitting "" yields one empty string and would print a blank paragraph.
    paras = re.split(r"\n\s*\n", desc.replace("\r\n", "\n").strip()) if desc.strip() else []
    for para in paras:
        out.append(f'  <p class="lens__text">{para.strip().replace(chr(10), "<br>")}</p>')
    out += ["  " + l for l in tail]
    out.append("</template>")
    return out


# ---------------------------------------------------------------- entries
#
# A ring picture on In the Making can carry a diary entry: when it opens,
# the card beside it reads like a page of the studio notebook - a date, what
# kind of work it was, which project, the words, and then any mix of further
# photos, videos, audio clips and links. (Client brief, 2026-10: the page
# carries new songs, EPs, demos, recording, arranging, inspiration, behind
# the scenes and pre-release teasers.)
#
# The shape (shared.json, on the ring photo; every key optional):
#
#   "date":  "2026-10-04"
#   "kind":  "recording"        a key of making.kinds in both locales
#   "media": [ {"id": "m1", "type": "image", "src": "img/rings/x.webp"},
#              {"id": "m2", "type": "video", "src": "video/x.mp4", "poster": "img/..."},
#              {"id": "m3", "type": "video", "video": "<id from shared.videos>"},
#              {"id": "m4", "type": "audio", "src": "audio/x.mp3"},
#              {"id": "m5", "type": "link",  "href": "https://..."} ]
#
# The words (en/zh.json, rings.<ring>.photos.<photo>): caption is the title,
# desc the body, `project` the second tag ("全新 EP"), and media.<id>.label
# names a clip or a link.

ENTRY_MEDIA = ("image", "video", "audio", "link")
EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
             "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
GALLERY_SHOWN = 4      # tiles before the last one shown turns into "+N"


def has_entry(photo: dict) -> bool:
    return bool(photo.get("date") or photo.get("kind") or photo.get("media"))


def entry_date(loc: dict, iso: str) -> str:
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", iso or "")
    if not m:
        raise SystemExit(f'ring photo date "{iso}" is not YYYY-MM-DD')
    y, mo, d = int(m[1]), int(m[2]), int(m[3])
    day = f"{mo}月{d}日" if loc["lang"].startswith("zh") else f"{EN_MONTHS[mo - 1]} {d}"
    return (f'<p class="entry__date"><time datetime="{iso}">'
            f'<span class="entry__day">{day}</span><span class="entry__year">{y}</span></time></p>')


def count_word(loc: dict, what: str, n: int) -> str:
    forms = loc["making"]["count"][what]
    return (forms["one"] if n == 1 else forms["other"]).replace("{n}", str(n))


def entry_video(loc: dict, shared: dict, item: dict) -> dict | None:
    """Where a video item plays from, or None when it cannot play on this
    page. A site video follows the site's rule: the Chinese page plays only
    from Bilibili, because YouTube does not load in mainland China, so a
    video with no BV id yet is left out there rather than shown broken."""
    if item.get("src"):
        return {"file": item["src"], "poster": item.get("poster", "")}
    vid = next((v for v in shared["videos"] if v["id"] == item.get("video")), None)
    if vid is None:
        return None
    if loc["videoBackend"] == "bilibili":
        return {"bv": vid["bv"], "poster": vid["poster"]} if vid.get("bv") else None
    return {"yt": vid["yt"], "poster": vid["poster"]}


def entry_parts(loc: dict, shared: dict, photo: dict, words: dict) -> tuple:
    """(above the title, below the title, after the words) for one ring
    picture's entry."""
    p = loc["assetPrefix"]
    mk = loc["making"]
    labels = words.get("media", {})

    # The picture on the ring is the first thing in the gallery, so the
    # reader can always step back to it after looking at the others.
    tiles = [("image", {"src": photo["src"]}, "")]
    audios, links = [], []
    for m in photo.get("media", []):
        label = labels.get(m.get("id", ""), {}).get("label", "")
        kind = m.get("type")
        if kind == "image" and m.get("src"):
            tiles.append(("image", {"src": m["src"]}, label))
        elif kind == "video":
            v = entry_video(loc, shared, m)
            if v:
                tiles.append(("video", v, label))
        elif kind == "audio" and m.get("src"):
            audios.append((m["src"], label))
        elif kind == "link" and m.get("href"):
            # content is printed into the page as written, so a script URL
            # typed into the JSON by hand must not become a live link
            if re.match(r"\s*(javascript|data|vbscript):", m["href"], re.I):
                raise SystemExit(f'ring photo {photo["id"]}: refusing link {m["href"]!r}')
            links.append((m["href"], label))

    n_img = sum(1 for t in tiles if t[0] == "image")
    n_vid = len(tiles) - n_img
    counts = [count_word(loc, "photo", n_img)] if len(tiles) > 1 else []
    if n_vid:
        counts.append(count_word(loc, "video", n_vid))
    if audios:
        counts.append(count_word(loc, "audio", len(audios)))

    meta = []
    if photo.get("kind"):
        kind = mk["kinds"].get(photo["kind"])
        if kind is None:
            raise SystemExit(f'ring photo {photo["id"]}: no making.kinds.{photo["kind"]} in {loc["lang"]}')
        meta.append(f'<span class="entry__kind">{kind}</span>')
    if words.get("project"):
        meta.append(f'<span>{words["project"]}</span>')
    if counts:
        meta.append(f'<span>{" · ".join(counts)}</span>')

    top = []
    if photo.get("date"):
        top.append(entry_date(loc, photo["date"]))
    if meta:
        top.append(f'<p class="entry__meta">{"".join(meta)}</p>')

    after = []
    if len(tiles) > 1:
        extra = len(tiles) - GALLERY_SHOWN
        after.append(f'<div class="entry__gallery" data-count="{len(tiles)}">')
        for i, (kind, src, label) in enumerate(tiles):
            data = f' data-kind="{kind}"'
            if kind == "image":
                data += f' data-src="{attr(p + src["src"])}"'
                thumb = p + src["src"]
            else:
                for key in ("file", "yt", "bv"):
                    if src.get(key):
                        val = p + src[key] if key == "file" else src[key]
                        data += f' data-{key}="{attr(val)}"'
                thumb = p + src["poster"] if src.get("poster") else ""
            name = plain(label) or (mk["playVideo"] if kind == "video" else mk["showPhoto"])
            cls = "entry__tile" + (" is-current" if i == 0 else "")
            if extra > 0 and i >= GALLERY_SHOWN:
                cls += " is-extra"
            more = (f'<span class="entry__more" aria-hidden="true">+{extra + 1}</span>'
                    if extra > 0 and i == GALLERY_SHOWN - 1 else "")
            img = f'<img src="{attr(thumb)}" alt="" loading="lazy">' if thumb else ""
            play = f'<span class="entry__play" aria-hidden="true">{PLAY_SVG}</span>' if kind == "video" else ""
            after.append(f'  <button class="{cls}" type="button"{data} aria-label="{attr(name)}">'
                         f'{img}{play}{more}</button>')
        after.append("</div>")
    tail = []
    if len(tiles) > GALLERY_SHOWN:
        tail.append(f'<button class="entry__all" type="button">'
                     f'{mk["viewAll"].replace("{n}", str(len(tiles)))}'
                     f'<span aria-hidden="true"> &rarr;</span></button>')
    for src, label in audios:
        name = f'{mk["playAudio"]}: {plain(label)}' if label else mk["playAudio"]
        after += [
            f'<div class="entry__audio" data-audio="{attr(p + src)}">',
            f'  <button class="entry__audio-btn" type="button" aria-label="{attr(name)}">{PLAY_SVG}</button>',
            '  <div class="entry__audio-body">',
        ]
        if label:
            after.append(f'    <span class="entry__audio-name">{label}</span>')
        after += [
            '    <span class="entry__audio-bar"><span class="entry__audio-fill"></span></span>',
            '    <span class="entry__audio-time">0:00</span>',
            "  </div>",
            "</div>",
        ]
    if links:
        after.append('<ul class="entry__links">')
        for href, label in links:
            after.append(f'  <li><a href="{attr(href)}" target="_blank" rel="noopener">'
                         f'{label or attr(href)}<span aria-hidden="true"> &#8599;</span></a></li>')
        after.append("</ul>")
    return top, after, tail


def render_lens(loc: dict) -> list[str]:
    """The one detail view a page shares. main.js fills it from a template
    and animates the picture into it."""
    return [
        "<!-- detail view for pictures that carry a description (Lens in main.js) -->",
        f'<dialog class="lens" id="lens" aria-label="{attr(loc["lens"]["open"])}">',
        '  <div class="lens__veil"></div>',
        '  <div class="lens__card">',
        '    <div class="lens__media"><img class="lens__img" alt="">',
        # stepping through a gallery; main.js shows these only when there is one
        f'      <button class="lens__step lens__step--prev" type="button" hidden'
        f' aria-label="{attr(loc["lens"].get("prev", "Previous"))}">{ARROW_PREV}</button>',
        f'      <button class="lens__step lens__step--next" type="button" hidden'
        f' aria-label="{attr(loc["lens"].get("next", "Next"))}">{ARROW_NEXT}</button>',
        '      <span class="lens__count" hidden></span>',
        "    </div>",
        '    <div class="lens__body"></div>',
        f'    <button class="lens__close" type="button" aria-label="{attr(loc["lens"]["close"])}">&times;</button>',
        "  </div>",
        "</dialog>",
    ]


def plays_here(loc: dict | None, v: dict) -> bool:
    """Whether a grid video has somewhere to play from on this page.

    The Chinese page plays only from Bilibili, because YouTube does not load
    in mainland China. A grid tile with no BV id yet used to stay on that
    page as a poster flagged "coming soon" - thirteen of them, a whole grid
    of things that could not be played. They are left out instead, the same
    rule diary entries follow, and each comes back by itself once its BV id
    is filled in. The title video keeps its tile and its flag, which points
    to YouTube for anyone who can reach it."""
    if loc is None or loc.get("videoBackend") != "bilibili":
        return True
    return bool(v.get("bv"))


def visuals_order(shared: dict, loc: dict | None = None) -> list[tuple[str, dict]]:
    """Every photo and grid video, in shared["visualsOrder"] order. Anything
    the order does not mention is added at the end, so a newly added photo
    or video still shows up; a reference to something deleted is skipped.
    Given a locale, videos that cannot play on that page are dropped."""
    photos = {ph["id"]: ph for ph in shared.get("photos", [])}
    videos = {v["id"]: v for v in shared["videos"] if not v.get("feature") and plays_here(loc, v)}
    seen, out = set(), []
    for ref in shared.get("visualsOrder", []):
        kind, _, key = ref.partition(":")
        pool = photos if kind == "photo" else videos if kind == "video" else {}
        if key in pool and ref not in seen:
            seen.add(ref)
            out.append((kind, pool[key]))
    out += [("photo", ph) for k, ph in photos.items() if f"photo:{k}" not in seen]
    out += [("video", v) for k, v in videos.items() if f"video:{k}" not in seen]
    return out


def render_visuals_filter(loc: dict, shared: dict) -> list[str]:
    """The All / Photos / Videos switch beside the Visuals heading.

    Three plain buttons rather than a <select>: there are only ever three
    states. With JS off the group is hidden by the stylesheet (it only
    appears under `html.js`), because nothing would answer a click.

    The counts are still worked out here, but only to decide whether the
    switch is worth showing at all - they are deliberately not printed."""
    f = loc.get("visualsFilter")
    if not f:
        return []
    counts = {"photo": 0, "video": 0}
    for kind, _ in visuals_order(shared, loc):
        counts[kind] = counts.get(kind, 0) + 1
    counts["all"] = counts["photo"] + counts["video"]
    # with nothing to separate - only photos, or only videos - the switch
    # would be three buttons that all show the same grid
    if not (counts["photo"] and counts["video"]):
        return []
    out = [
        f'<div class="vfilter" role="group" aria-label="{attr(f["label"])}">',
    ]
    for key, which in (("all", "all"), ("photos", "photo"), ("videos", "video")):
        on = "true" if which == "all" else "false"
        out += [
            f'  <button class="vfilter__btn" type="button" data-filter="{which}"'
            f' aria-pressed="{on}">{f[key]}</button>',
        ]
    out.append("</div>")
    return out


def render_visuals_grid(loc: dict, shared: dict) -> list[str]:
    """Visuals: photos and videos together in one packed grid, under the
    title video. Photos can open into the detail view; videos play in place.

    Each cell carries `data-kind` so the filter can pick it out, and
    `data-ar` - the shape's own width-over-height - so the packer in
    main.js can re-cut the spans for whatever subset is showing without
    having to know anything about PHOTO_SPANS. Every tile is
    `object-fit:cover`, so a re-cut span changes the crop and never the
    proportions of what is in the picture."""
    p = loc["assetPrefix"]
    tags = loc["photoTags"]
    out = [
        "",
        '  <div class="gallery-wrap">',
        '    <div class="gallery">',
    ]
    page = visuals_page(shared)
    pieces = visuals_order(shared, loc)
    for n, (kind, ph) in enumerate(pieces):
        # past the first page: hidden by the stylesheet only once JS is
        # running, so with JS off the whole grid is simply there
        later = " data-later" if n >= page else ""
        if kind == "video":
            cols, rows = VIDEO_SPANS[ph.get("size", "s")]
            out.append(
                f'      <div class="photo photo--video reveal" data-kind="video"{later}'
                f' data-ar="{cols / rows:.4f}" style="--c:{cols};--r:{rows}">'
            )
            # the tile's own reveal would double up with its cell's
            out += [l.replace('class="vid reveal"', 'class="vid"') for l in render_video_tile(loc, ph, 8, False)]
            out.append("      </div>")
            continue
        c = loc["photos"].get(ph["id"], {})
        cols, rows = PHOTO_SPANS.get(ph.get("shape"), PHOTO_SPANS["square"])[photo_size(shared, ph)]
        caption = c.get("caption", "")
        tag = tags.get(ph.get("tag", ""), "")
        desc = c.get("desc", "").strip()
        # An album: one tile, several pictures. It opens into the same
        # gallery a diary entry uses - the tile's own picture first - so
        # stepping, swiping and "+N" all come from one place (entry_parts).
        album = [a for a in ph.get("album", []) if a.get("src")]
        later += f' data-album="{len(album) + 1}"' if album else ""
        out += [
            f'      <figure class="photo reveal" data-kind="photo"{later}'
            f' data-ar="{cols / rows:.4f}" style="--c:{cols};--r:{rows}">',
            f'        <img src="{p}{ph["src"]}" alt="{attr(plain(caption))}" loading="lazy" decoding="async">',
            '        <figcaption class="photo__cap">',
        ]
        if tag:
            out.append(f'          <span class="photo__tag">{tag}</span>')
        out += [f'          <span class="photo__title">{caption}</span>', "        </figcaption>"]
        if album or opens_into_lens(ph, desc):
            tid = f'lens-{ph["id"]}'
            label = f'{loc["lens"]["open"]}: {plain(caption)}'
            if album:
                label += f' ({count_word(loc, "photo", len(album) + 1)})'
            badge = (f'<span class="photo__badge photo__badge--album" aria-hidden="true">'
                     f'{ALBUM_SVG}{len(album) + 1}</span>' if album
                     else '<span class="photo__badge" aria-hidden="true">+</span>')
            out += [
                f'        <button class="photo__open" type="button" data-lens="{attr(tid)}"'
                f' aria-haspopup="dialog" aria-label="{attr(label)}">',
                f'          {badge}',
                "        </button>",
            ]
            entry = None
            if album:
                media = [{"id": a.get("id", f"a{i}"), "type": "image", "src": a["src"]}
                         for i, a in enumerate(album, 1)]
                entry = entry_parts(loc, shared, {"id": ph["id"], "src": ph["src"], "media": media}, {})
            out += ["        " + l for l in lens_template(tid, tag, caption, desc, entry)]
        out.append("      </figure>")
    out += ["    </div>"]
    if len(pieces) > page:
        out += [
            f'    <p class="more" data-page="{page}">',
            f'      <button class="more__btn" type="button">{loc.get("loadMore", "Load more")}</button>',
            "    </p>",
        ]
    out += ["  </div>"]
    return out


def section_cta(href: str, label: str) -> list[str]:
    return ["", '  <p class="section__cta reveal">', f'    <a href="{attr(href)}">{label}</a>', "  </p>"]


def render_music(loc: dict, shared: dict, full: bool = False) -> list[str]:
    p = loc["assetPrefix"]
    lead = " section--lead" if full else ""
    head = section_head(loc, "music", None if full else "music.html")
    out = [
        "<!-- ================= 01 MUSIC ================= -->",
        f'<section class="section{lead}" id="music">',
    ]

    # Both pages show the same three cards - two albums and the singles. The
    # music page adds the catalogue figures, set beside the heading rather
    # than under it: two tiles run the full width read as an empty band.
    releases = shared["releases"]
    if full:
        out += ['  <div class="section__lede">']
        out += ["  " + l for l in head]
        out += [""]
        out += ["  " + l for l in render_stats_strip(loc)]
        out += ["  </div>"]
    else:
        out += head

    out += ["", '  <div class="cards">']

    for i, rel in enumerate(releases):
        c = loc["releases"][rel["id"]]
        if i:
            out.append("")
        out += [
            '    <article class="card reveal" data-tilt>',
            '      <div class="card__art">',
        ]
        # The record sits behind the sleeve and slides out on hover. It is
        # drawn entirely in CSS and inline SVG - no extra request, which
        # matters on a site that has to render inside the GFW.
        out += render_disc(rel, c, full)
        out += [
            # the sleeve carries its own clipping so the disc can escape .card__art
            '        <span class="card__sleeve">',
            # versioned like the stylesheet: replacing a cover keeps the
            # same path, so without the hash a browser serves the old one
            f'          <img src="{asset(rel["art"], p)}" alt="{attr(c["alt"])}" loading="lazy">',
            "        </span>",
        ]
        tags = release_tags(rel, c)
        if tags:
            out.append('        <span class="card__tags">')
            out += [f'          <span class="card__badge">{t}</span>' for t in tags]
            out.append("        </span>")
        out += [
            "      </div>",
            '      <div class="card__body">',
            f'        <h3 class="card__title"{lang_attr(c.get("titleLang"))}>{c["title"]}</h3>',
            # who put the record out is detail for the music page; the
            # homepage says what it is and when, and stops there
            f'        <p class="card__meta">{c["meta"]}'
            + (f' &middot; {c["label"]}' if full and c.get("label") else "")
            + "</p>",
        ]

        # The singles are paged a year at a time. Eleven titles at once
        # made this card far taller than the two album cards beside it; a
        # year holds three at most, so the row stays even - and stepping
        # back through 2021 is the clearest way to show the run is unbroken.
        if full and c.get("singlesByYear"):
            out += render_singles_years(loc, c)
        # An album's prose belongs on the page that is about the records.
        # The homepage cards are a cover, a line of billing and a way in.
        elif full and c.get("copy"):
            out.append(
                f'        <p class="card__copy"{lang_attr(c.get("copyLang"))}>{c["copy"]}</p>'
            )
        # the singles card has no prose of its own: on the homepage it is a
        # cover, a date range and a way through to the list on the music page

        # The disc's ring is decoration - it sits inside an aria-hidden span
        # and is drawn, not written. An album's running order is real content
        # even so, so the music page states it once in text a screen reader
        # can read and Baidu can index. Only there: repeating it on the
        # homepage would be the same list on two URLs.
        if full and c.get("discTracks"):
            out.append(f'        <ol class="sr-only">')
            for name in c["discTracks"]:
                out.append(f"          <li>{name}</li>")
            out.append("        </ol>")

        out.append('        <div class="card__links">')
        out += render_links(c["links"], 10)
        out += ["        </div>", "      </div>", "    </article>"]

    out.append("  </div>")

    # every listening link the content has, gathered on the page that is
    # about listening, and looping rather than sitting in a row
    if full:
        out += [""] + render_playlist_rail(loc)
    # The homepage ends the releases on what is coming rather than what is
    # done, and hands over to In the Making. The music page does not: it is
    # the catalogue, and a teaser there would interrupt the listening links.
    else:
        out += section_cta(PAGE_FILE["press"], loc["comingSoon"])

    out.append("</section>")
    return out


def release_tags(rel: dict, c: dict) -> list[str]:
    """The little labels over a sleeve — "New", and whatever else is worth
    flagging on a record.

    There used to be exactly one of these, a boolean in shared.json gated
    against a label in each locale. It is a list per locale now, because a
    record can be both new and, say, a single; the old pair is still read
    when there is no list, so content that has not been through the new form
    keeps its badge."""
    tags = c.get("tags")
    if isinstance(tags, list):
        return [t for t in tags if t]
    if rel.get("badge") and c.get("badge"):
        return [c["badge"]]
    return []


def render_video_tile(loc: dict, shared_v: dict, pad: int, feature: bool) -> list[str]:
    p = loc["assetPrefix"]
    v = loc["videos"][shared_v["id"]]
    bilibili = loc["videoBackend"] == "bilibili"
    pending = bilibili and not shared_v.get("bv")

    cls = "vid vid--feature reveal" if feature else "vid reveal"
    data = ""
    if bilibili:
        data += f' data-bv="{attr(shared_v.get("bv", ""))}"'
    data += f' data-yt="{attr(shared_v["yt"])}"'
    href = f'https://youtu.be/{shared_v["yt"]}'

    s = " " * pad
    if feature:
        out = [
            f'{s}<a class="{cls}"{data}',
            f'{s}   href="{href}" target="_blank" rel="noopener">',
        ]
    else:
        out = [f'{s}<a class="{cls}"{data} href="{href}" target="_blank" rel="noopener">']

    out += [
        f'{s}  <span class="vid__frame">',
        f'{s}    <img class="vid__thumb" src="{p}{shared_v["poster"]}" alt="" loading="lazy">',
        f'{s}    <span class="vid__play" aria-hidden="true">{PLAY_SVG}</span>',
    ]
    if pending and loc.get("videoFlag"):
        flag = loc["videoFlag"]["feature"] if feature else loc["videoFlag"]["default"]
        out.append(f'{s}    <span class="vid__flag">{flag}</span>')
    out.append(f'{s}  </span>')

    # Each line of the caption is optional, and a caption with nothing in it
    # is left out altogether rather than rendered as an empty box - which is
    # what used to leave a band of dead space under the feature video.
    meta = []
    if v.get("kicker"):
        meta.append(f'{s}    <span class="vid__kicker">{v["kicker"]}</span>')
    if v.get("title"):
        meta.append(f'{s}    <span class="vid__title"{lang_attr(v.get("titleLang"))}>{v["title"]}</span>')
    if v.get("sub"):
        meta.append(f'{s}    <span class="vid__sub">{v["sub"]}</span>')
    if meta:
        out += [f'{s}  <span class="vid__meta">'] + meta + [f'{s}  </span>']

    out.append(f'{s}</a>')
    return out


def render_videos(loc: dict, shared: dict, full: bool = False) -> list[str]:
    lead = " section--lead" if full else ""
    alt = "" if full else " section--alt"
    # the filter belongs to the grid, and the grid is only on the Visuals page
    aside = render_visuals_filter(loc, shared) if full and shared.get("photos") else None
    out = [
        "<!-- ================= 02 VIDEOS ================= -->",
        f'<section class="section{alt}{lead}" id="videos">',
    ] + section_head(loc, "videos", None if full else PAGE_FILE["videos"], aside or None)

    if loc.get("notice") and full:
        n = loc["notice"]
        out += [
            "",
            '  <div class="notice reveal">',
            f'    <p class="notice__title">{n["title"]}</p>',
            f'    <p>{n["body"]}</p>',
            "  </div>",
        ]

    out += [
        "",
        "  <!-- data-yt (or data-bv) drives the click-to-load embed in js/main.js.",
        "       Each tile is a real link first, so with JS off it still reaches the",
        "       video. Posters are self-hosted rather than pulled from i.ytimg.com,",
        "       which is blocked in mainland China. -->",
    ]

    feature = [v for v in shared["videos"] if v.get("feature")]
    grid = [v for v in shared["videos"] if not v.get("feature") and plays_here(loc, v)]

    # The homepage leads with one thing under this heading: the title video,
    # or a picture instead when there is no new video worth leading with.
    # Same box either way - 16:9, full width of the section - so choosing one
    # over the other never changes the shape of the page.
    home_pic = None if full else shared.get("images", {}).get("homeVisual")
    if home_pic:
        out += [
            "",
            '  <figure class="lead-pic reveal">',
            f'    <img src="{asset(home_pic, loc["assetPrefix"])}"'
            f' alt="{attr(loc.get("homeVisualAlt", ""))}" loading="lazy" decoding="async">',
            "  </figure>",
        ]
    else:
        for v in feature:
            out += render_video_tile(loc, v, 2, True)

    # An optional picture under the title video, the same width as it. It is
    # a sibling of the tile rather than anything cleverer, so it picks up the
    # section's own padding and lines up with the video and the grid without
    # having to be told the measurements.
    banner = shared.get("images", {}).get("visualsBanner")
    if full and banner:
        out += [
            "",
            '  <figure class="banner reveal">',
            f'    <img src="{asset(banner, loc["assetPrefix"])}"'
            f' alt="{attr(loc.get("visualsBannerAlt", ""))}" loading="lazy" decoding="async">',
            "  </figure>",
        ]

    # The homepage shows the title track and nothing else; the rest of the
    # catalogue lives on the Visuals page.
    if not full:
        out += section_cta(PAGE_FILE["videos"], loc["sections"]["videos"]["more"])
        out.append("</section>")
        return out

    # Photos and the rest of the videos share one grid under the title video.
    # Without any photos it is the plain video grid it used to be.
    if shared.get("photos"):
        out += render_visuals_grid(loc, shared)
    else:
        out += ["", '  <div class="vids">']
        for i, v in enumerate(grid):
            if i:
                out.append("")
            out += render_video_tile(loc, v, 4, False)
        out.append("  </div>")

    out += ["", '  <div class="playlists reveal">']
    out += render_links(loc["playlists"], 4)
    out += ["  </div>", "</section>"]
    return out


def render_about(loc: dict, shared: dict, full: bool = False) -> list[str]:
    p = loc["assetPrefix"]
    a = loc["about"]
    img = shared["images"]
    lead = " section--lead" if full else ""
    shape = "about--full" if full else "about--brief"
    # one photograph either way, stretched in CSS to start and finish exactly
    # where the column of text does
    photo, alt_key = (img["aboutTop"], "altTop") if full else (img["aboutBottom"], "altBottom")

    out = [
        "<!-- ================= 03 ABOUT ================= -->",
        f'<section class="section{lead}" id="about">',
    ] + section_head(loc, "about", None if full else "about.html") + [
        "",
        f'  <div class="about {shape}">',
        '    <div class="about__media">',
        '      <figure class="about__shot reveal">',
        f'        <img src="{p}{photo}" alt="{attr(a[alt_key])}" loading="lazy">',
        "      </figure>",
        "    </div>",
        "",
        '    <div class="about__prose">',
    ]

    if not full:
        # Homepage: the line he leads with, then the bare facts.
        out += [
            '      <blockquote class="quote reveal">',
            f'        <p>{a["quote"]}</p>',
            "      </blockquote>",
            "",
        ]
        out += [
            f'      <h3 class="about__sub reveal">{a["profileHeading"]}</h3>',
            '      <dl class="facts reveal">',
        ]
        for fact in a["facts"]:
            out.append(f'        <div><dt>{fact["term"]}</dt><dd>{fact["value"]}</dd></div>')
        out += ["      </dl>", "    </div>", "  </div>", "</section>"]
        return out

    # About page: the long copy.
    for para in a["prose"]:
        out.append(f'      <p class="reveal">{para}</p>')
        out.append("")
    out += [
        '      <blockquote class="quote reveal">',
        f'        <p>{a["quote"]}</p>',
        "      </blockquote>",
        "",
    ]
    for para in a["proseAfterQuote"]:
        out.append(f'      <p class="reveal">{para}</p>')
        out.append("")
    out += ["    </div>", "  </div>", "</section>"]
    return out


def latest_milestones(shared: dict, limit: int) -> list[dict]:
    """The most recent entries, newest first, still grouped under their years.

    The homepage used to take the last three *years*, which meant the block
    was however tall those years happened to be - three entries one year and
    a dozen the next. Counting entries instead keeps it the same size
    whatever the timeline does.

    "Most recent" is simply reading order: newest year first, and within a
    year the order the admin put them in, which is the order the full
    timeline shows them in."""
    out: list[dict] = []
    left = limit
    for row in reversed(shared["milestones"]):
        if left <= 0:
            break
        taken = row["items"][:left]
        if not taken:
            continue
        # a copy, so trimming the homepage never touches the real timeline
        out.append({**row, "items": taken})
        left -= len(taken)
    return out


def render_milestones(loc: dict, shared: dict, full: bool = False) -> list[str]:
    # newest first either way: the whole run on the about page, the last three
    # fading out on the homepage
    rows = list(reversed(shared["milestones"])) if full else latest_milestones(shared, 6)
    out = [
        "<!-- ================= 04 MILESTONES ================= -->",
        '<section class="section section--alt" id="milestones">',
    ] + section_head(loc, "milestones", None if full else "about.html#milestones") + [
        "", f'  <ol class="tl{"" if full else " tl--brief"}">'
    ]

    for i, row in enumerate(rows):
        if i:
            out.append("")
        year_cls = "tl__year tl__year--now" if row.get("current") else "tl__year"
        # A year can be given its own colour in the admin; the class stays on
        # either way, so clearing the colour falls straight back to it.
        tint = safe_colour(row.get("color"))
        style = f' style="color:{tint}"' if tint else ""
        out += [
            '    <li class="tl__row reveal">',
            f'      <h3 class="{year_cls}"{style}>{row["year"]}</h3>',
            '      <ul class="tl__list">',
        ]
        for item_id in row["items"]:
            out.append(f'        <li>{loc["milestones"][item_id]}</li>')
        out += ["      </ul>", "    </li>"]

    out.append("  </ol>")
    if not full:
        out += section_cta("about.html#milestones", loc["sections"]["milestones"]["more"])
    out.append("</section>")
    return out


# What a ring uses when the content does not say. These are the same three
# values styles.css declares on .orbit; they are repeated here so that a
# ring nobody has adjusted emits no inline style at all, and content/ only
# carries the angles somebody actually chose.
ORBIT_DEFAULTS = {"tilt": 26, "lean": -20, "dir": 1}


def orbit_style(cfg: dict, where: str) -> str:
    """The inline `style` for one ring's geometry, or "" for a ring left alone.

    `tilt` turns the ring's long axis away from horizontal, `lean` tips it
    towards the reader - between them they are the ellipse the photos travel
    round - and `dir` is which way scrolling turns it. The stylesheet does
    the work; this only hands it three numbers.

    A bad value stops the build rather than reaching the page as a broken
    `calc()`, which would collapse the whole ring into a heap at the centre
    and give no clue why.
    """
    parts = []
    for key in ("tilt", "lean"):
        if key not in cfg:
            continue
        val = cfg[key]
        if isinstance(val, bool) or not isinstance(val, (int, float)) or not -90 <= val <= 90:
            raise SystemExit(f"{where}.{key}: {val!r} is not a number of degrees between -90 and 90")
        if val != ORBIT_DEFAULTS[key]:
            parts.append(f"--{key}:{val:g}deg")
    if "dir" in cfg:
        # `is True` would read as 1 and pass silently, which is not what
        # someone typing `"dir": true` into the raw JSON means to say
        if isinstance(cfg["dir"], bool) or cfg["dir"] not in (1, -1):
            raise SystemExit(f"{where}.dir: {cfg['dir']!r} is not 1 (clockwise) or -1 (anticlockwise)")
        if cfg["dir"] != ORBIT_DEFAULTS["dir"]:
            parts.append("--dir:-1")
    return f' style="{";".join(parts)}"' if parts else ""


# `--n` on .orbit__scene is simply how many pictures the ring has, and each
# card carries its own `--i`; the stylesheet turns the pair into
# `--i * 360deg / --n`. So the spacing is a division, not a stored angle -
# take a picture out or add one and the rest are evenly spaced again on the
# next build, with nothing to tidy up. ringFigure in admin/preview.js does
# the same division, so both previews agree.
def orbit_nav(loc: dict, pad: int) -> list[str]:
    """Up and down arrows at the side of the screen while a ring is pinned:
    each press scrolls to the start of the ring above or below this one.
    Orbit in main.js shows them and does the scrolling; with no script the
    ring is not pinned and they stay hidden.

    The labels are for screen readers only - the buttons themselves are
    chevrons - which is why `orbitNav` is two words and no heading."""
    nav = loc.get("orbitNav")
    if not nav:
        return []
    s = " " * pad
    up = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15l7-7 7 7"/></svg>'
    down = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9l7 7 7-7"/></svg>'
    return [
        f'{s}<div class="orbit-nav" data-orbit-nav hidden>',
        f'{s}  <button class="orbit-nav__btn" type="button" data-orbit-step="-1" aria-label="{attr(nav["prev"])}">{up}</button>',
        f'{s}  <button class="orbit-nav__btn" type="button" data-orbit-step="1" aria-label="{attr(nav["next"])}">{down}</button>',
        f'{s}</div>',
    ]


def ring_centre(loc: dict, shared: dict, ring: dict, words: dict) -> tuple:
    """A ring's middle, as (src, alt).

    Either a release - whose cover and alt text the rest of the site already
    shows, so the ring circles something the reader has seen - or a picture
    of its own with its own alt text. A ring can have neither, and then it
    turns around a hole, which is a legitimate thing to want and is what a
    ring looks like the moment it is added.
    """
    centre = ring.get("centre") or {}
    if centre.get("release"):
        rid = centre["release"]
        rel = next((r for r in shared["releases"] if r["id"] == rid), None)
        if rel is None:
            raise SystemExit(f'rings[{ring["id"]}].centre.release: no release named {rid}')
        return rel["art"], loc["releases"].get(rid, {}).get("alt", "")
    if centre.get("src"):
        return centre["src"], words.get("centreAlt", "")
    return None, ""


def render_ring(loc: dict, shared: dict, ring: dict) -> list[str]:
    """One ring of pictures turning round a still centre.

    Plain CSS 3D, driven by `Orbit` in main.js: the script only writes how
    far through the block the reader is, and the stylesheet places every card
    from that. The cards are real <img>s laid out at rest, so with JS off (or
    with reduced motion) this is a still ring rather than an empty tall box.

    Every ring on the page is this one function. There used to be two, one
    per ring, which is why a picture could open into the detail view on the
    first ring and not on the second - a difference that lived in the code
    and meant nothing on the page. A ring is content now (shared.json ->
    rings), so there can be any number of them, they can be reordered, and
    every picture on every one of them is the same kind of thing.

    `--n` is simply how many pictures the ring has and each card carries its
    own `--i`; the stylesheet turns the pair into `--i * 360deg / --n`. The
    spacing is a division, not a stored angle, so adding or removing a
    picture leaves the rest evenly spaced with nothing to tidy up.
    """
    p = loc["assetPrefix"]
    words = loc.get("rings", {}).get(ring["id"], {})
    captions = words.get("photos", {})
    photos = ring.get("photos", [])

    out = [
        f'  <div class="orbit" data-orbit{orbit_style(ring, "rings." + ring["id"])}>',
        '    <div class="orbit__stage">',
        f'      <div class="orbit__scene" style="--n:{len(photos)}">',
    ]
    src, alt = ring_centre(loc, shared, ring, words)
    if src:
        out.append(f'        <img class="orbit__centre" src="{p}{src}" alt="{attr(alt)}">')

    templates = []
    for i, photo in enumerate(photos):
        c = captions.get(photo["id"], {})
        desc = c.get("desc", "").strip()
        caption = c.get("caption", "")
        img = f'{p}{photo["src"]}'
        # A picture carrying an entry opens, since there is something to
        # show - unless the admin's "opens" box was unticked on purpose.
        entry = has_entry(photo)
        opens = bool(photo["opens"]) if "opens" in photo else (entry or bool(desc))
        if opens:
            tid = f'lens-{photo["id"]}'
            label = f'{loc["lens"]["open"]}: {plain(caption)}'
            out.append(
                f'        <img class="orbit__card" style="--i:{i}" src="{img}" alt="{attr(label)}"'
                f' role="button" tabindex="0" aria-haspopup="dialog" data-lens="{attr(tid)}" decoding="async">'
            )
            parts = entry_parts(loc, shared, photo, c) if entry else None
            templates += lens_template(tid, "", caption, desc, parts)
        else:
            out.append(
                f'        <img class="orbit__card" style="--i:{i}" src="{img}"'
                ' alt="" aria-hidden="true" decoding="async">'
            )

    # Outside the stage on purpose: the stage carries a perspective, which
    # would make it the box a position:fixed child is pinned to.
    out += [
        "      </div>",
        "    </div>",
        f'    <a class="to-top" href="#top" data-to-top>&uarr;&#160;{loc["footer"]["backToTop"]}</a>',
    ]
    out += orbit_nav(loc, 4)
    out += ["    " + l for l in templates]
    out.append("  </div>")
    return out


def render_making(loc: dict, shared: dict) -> list[str]:
    """Section 05, "In the Making" - the heading and then the rings.

    The file is `inthemaking.html`, but the content key and the `#press`
    anchor keep their old names, so existing links to #press still land
    somewhere sensible. The coverage this section used to carry now closes
    the About page (`render_press`); `render_press_rail` and `PressStage`
    are unused.

    There is no fixed number of rings: the section is whatever `rings` in
    shared.json holds, in that order.
    """
    out = [
        "<!-- ================= 05 IN THE MAKING ================= -->",
        '<section class="section section--lead" id="press">',
    ] + section_head(loc, "press") + [""]
    for ring in shared.get("rings", []):
        # A ring with no pictures is not a ring: once the script runs it is
        # three screens of nothing to scroll past, and the arrows would count
        # it as somewhere to go. One gets added empty and filled in, so this
        # is the state it is in for as long as that takes.
        if not ring.get("photos"):
            continue
        out += render_ring(loc, shared, ring) + [""]
    if out[-1] == "":
        out.pop()
    out.append("</section>")
    out += render_journal_list(loc, shared)
    return out


# ---------------------------------------------------------------- journal
#
# The making-of journal (client issue 5): posts with a title, a date and a
# cover, and a body built from blocks that can be put in any order. The list
# sits under the rings on In the Making, newest first by default, and each
# post is a page of its own - journal-<id>.html - so a post can be linked to,
# shared on WeChat, and found by a search engine, which a pop-up could not.
#
# The shape (shared.json; `hidden` takes a post off the site without
# deleting it - the admin calls it unpublishing):
#
#   "journal": [ {"id": "temple-week-one", "date": "2026-10-04",
#                 "kind": "recording", "cover": "img/journal/x.webp",
#                 "hidden": false,
#                 "blocks": [ {"id": "b1", "type": "text"},
#                             {"id": "b2", "type": "image", "src": "img/..."},
#                             {"id": "b3", "type": "gallery", "images": [{"src": "..."}]},
#                             {"id": "b4", "type": "video", "video": "<shared.videos id>"},
#                             {"id": "b5", "type": "video", "src": "video/x.mp4", "poster": "img/..."} ]} ]
#
# The words (en/zh.json, journal.posts.<id>): title, excerpt (optional - the
# first text block stands in), and blocks.<block id>.text / .caption.
# A post is on a language's page only once it has a title in that language,
# so one written in Chinese first simply is not on the English page yet.

JOURNAL_PAGE = 6              # posts in the list before "Load more"
JOURNAL_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,60}")


def journal_posts(shared: dict) -> list[dict]:
    """The posts that are on the site, in the order the admin has them."""
    out = []
    for post in shared.get("journal", []):
        if post.get("hidden"):
            continue
        if not JOURNAL_ID.fullmatch(post.get("id", "")):
            raise SystemExit(f'journal post id {post.get("id")!r} must be lowercase letters, digits and dashes')
        out.append(post)
    return out


def journal_file(post: dict) -> str:
    return f'journal-{post["id"]}.html'


def journal_words(loc: dict, post: dict) -> dict:
    return loc.get("journal", {}).get("posts", {}).get(post["id"], {})


def journal_excerpt(loc: dict, post: dict, words: dict) -> str:
    if words.get("excerpt"):
        return words["excerpt"]
    for b in post.get("blocks", []):
        if b.get("type") == "text":
            text = re.sub(r"\s+", " ", plain(words.get("blocks", {}).get(b.get("id", ""), {}).get("text", ""))).strip()
            if text:
                # Chinese runs about twice as dense as English
                cut = 70 if loc["lang"].startswith("zh") else 150
                if len(text) <= cut:
                    return text
                short = text[:cut]
                if " " in short and not loc["lang"].startswith("zh"):
                    short = short[: short.rfind(" ")]
                return short.rstrip(" ,.;:，。；：") + "…"
    return ""


def journal_cover(post: dict) -> str:
    """The post's cover, or else its first picture, or nothing."""
    if post.get("cover"):
        return post["cover"]
    for b in post.get("blocks", []):
        if b.get("type") == "image" and b.get("src"):
            return b["src"]
        if b.get("type") == "gallery" and b.get("images"):
            return b["images"][0]["src"]
    return ""


def journal_meta(loc: dict, post: dict) -> list[str]:
    """Date and kind, the same as a diary entry's top line."""
    out = []
    if post.get("date"):
        out.append(entry_date(loc, post["date"]))
    if post.get("kind"):
        kind = loc["making"]["kinds"].get(post["kind"])
        if kind:
            out.append(f'<p class="entry__meta"><span class="entry__kind">{kind}</span></p>')
    return out


def render_journal_list(loc: dict, shared: dict) -> list[str]:
    posts = [x for x in journal_posts(shared) if journal_words(loc, x).get("title")]
    if not posts or not loc.get("journal"):
        return []
    p = loc["assetPrefix"]
    j = loc["journal"]
    out = [
        "",
        "<!-- the making-of journal: each card is a link to the post's own page -->",
        '<section class="section journal" id="journal">',
    ] + section_head(loc, "journal") + [
        "",
        '  <div class="journal__list" data-paged>',
    ]
    for n, post in enumerate(posts):
        words = journal_words(loc, post)
        later = " data-later" if n >= JOURNAL_PAGE else ""
        cover = journal_cover(post)
        pic = (f'<img src="{p}{attr(cover)}" alt="" loading="lazy" decoding="async">' if cover
               else '<span class="jcard__blank" aria-hidden="true"></span>')
        excerpt = journal_excerpt(loc, post, words)
        out += [
            f'    <a class="jcard reveal" href="{journal_file(post)}"{later}>',
            f'      <span class="jcard__pic">{pic}</span>',
            '      <span class="jcard__body">',
        ]
        out += ["        " + l.replace("<p ", "<span ").replace("</p>", "</span>") for l in journal_meta(loc, post)]
        out.append(f'        <span class="jcard__title">{words["title"]}</span>')
        if excerpt:
            out.append(f'        <span class="jcard__excerpt">{excerpt}</span>')
        out += [
            f'        <span class="jcard__read">{j["read"]}<span aria-hidden="true"> &rarr;</span></span>',
            "      </span>",
            "    </a>",
        ]
    out.append("  </div>")
    if len(posts) > JOURNAL_PAGE:
        out += [
            f'  <p class="more" data-page="{JOURNAL_PAGE}">',
            f'    <button class="more__btn" type="button">{loc.get("loadMore", "Load more")}</button>',
            "  </p>",
        ]
    out.append("</section>")
    return out


def render_journal_block(loc: dict, shared: dict, block: dict, words: dict) -> list[str]:
    p = loc["assetPrefix"]
    w = words.get("blocks", {}).get(block.get("id", ""), {})
    kind = block.get("type")
    cap = (f'    <figcaption>{w["caption"]}</figcaption>' if w.get("caption") else None)
    if kind == "text":
        text = w.get("text", "").replace("\r\n", "\n").strip()
        if not text:
            return []
        return [f'  <p>{para.strip().replace(chr(10), "<br>")}</p>' for para in re.split(r"\n\s*\n", text)]
    if kind == "image" and block.get("src"):
        return ['  <figure class="post__fig">',
                f'    <img src="{p}{attr(block["src"])}" alt="{attr(plain(w.get("caption", "")))}" loading="lazy" decoding="async">',
                *([cap] if cap else []), "  </figure>"]
    if kind == "gallery" and block.get("images"):
        imgs = [i for i in block["images"] if i.get("src")]
        out = [f'  <figure class="post__gallery" data-count="{len(imgs)}">']
        out += [f'    <img src="{p}{attr(i["src"])}" alt="" loading="lazy" decoding="async">' for i in imgs]
        if cap:
            out.append(cap)
        out.append("  </figure>")
        return out
    if kind == "video":
        if block.get("src"):
            poster = f' poster="{p}{attr(block["poster"])}"' if block.get("poster") else ""
            return ['  <figure class="post__fig post__fig--video">',
                    f'    <video src="{p}{attr(block["src"])}"{poster} controls playsinline preload="none"></video>',
                    *([cap] if cap else []), "  </figure>"]
        vid = next((v for v in shared["videos"] if v["id"] == block.get("video")), None)
        # same rule as everywhere else: no BV id, no video on the Chinese page
        if vid is None or not plays_here(loc, vid) or (loc["videoBackend"] != "bilibili" and not vid.get("yt")):
            return []
        out = ['  <figure class="post__fig post__fig--video">']
        out += render_video_tile(loc, vid, 4, True)
        if cap:
            out.append(cap)
        out.append("  </figure>")
        return out
    return []


def render_post(loc: dict, shared: dict, post: dict) -> list[str]:
    p = loc["assetPrefix"]
    j = loc["journal"]
    posts = [x for x in journal_posts(shared) if journal_words(loc, x).get("title")]
    words = journal_words(loc, post)
    i = next(n for n, x in enumerate(posts) if x["id"] == post["id"])
    cover = journal_cover(post)
    out = [
        "<!-- ================= JOURNAL POST ================= -->",
        '<article class="section section--lead post" id="post">',
        f'  <p class="post__back"><a href="{PAGE_FILE["press"]}#journal"><span aria-hidden="true">&larr; </span>{j["back"]}</a></p>',
        '  <header class="post__head">',
    ]
    out += ["    " + l for l in journal_meta(loc, post)]
    out += [f'    <h1 class="post__title">{words["title"]}</h1>', "  </header>"]
    if post.get("cover"):
        out += ['  <figure class="post__cover">',
                f'    <img src="{p}{attr(cover)}" alt="" decoding="async">', "  </figure>"]
    out.append('  <div class="post__body">')
    for block in post.get("blocks", []):
        out += ["  " + l for l in render_journal_block(loc, shared, block, words)]
    out.append("  </div>")
    # newer is up the list, older is down it
    newer = posts[i - 1] if i > 0 else None
    older = posts[i + 1] if i + 1 < len(posts) else None
    if newer or older:
        out.append(f'  <nav class="post__pager" aria-label="{attr(j["pager"])}">')
        if newer:
            out.append(f'    <a class="post__newer" href="{journal_file(newer)}"><small>{j["newer"]}</small>'
                       f'{journal_words(loc, newer)["title"]}</a>')
        if older:
            out.append(f'    <a class="post__older" href="{journal_file(older)}"><small>{j["older"]}</small>'
                       f'{journal_words(loc, older)["title"]}</a>')
        out.append("  </nav>")
    out.append("</article>")
    return out


def render_contact(loc: dict, shared: dict) -> list[str]:
    c = loc["contact"]
    sec = loc["sections"]["contact"]
    email = shared["contactEmail"]
    out = [
        "<!-- ================= 06 CONTACT ================= -->",
        '<section class="section section--alt" id="contact">',
        '  <div class="contact">',
        '    <div class="contact__lead reveal">',
        f'      <h2 class="section__title">{sec["title"]}</h2>',
        f'      <p class="section__desc">{with_breaks(sec["desc"])}</p>',
        '      <div class="contact__actions">',
        f'        <a class="btn btn--play contact__mail" href="mailto:{attr(email)}">{email}</a>',
    ]
    form = c.get("form")
    if form:
        # hidden until main.js has a <dialog> to open; with JS off the email
        # above is the way in, and a button that does nothing would not be
        out.append(
            f'        <button class="btn btn--ghost contact__msg" type="button" data-msg-open hidden>{form["open"]}</button>'
        )
    out += [
        "      </div>",
        f'      <p class="contact__who">{c["who"]}</p>',
        "    </div>",
        "",
        '    <div class="contact__grid reveal">',
    ]
    for col in c["columns"]:
        out += [
            '      <div class="contact__col">',
            f'        <h3>{col["heading"]}</h3>',
            "        <ul>",
        ]
        for item in col["items"]:
            muted = ""
            if item.get("muted"):
                # mutedTight drops the leading space — correct after a full-width
                # bracket in CJK, where the punctuation already carries the gap.
                gap = "" if item.get("mutedTight") else " "
                muted = f'{gap}<span class="muted">{item["muted"]}</span>'
            if item.get("url"):
                out.append(
                    f'          <li><a href="{attr(item["url"])}" target="_blank" '
                    f'rel="noopener">{item["label"]}</a>{muted}</li>'
                )
            else:
                out.append(f'          <li>{item["label"]}{muted}</li>')
        out += ["        </ul>", "      </div>"]

    out += ["    </div>", "  </div>"]
    if form:
        out += render_message_dialog(form, shared)
    out.append("</section>")
    return out


def render_message_dialog(form: dict, shared: dict) -> list[str]:
    """The "message Tony" window opened from the contact block.

    It posts JSON to `shared["messageEndpoint"]`. What happens after that -
    who reads it, how the copy and Tony's reply reach the sender - is the
    Worker's job and is not built yet; `tools/devserver.py` stands in for it
    locally. The strings JS writes (sending, sent, errors) ride in on data-
    attributes so they follow the page's language like everything else.
    """
    strings = {k: form[k] for k in ("sending", "sent", "error", "needMessage", "needReply")}
    return [
        "",
        '  <dialog class="msg" id="msgDialog" aria-labelledby="msgTitle">',
        f'    <form class="msg__form" method="post" action="{attr(shared["messageEndpoint"])}" novalidate',
        f'          data-msg data-email="{attr(shared["contactEmail"])}"',
        f"          data-strings='{attr(json.dumps(strings, ensure_ascii=False))}'>",
        '      <div class="msg__head">',
        f'        <h3 class="msg__title" id="msgTitle">{form["title"]}</h3>',
        f'        <button class="msg__close" type="button" data-msg-close aria-label="{attr(form["close"])}">&times;</button>',
        "      </div>",
        '      <div class="msg__fields">',
        f'        <p class="msg__intro">{form["intro"]}</p>',
        '        <label class="msg__field">',
        f'          <span class="msg__label">{form["messageLabel"]}</span>',
        '          <textarea name="message" rows="6" maxlength="2000" required></textarea>',
        "        </label>",
        '        <div class="msg__row">',
        '          <label class="msg__field">',
        f'            <span class="msg__label">{form["nameLabel"]} <span class="muted">{form["nameHint"]}</span></span>',
        '            <input name="name" type="text" autocomplete="name" maxlength="80">',
        "          </label>",
        '          <label class="msg__field">',
        f'            <span class="msg__label">{form["replyLabel"]}</span>',
        '            <input name="replyTo" type="text" autocomplete="email" maxlength="120" required>',
        "          </label>",
        "        </div>",
        f'        <p class="msg__hint">{form["replyHint"]}</p>',
        # a field people cannot see and bots fill in
        '        <input class="msg__trap" name="website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">',
        "      </div>",
        '      <p class="msg__status" role="status" aria-live="polite"></p>',
        '      <div class="msg__actions">',
        f'        <button class="btn btn--ghost" type="button" data-msg-close>{form["cancel"]}</button>',
        f'        <button class="btn btn--play msg__send" type="submit">{form["send"]}</button>',
        "      </div>",
        "    </form>",
        "  </dialog>",
    ]


def render_footer(loc: dict, shared: dict) -> list[str]:
    f = loc["footer"]
    return [
        '<footer class="foot">',
        "  <p>",
        f'    <span>&copy; <span id="year">{shared["copyrightYear"]}</span> {f["copyright"]}</span>',
        f'    <a href="#top">{f["backToTop"]}</a>',
        "  </p>",
        "</footer>",
    ]


# ---------------------------------------------------------------- page

def render_page(loc: dict, shared: dict, page: str, other: dict | None = None) -> str:
    """`page` is a PAGE_FILE key, or "post:<id>" for a journal post, which
    also needs `other` - the other locale - to know whether that language has
    a copy of the post for the language switch to point at."""
    p = loc["assetPrefix"]
    post = None
    if page.startswith("post:"):
        post = next(x for x in journal_posts(shared) if x["id"] == page[5:])
        page = "press"
    html_attrs = f' lang="{attr(loc["lang"])}"'
    lines = ["<!DOCTYPE html>", BANNER]

    if loc["videoBackend"] == "bilibili":
        lines += [
            '<!-- data-video="bilibili" tells VideoFacade to embed Bilibili rather than',
            "     YouTube on this page. Tiles whose data-bv is still empty stay ordinary",
            "     outbound links instead of becoming players that cannot load in China. -->",
        ]
        html_attrs += ' data-video="bilibili"'

    lines.append(f"<html{html_attrs}>")
    own = None
    if post:
        words = journal_words(loc, post)
        # the other language's copy of this post, or its journal if there is none yet
        alt_rel = journal_file(post) if journal_words(other or {}, post).get("title") else PAGE_FILE["press"]
        own = (f'{plain(words["title"])} — {plain(loc["journal"]["siteName"])}',
               journal_excerpt(loc, post, words) or loc["pages"]["press"]["description"],
               alt_rel)
    lines += render_head(loc, page, shared, own)

    # the skip link has to name a section that exists on this page
    first = "music" if page == "home" else "post" if post else page
    lines += ["<body>", "", "<!-- film grain overlay, and the light that follows the pointer -->",
              '<div class="grain" aria-hidden="true"></div>',
              '<div class="glow" aria-hidden="true"></div>', "",
              f'<a class="skip" href="#{first}">{loc["nav"]["skip"]}</a>', ""]

    # #top sits above the nav on every page, so the wordmark and the footer's
    # back-to-top link both land at the very top. On the homepage it used to
    # hang on the hero, which scrolled the portrait under the sticky bar.
    lines += ['<span id="top" aria-hidden="true"></span>', ""]

    if page == "home":
        # a trimmed version of each section, every heading a way through
        blocks = [
            render_nav(loc, page),
            render_hero(loc, shared),
            render_music(loc, shared),
            render_videos(loc, shared),
            render_about(loc, shared),
            render_milestones(loc, shared),
            # 05 "In the Making" is a page of its own, reached from the nav.
            # A "work in progress" teaser would say nothing here.
        ]
    elif page == "music":
        blocks = [
            render_nav(loc, page),
            render_music(loc, shared, full=True),
        ]
    elif page == "videos":
        blocks = [
            render_nav(loc, page),
            render_videos(loc, shared, full=True),
        ]
    elif page == "about":
        blocks = [
            render_nav(loc, page),
            render_about(loc, shared, full=True),
            render_milestones(loc, shared, full=True),
            render_press(loc, shared),
        ]
    elif post:
        blocks = [
            render_nav(loc, page, alt_rel),
            render_post(loc, shared, post),
        ]
    else:
        blocks = [
            render_nav(loc, page),
            render_making(loc, shared),
        ]

    # Every page finishes the same way: the copyright line, then the contact
    # block. It carries the only email address on the site, so it should not
    # be a trip back to the homepage to find it.
    blocks += [
        render_footer(loc, shared),
        render_contact(loc, shared),
    ]
    # the detail view, on the pages that have pictures to open
    if page in ("videos", "press") and loc.get("lens") and not post:
        blocks.append(render_lens(loc))

    for block in blocks:
        lines += block
        lines.append("")

    lines += [f'<script src="{asset("js/main.js", p)}"></script>', "</body>", "</html>", ""]
    return "\n".join(lines)


def load(name: str) -> dict:
    return json.loads((CONTENT / name).read_text(encoding="utf-8"))


# Everything Cloudflare Pages should serve. The repo also holds build.py,
# content/, tools/ and workers/, and none of those belong on a public host.
DEPLOY_DIRS = ("css", "js", "img", "fonts", "admin", "audio", "video")


def build_dist(shared: dict, pages: list[tuple[dict, str]]) -> None:
    """Assemble dist/ — what Pages uploads. Excludes sources by construction."""
    import itertools
    import shutil
    import stat

    dist = ROOT / "dist"

    # OneDrive sets the read-only bit on the folders it syncs. rmtree then
    # fails with WinError 5 and, because it is called with ignore_errors,
    # fails silently — dist/ survives and the mkdir below is what raises.
    # Clearing the bit first is what makes a local rebuild work twice; on
    # Cloudflare the checkout is fresh and there is no dist/ to remove.
    if dist.exists():
        for p in itertools.chain([dist], dist.rglob("*")):
            try:
                p.chmod(p.stat().st_mode | stat.S_IWRITE)
            except OSError:
                pass
    shutil.rmtree(dist, ignore_errors=True)
    dist.mkdir(parents=True, exist_ok=True)

    for name in DEPLOY_DIRS:
        src = ROOT / name
        if src.is_dir():
            shutil.copytree(src, dist / name, dirs_exist_ok=True)

    for loc, page, rel, other in pages:
        out = dist / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(render_page(loc, shared, page, other), encoding="utf-8", newline="\n")

    # The admin is gated by Cloudflare Access, but keep it out of search
    # indexes too — Access returns a login page, not a 404, and that is
    # exactly the sort of thing Baidu will happily index.
    #
    # It is also the one part of the site with no cache-busting: the pages
    # carry ?v=<hash> on every asset, but admin/ is copied in verbatim, so a
    # browser that has been in there once will happily keep running the
    # admin.js it already has after a deploy. no-cache does not stop it
    # caching — it stops it *using* the copy without asking first, which is
    # what makes a deploy take effect on the next load.
    (dist / "_headers").write_text(
        "/admin/*\n"
        "  X-Robots-Tag: noindex, nofollow\n"
        "  Cache-Control: no-cache\n",
        encoding="utf-8", newline="\n",
    )
    # The Visuals and In the Making pages were videos.html and making.html.
    # 301 rather than 308: these are page moves, and a permanent redirect is
    # what tells a search engine to carry the old URL's standing across.
    (dist / "_redirects").write_text(
        "".join(
            f"/{was} /{now} 301\n/zh/{was} /zh/{now} 301\n"
            for was, now in RENAMED_PAGES.items()
        ),
        encoding="utf-8", newline="\n",
    )
    (dist / "robots.txt").write_text(
        "User-agent: *\nDisallow: /admin/\n", encoding="utf-8", newline="\n"
    )

    total = sum(f.stat().st_size for f in dist.rglob("*") if f.is_file())
    count = sum(1 for f in dist.rglob("*") if f.is_file())
    print(f"dist/  {count} files, {total / 1e6:.1f}MB")


def main() -> int:
    shared = load("shared.json")
    en, zh = load("en.json"), load("zh.json")
    # five pages per locale - the homepage plus one for each full section -
    # and then one per journal post that has a title in either language
    pages = []
    for loc, other, prefix in ((en, zh, ""), (zh, en, "zh/")):
        pages += [(loc, page, f"{prefix}{PAGE_FILE[page]}", other) for page in PAGE_FILE]
        if loc.get("journal"):
            pages += [(loc, f'post:{post["id"]}', f"{prefix}{journal_file(post)}", other)
                      for post in journal_posts(shared) if journal_words(loc, post).get("title")]

    if "--dist" in sys.argv:
        build_dist(shared, pages)
        return 0

    check = "--check" in sys.argv
    stale = []

    for loc, page, rel, other in pages:
        path = ROOT / rel
        html = render_page(loc, shared, page, other)
        if check:
            current = path.read_text(encoding="utf-8") if path.exists() else ""
            if current != html:
                stale.append(rel)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(html, encoding="utf-8", newline="\n")
            print(f"wrote {rel}  ({len(html):,} bytes)")

    if check:
        for rel in stale:
            print(f"STALE  {rel}")
        if stale:
            print("\nRun `python build.py` to refresh them.")
            return 1
        print(f"all {len(pages)} pages match content/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

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
PAGE_FILE = {
    "home": "index.html",
    "music": "music.html",
    "videos": "videos.html",
    "about": "about.html",
    "press": "making.html",
}


ARROW_PREV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4l-8 8 8 8"/></svg>'
ARROW_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4l8 8-8 8"/></svg>'

PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>'


# ---------------------------------------------------------------- sections

def render_head(loc: dict, page: str) -> list[str]:
    p = loc["assetPrefix"]
    head = loc["pages"][page]
    rel = PAGE_FILE[page]
    return [
        "<head>",
        '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        f'<title>{head["title"]}</title>',
        f'<meta name="description" content="{attr(head["description"])}">',
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


def render_nav(loc: dict, page: str) -> list[str]:
    """Six evenly spaced slots; CSS orders the wordmark into the middle."""
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
    alt_href = ("zh/" if loc["assetPrefix"] == "" else "../") + PAGE_FILE[page]

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
        f'      <img class="ink" src="{p}{shared["images"]["ink"]}" alt="" aria-hidden="true">',
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


def section_head(loc: dict, key: str, href: str | None = None) -> list[str]:
    """`href` makes the heading itself the way through, with no extra label."""
    sec = loc["sections"][key]
    title = sec["title"]
    if href:
        title = f'<a class="section__link" href="{attr(href)}">{title}</a>'
    out = [
        '  <div class="section__head reveal">',
        f'    <span class="section__num">{sec["num"]}</span>',
        f'    <h2 class="section__title">{title}</h2>',
    ]
    # a standfirst is optional - Visuals carries none
    if sec.get("desc"):
        out.append(f'    <p class="section__desc">{sec["desc"]}</p>')
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
        if rel.get("badge") and c.get("badge"):
            out.append(f'        <span class="card__badge">{c["badge"]}</span>')
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
    out += [f'{s}  </span>', f'{s}  <span class="vid__meta">']
    if v.get("kicker"):
        out.append(f'{s}    <span class="vid__kicker">{v["kicker"]}</span>')
    out += [
        f'{s}    <span class="vid__title"{lang_attr(v.get("titleLang"))}>{v["title"]}</span>',
        f'{s}    <span class="vid__sub">{v["sub"]}</span>',
        f'{s}  </span>',
        f'{s}</a>',
    ]
    return out


def render_videos(loc: dict, shared: dict, full: bool = False) -> list[str]:
    lead = " section--lead" if full else ""
    alt = "" if full else " section--alt"
    out = [
        "<!-- ================= 02 VIDEOS ================= -->",
        f'<section class="section{alt}{lead}" id="videos">',
    ] + section_head(loc, "videos", None if full else "videos.html")

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
    grid = [v for v in shared["videos"] if not v.get("feature")]

    for v in feature:
        out += render_video_tile(loc, v, 2, True)

    # The homepage shows the title track and nothing else; the rest of the
    # catalogue lives on videos.html.
    if not full:
        out += section_cta("videos.html", loc["sections"]["videos"]["more"])
        out.append("</section>")
        return out

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


def render_milestones(loc: dict, shared: dict, full: bool = False) -> list[str]:
    # newest first either way: the whole run on the about page, the last three
    # fading out on the homepage
    rows = list(reversed(shared["milestones"] if full else shared["milestones"][-3:]))
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
        out += [
            '    <li class="tl__row reveal">',
            f'      <h3 class="{year_cls}">{row["year"]}</h3>',
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


def render_orbit(loc: dict, shared: dict) -> list[str]:
    """A ring of photos circling an album cover, turned by scrolling.

    Plain CSS 3D, driven by `Orbit` in main.js: the script only writes how far
    through the block the reader is, and the stylesheet places every card from
    that. The cards are real <img>s laid out at rest, so with JS off (or with
    reduced motion) this is a still ring rather than an empty tall box.
    """
    p = loc["assetPrefix"]
    orb = shared["orbit"]
    rel = next(r for r in shared["releases"] if r["id"] == orb["centre"])
    alt = loc["releases"][orb["centre"]]["alt"]
    out = [
        '  <div class="orbit" data-orbit>',
        '    <div class="orbit__stage">',
        f'      <div class="orbit__scene" style="--n:{len(orb["photos"])}">',
        f'        <img class="orbit__centre" src="{p}{rel["art"]}" alt="{attr(alt)}">',
    ]
    for i, photo in enumerate(orb["photos"]):
        out.append(
            f'        <img class="orbit__card" style="--i:{i}" src="{p}{photo}"'
            ' alt="" aria-hidden="true" decoding="async">'
        )
    # Outside the stage on purpose: the stage carries a perspective, which
    # would make it the box a position:fixed child is pinned to.
    out += [
        "      </div>",
        "    </div>",
        f'    <a class="to-top" href="#top" data-to-top>&uarr;&#160;{loc["footer"]["backToTop"]}</a>',
        "  </div>",
    ]
    return out


def render_making(loc: dict, shared: dict) -> list[str]:
    """Section 05, "In the Making" - the heading and the orbit, until the
    notes that belong here are written.

    The file is `making.html`, but the content key and the `#press` anchor
    keep their old names: the coverage this section used to carry is still
    in `shared["press"]` and both locales,
    dormant rather than deleted, and existing links to #press still land
    somewhere sensible. `render_press_rail` and `PressStage` are unused for
    now and kept for when that coverage is placed somewhere else.
    """
    out = [
        "<!-- ================= 05 IN THE MAKING ================= -->",
        '<section class="section section--lead" id="press">',
    ] + section_head(loc, "press") + [""]
    out += render_orbit(loc, shared) + ["</section>"]
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
        f'      <span class="section__num">{sec["num"]}</span>',
        f'      <h2 class="section__title">{sec["title"]}</h2>',
        f'      <p class="section__desc">{sec["desc"]}</p>',
        f'      <a class="btn btn--play contact__mail" href="mailto:{attr(email)}">{email}</a>',
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

    out += ["    </div>", "  </div>", "</section>"]
    return out


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

def render_page(loc: dict, shared: dict, page: str) -> str:
    p = loc["assetPrefix"]
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
    lines += render_head(loc, page)

    # the skip link has to name a section that exists on this page
    first = "music" if page == "home" else page
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

    for block in blocks:
        lines += block
        lines.append("")

    lines += [f'<script src="{asset("js/main.js", p)}"></script>', "</body>", "</html>", ""]
    return "\n".join(lines)


def load(name: str) -> dict:
    return json.loads((CONTENT / name).read_text(encoding="utf-8"))


# Everything Cloudflare Pages should serve. The repo also holds build.py,
# content/, tools/ and workers/, and none of those belong on a public host.
DEPLOY_DIRS = ("css", "js", "img", "fonts", "admin", "audio")


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

    for loc, page, rel in pages:
        out = dist / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(render_page(loc, shared, page), encoding="utf-8", newline="\n")

    # The admin is gated by Cloudflare Access, but keep it out of search
    # indexes too — Access returns a login page, not a 404, and that is
    # exactly the sort of thing Baidu will happily index.
    (dist / "_headers").write_text(
        "/admin/*\n  X-Robots-Tag: noindex, nofollow\n", encoding="utf-8", newline="\n"
    )
    (dist / "robots.txt").write_text(
        "User-agent: *\nDisallow: /admin/\n", encoding="utf-8", newline="\n"
    )

    total = sum(f.stat().st_size for f in dist.rglob("*") if f.is_file())
    count = sum(1 for f in dist.rglob("*") if f.is_file())
    print(f"dist/  {count} files, {total / 1e6:.1f}MB")


def main() -> int:
    shared = load("shared.json")
    # five pages per locale: the homepage plus one for each full section
    pages = [
        (loc, page, f"{prefix}{PAGE_FILE[page]}")
        for loc, prefix in ((load("en.json"), ""), (load("zh.json"), "zh/"))
        for page in PAGE_FILE
    ]

    if "--dist" in sys.argv:
        build_dist(shared, pages)
        return 0

    check = "--check" in sys.argv
    stale = []

    for loc, page, rel in pages:
        path = ROOT / rel
        html = render_page(loc, shared, page)
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

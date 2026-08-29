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

import json
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

def attr(value: str) -> str:
    """Escape a value for use inside a double-quoted HTML attribute."""
    return escape(str(value), quote=True)


def lang_attr(value: str | None) -> str:
    return f' lang="{attr(value)}"' if value else ""


def indent(lines: list[str], by: int) -> list[str]:
    pad = " " * by
    return [pad + line if line else line for line in lines]


PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>'


# ---------------------------------------------------------------- sections

def render_head(loc: dict) -> list[str]:
    p = loc["assetPrefix"]
    head = loc["head"]
    return [
        "<head>",
        '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        f'<title>{head["title"]}</title>',
        f'<meta name="description" content="{attr(head["description"])}">',
        "<!-- fonts are self-hosted: fonts.googleapis.com is blocked in mainland China -->",
        f'<link rel="preload" href="{p}fonts/inter-400-latin.woff2" as="font" type="font/woff2" crossorigin>',
        f'<link rel="preload" href="{p}fonts/instrument-serif-400-latin.woff2" as="font" type="font/woff2" crossorigin>',
        f'<link rel="stylesheet" href="{p}css/styles.css">',
        '<link rel="alternate" hreflang="en" href="/index.html">',
        '<link rel="alternate" hreflang="zh-Hans" href="/zh/index.html">',
        '<link rel="alternate" hreflang="x-default" href="/index.html">',
        "<!-- scroll-reveal is a progressive enhancement: without JS the content",
        "     must still be visible, so opt in to the hidden state only when JS runs -->",
        "<script>document.documentElement.classList.add('js');</script>",
        "</head>",
    ]


def render_nav(loc: dict) -> list[str]:
    nav = loc["nav"]
    out = [
        "<!-- nav -->",
        '<header class="nav" id="nav">',
        '  <a class="nav__mark" href="#top">TONY&nbsp;D</a>',
        "",
        f'  <nav class="nav__links" id="navLinks" aria-label="{attr(nav["ariaPrimary"])}">',
    ]
    for link in nav["links"]:
        out.append(f'    <a href="{attr(link["href"])}">{link["label"]}</a>')
    cta = nav["cta"]
    out.append(f'    <a href="{attr(cta["href"])}" class="nav__cta">{cta["label"]}</a>')
    alt = nav["altLang"]
    out.append(
        f'    <a href="{attr(alt["href"])}" class="nav__lang" lang="{attr(alt["lang"])}"'
        f' hreflang="{attr(alt["lang"])}">{alt["label"]}</a>'
    )
    out += [
        "  </nav>",
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
    return [
        "<!-- ================= HERO ================= -->",
        '<section class="hero" id="top">',
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
        '    <p class="hero__sub reveal">',
        f'      {hero["sub"]}',
        "    </p>",
        "",
        '    <div class="hero__actions reveal">',
        '      <button class="btn btn--play" id="playBtn" aria-pressed="false">',
        '        <span class="btn__icon" aria-hidden="true">',
        '          <svg class="i-play" viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>',
        '          <svg class="i-pause" viewBox="0 0 24 24"><rect x="7" y="5.5" width="3.4" height="13" rx="1"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1"/></svg>',
        "        </span>",
        f'        <span class="btn__label">{hero["playLabel"]}</span>',
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


def render_playlist(loc: dict, shared: dict) -> list[str]:
    """The hero player's queue, as inert JSON the page reads at boot.

    Kept out of main.js on purpose: the file paths and the track titles are
    content, they differ per locale, and the admin already round-trips
    anything it finds in the JSON.
    """
    tracks = shared.get("tracks") or []
    if not tracks:
        return []

    p = loc["assetPrefix"]
    titles = loc.get("tracks", {})
    queue = [
        {
            "id": t["id"],
            "src": f'{p}{t["file"]}',
            "title": titles.get(t["id"], {}).get("title", t["id"]),
        }
        for t in tracks
    ]
    # `<` escaped so a title can never close this script element early.
    body = json.dumps(queue, ensure_ascii=False).replace("<", "\u003c")
    return [
        '  <script type="application/json" id="playlist">' + body + "</script>",
    ]


def render_ticker(loc: dict) -> list[str]:
    ticker = loc["ticker"]
    out = [
        "<!-- ================= TICKER ================= -->",
        f'<div class="ticker" id="ticker" aria-label="{attr(ticker["aria"])}">',
        '  <div class="ticker__track" id="tickerTrack">',
        '    <span class="ticker__set">',
    ]
    for item in ticker["items"]:
        out.append(f"      {item} <i>·</i>")
    out += ["    </span>", "  </div>", "</div>"]
    return out


def section_head(loc: dict, key: str) -> list[str]:
    sec = loc["sections"][key]
    return [
        '  <div class="section__head reveal">',
        f'    <span class="section__num">{sec["num"]}</span>',
        f'    <h2 class="section__title">{sec["title"]}</h2>',
        f'    <p class="section__desc">{sec["desc"]}</p>',
        "  </div>",
    ]


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


def render_music(loc: dict, shared: dict) -> list[str]:
    p = loc["assetPrefix"]
    out = [
        "<!-- ================= 01 MUSIC ================= -->",
        '<section class="section" id="music">',
    ] + section_head(loc, "music") + ["", '  <div class="cards">']

    for i, rel in enumerate(shared["releases"]):
        c = loc["releases"][rel["id"]]
        if i:
            out.append("")
        out += [
            '    <article class="card reveal" data-tilt>',
            '      <div class="card__art">',
            # The record sits behind the sleeve and slides out on hover. It is
            # drawn entirely in CSS — no extra request, which matters on a site
            # that has to render inside the GFW.
            '        <span class="card__disc" aria-hidden="true"><span class="card__disc-face"></span></span>',
            # the sleeve carries its own clipping so the disc can escape .card__art
            '        <span class="card__sleeve">',
            f'          <img src="{p}{rel["art"]}" alt="{attr(c["alt"])}" loading="lazy">',
            "        </span>",
        ]
        if rel.get("badge") and c.get("badge"):
            out.append(f'        <span class="card__badge">{c["badge"]}</span>')
        out += [
            "      </div>",
            '      <div class="card__body">',
            f'        <h3 class="card__title"{lang_attr(c.get("titleLang"))}>{c["title"]}</h3>',
            f'        <p class="card__meta">{c["meta"]}</p>',
        ]

        # A release with named tracks gets them as real list items, so each one
        # can be hovered on its own. Only the singles have names to list: the
        # resume PDF gives no track order for either album, and it is the only
        # source, so nothing is invented to fill the gap.
        if c.get("trackList"):
            out.append(f'        <ul class="card__tracks"{lang_attr(c.get("copyLang"))}>')
            for name in c["trackList"]:
                out.append(f"          <li>{name}</li>")
            out.append("        </ul>")
        else:
            out.append(
                f'        <p class="card__copy"{lang_attr(c.get("copyLang"))}>{c["copy"]}</p>'
            )

        out.append('        <div class="card__links">')
        out += render_links(c["links"], 10)
        out += ["        </div>", "      </div>", "    </article>"]

    out += ["  </div>", "</section>"]
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


def render_videos(loc: dict, shared: dict) -> list[str]:
    out = [
        "<!-- ================= 02 VIDEOS ================= -->",
        '<section class="section section--alt" id="videos">',
    ] + section_head(loc, "videos")

    if loc.get("notice"):
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


def render_about(loc: dict, shared: dict) -> list[str]:
    p = loc["assetPrefix"]
    a = loc["about"]
    img = shared["images"]
    out = [
        "<!-- ================= 03 ABOUT ================= -->",
        '<section class="section" id="about">',
    ] + section_head(loc, "about") + [
        "",
        '  <div class="about">',
        '    <div class="about__media">',
        '      <figure class="about__shot reveal">',
        f'        <img src="{p}{img["aboutTop"]}" alt="{attr(a["altTop"])}" loading="lazy">',
        "      </figure>",
        '      <figure class="about__shot about__shot--wide reveal">',
        f'        <img src="{p}{img["aboutWide"]}" alt="{attr(a["altWide"])}" loading="lazy">',
        f'        <figcaption>{a["captionWide"]}</figcaption>',
        "      </figure>",
        '      <figure class="about__shot reveal">',
        f'        <img src="{p}{img["aboutBottom"]}" alt="{attr(a["altBottom"])}" loading="lazy">',
        "      </figure>",
        "    </div>",
        "",
        '    <div class="about__prose">',
    ]
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
    out += [
        f'      <h3 class="about__sub reveal">{a["influencesHeading"]}</h3>',
        '      <ul class="tags reveal">',
    ]
    for tag in a["influences"]:
        out.append(f'        <li{lang_attr(tag.get("lang"))}>{tag["label"]}</li>')
    out += [
        "      </ul>",
        "",
        f'      <h3 class="about__sub reveal">{a["profileHeading"]}</h3>',
        '      <dl class="facts reveal">',
    ]
    for fact in a["facts"]:
        out.append(f'        <div><dt>{fact["term"]}</dt><dd>{fact["value"]}</dd></div>')
    out += ["      </dl>", "    </div>", "  </div>", "</section>"]
    return out


def render_milestones(loc: dict, shared: dict) -> list[str]:
    out = [
        "<!-- ================= 04 MILESTONES ================= -->",
        '<section class="section section--alt" id="milestones">',
    ] + section_head(loc, "milestones") + ["", '  <ol class="tl">']

    for i, row in enumerate(shared["milestones"]):
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

    out += ["  </ol>", "</section>"]
    return out


def render_press(loc: dict, shared: dict) -> list[str]:
    out = [
        "<!-- ================= 05 PRESS ================= -->",
        '<section class="section" id="press">',
    ] + section_head(loc, "press") + ["", '  <ul class="press">']

    for item in shared["press"]:
        c = loc["press"][item["id"]]
        out += [
            '    <li class="press__item reveal">',
            f'      <a href="{attr(item["url"])}" target="_blank" rel="noopener">',
            f'        <span class="press__src">{c["src"]}</span>',
            f'        <span class="press__title"{lang_attr(c.get("titleLang"))}>{c["title"]}</span>',
            f'        <span class="press__gloss">{c["gloss"]}</span>',
            "      </a>",
            "    </li>",
        ]

    out += ["  </ul>", "</section>"]
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

def render_page(loc: dict, shared: dict) -> str:
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
    lines += render_head(loc)
    lines += ["<body>", "", "<!-- film grain overlay -->",
              '<div class="grain" aria-hidden="true"></div>', "",
              f'<a class="skip" href="#music">{loc["nav"]["skip"]}</a>', ""]

    for block in (
        render_nav(loc),
        render_hero(loc, shared),
        # sits straight after the hero, and the hero is sized so this lands
        # at the foot of the first screen rather than below it
        render_ticker(loc),
        render_music(loc, shared),
        render_videos(loc, shared),
        render_about(loc, shared),
        render_milestones(loc, shared),
        render_press(loc, shared),
        render_contact(loc, shared),
        render_footer(loc, shared),
    ):
        lines += block
        lines.append("")

    lines += [f'<script src="{p}js/main.js"></script>', "</body>", "</html>", ""]
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

    for loc, rel in pages:
        out = dist / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(render_page(loc, shared), encoding="utf-8", newline="\n")

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
    pages = [(load("en.json"), "index.html"), (load("zh.json"), "zh/index.html")]

    if "--dist" in sys.argv:
        build_dist(shared, pages)
        return 0

    check = "--check" in sys.argv
    stale = []

    for loc, rel in pages:
        path = ROOT / rel
        html = render_page(loc, shared)
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
        print("both pages match content/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

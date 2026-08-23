# Tony D — website

Bilingual artist site. Vanilla HTML/CSS/JS, no build step.

| Page | Language | Video source |
|---|---|---|
| `index.html` | English (`en`) | YouTube |
| `zh/index.html` | 简体中文 (`zh-Hans`) | Bilibili |

Two full documents rather than one page with a JS string swap: Baidu
indexes static HTML far more reliably than JS-rendered content, and the
two versions genuinely differ in substance — the Chinese page leads with
NetEase and QQ Music, and embeds Bilibili instead of YouTube. They share
`css/`, `js/`, `img/` and `fonts/`, so only the copy is duplicated.

**Edit both pages when changing shared content.** There is no build step
tying them together.

## Sections

| # | Section | Notes |
|---|---|---|
| — | Hero | portrait, ink logo, audio-reactive waveform |
| — | Ticker | career highlights marquee |
| 01 | Releases | two albums + singles |
| 02 | Videos | 13 click-to-load embeds (YouTube / Bilibili) |
| 03 | About | bio, influences, profile table |
| 04 | Milestones | 2021–2025 timeline |
| 05 | Press | Weibo coverage |
| 06 | Contact | management email, platform links |

All copy comes from `Tony-Artist Resume.pdf` — that PDF is the source of
truth for anything factual on this page. It is **not in this repo** (32MB,
and it is a full personal press kit); it lives alongside the working copy.

## Run it

```
python -m http.server 5502
```

Then open <http://localhost:5502>. (VS Code Live Server works too — the
reference project used port 5501.)

It must be served over HTTP, not opened as a `file://` path: the audio
probe and WebP loading both need a real origin.

## Theme — "Ink & Late Night"

Colours were sampled from Tony's own artwork rather than picked by eye.

| Token | Value | Where it came from |
|---|---|---|
| `--ink` | `#0B0A0C` | *Overthinking* cover base (`#1D0C16`) |
| `--bone` | `#EDE6DC` | warm off-white — deliberately not pure white |
| `--magenta` | `#FA279F` | 46% of the *HER* single artwork |
| `--orange` | `#B25A16` | the orange editorial portrait |
| `--acid` | `#05F93B` | *HER* secondary — once per page, maximum |

Type: **Inter** for everything, **Instrument Serif** italic for accents.
The display "typeface" is Tony's own handwriting (`img/ink-overthinking.webp`).

Both families are **self-hosted** in `fonts/` (latin + latin-ext subsets,
weights 400/600/700 only — the three the CSS actually uses). They used to
come from `fonts.googleapis.com`, which is blocked in mainland China; that
took the whole typography down there without anything looking obviously
broken.

Neither family has CJK glyphs, so Chinese characters fall past them to the
system stack in `--f-sans` / `--f-serif` (PingFang SC, Microsoft YaHei,
Songti SC…). A real CJK webfont is several megabytes unless subset, which
is not worth it for the amount of Chinese on these pages.

## Effects

| Effect | Where |
|---|---|
| Film grain overlay | `.grain` + `css/grain.svg` |
| Ink logo draw-on | `@keyframes ink-draw` (clip-path wipe) |
| Audio-reactive waveform | `AudioEngine` + `Waveform` in `js/main.js` |
| Scroll reveal | `Reveal` (IntersectionObserver) |
| Card tilt | `Tilt` — 4°, down from the reference's 10° |
| Achievement marquee | `Ticker` |
| Mobile menu | `MobileNav` — burger + full-screen panel under 900px |
| Nav section highlight | `ScrollSpy` |
| Click-to-load video | `VideoFacade` |

All motion is behind `prefers-reduced-motion`. Scroll-reveal only hides
content when JS is running (`html.js`), so a script failure degrades to
plain visible content instead of a blank page.

## Audio

Click-to-play only — nothing autoplays. `AudioEngine` probes `TRACKS` in
`js/main.js` in order and uses the first file that exists:

```
audio/tony-browse.mp3      <- preferred
audio/tony-browse.m4a
audio/tony-browse.ogg
audio/overthinking-clip.mp3
```

**Drop a file at one of those paths and it is picked up automatically.**
No code change. Until one exists, the fallback ambient pad plays and the
page shows a note saying it is a placeholder.

### Choosing the clip

This is music to browse to, so the usual single-picking instincts are the
wrong ones:

- **Instrumental beats vocal.** Lyrics compete with the copy someone is
  reading. The *Guitar Sessions* playlist is the natural place to look.
- **It loops**, so it needs an ending that meets its beginning without a
  seam, and no big dynamic arc.
- **30–90 seconds is plenty.** A whole track is a large download for
  something playing under a page.
- Playback sits at `LEVEL = 0.42`, well under unity, and fades in over
  1.4s / out over 1.1s rather than cutting.

Get the file from Tony — his father engineered these records, so clean
masters exist. Do not rip from YouTube or Spotify: it breaks their terms
and sounds worse than the source you can just ask for.

### The fallback pad

Am9 / Fmaj7 / Cmaj7 / G6add9 on a 6.2s cycle with a 9s ring, so chords
overlap and nothing resolves hard. Each note is two oscillators detuned
±6 cents, run through a lowpass that drifts slowly, then a generated
convolution reverb. It is meant to be ignorable.

## Assets

`img/` was extracted from `Tony-Artist Resume.pdf` (72 unique images,
mostly JPEG 2000, which no browser renders). Regenerate with:

```
pip install pymupdf pillow numpy
python tools/extract.py     # PDF -> images/
python tools/conv.py        # JPEG2000 -> PNG
python tools/assets.py      # -> img/*.webp
```

Run them from the repo root. `extract.py` has the PDF's absolute path at
the top — point it at your own copy.

These are compressed copies pulled out of a PDF. **Replace them with the
photographer's originals when available** — especially `hero-portrait.webp`.

## Videos

The video grid is a **click-to-load facade**: each tile ships as a plain
outbound link with a poster image, and `VideoFacade` swaps in an iframe
only when it is clicked. Nothing from YouTube or Bilibili runs on page
load, and with JS disabled the tiles still work as ordinary links.

Posters are **self-hosted** in `img/video/<youtube-id>.webp` (13 files,
~630KB total, lazy-loaded). They used to be hot-linked from
`i.ytimg.com`, which is blocked in mainland China — the Chinese page
would have shown thirteen broken images.

### Which back end a page uses

`VideoFacade` reads `<html data-video="...">`:

| Attribute | Tiles use | Page |
|---|---|---|
| *(absent)* | `data-yt` → `youtube-nocookie.com` | `index.html` |
| `data-video="bilibili"` | `data-bv` → `player.bilibili.com` | `zh/index.html` |

### Adding the Bilibili ids

Every tile in `zh/index.html` currently has an empty `data-bv=""`, because
the Bilibili channel does not exist yet. A tile with an empty `data-bv` on
a Bilibili page is deliberately **left as a plain outbound link** — it gets
`.vid--pending`, loses its play badge, and shows a "B 站即将上线" flag
rather than becoming a player that could never load in China.

Once the videos are uploaded, fill in the BV id — that is the only change
needed:

```html
<a class="vid" data-bv="BV1xx411c7mD" data-yt="Z-EP0Qwl2xw" ...>
```

Then drop the `vid__flag` span from that tile, and the notice box above the
grid once they are all done.

## Reaching mainland China

A large part of Tony's audience is in mainland China, where much of the
usual web stack is unreachable. Current state:

| Dependency | Status | Handling |
|---|---|---|
| Google Fonts | blocked | self-hosted in `fonts/` |
| `i.ytimg.com` posters | blocked | self-hosted in `img/video/` |
| YouTube embeds | blocked | Bilibili on `zh/`; YouTube only as a labelled outbound link |
| Spotify | not available | present but marked 海外 on `zh/` |
| Weibo, NetEase, QQ Music, Douyin, Apple Music `/cn` | fine | led with on `zh/` |

**No blocked host is loaded as a subresource on either page.** The YouTube
links that remain on `zh/index.html` are optional outbound links, labelled
海外, not things the page needs in order to render.

Re-run this check after editing either page:

```
grep -ohE 'https?://[a-zA-Z0-9._-]+' index.html zh/index.html | sort | uniq -c
```

**Still unsolved: hosting.** Even with every blocked asset removed, a site
served from outside China is slow and unreliable there. The real fix is a
mainland CDN, which requires an ICP filing (备案) and therefore a Chinese
entity or ID. Worth settling before investing further in the CN page.

## Known gaps

- **No real audio yet** — the ambient pad is still what plays. Needs a
  clip from Tony at one of the `TRACKS` paths; see *Audio* above.
- *Saturn Diary* Apple Music link unknown — the resume lists a Spotify URL
  under the Apple Music heading. Marked `is-missing` in the card.
- `album-saturn.webp` is my best guess at the cover from the PDF layout;
  confirm it is the real artwork.
- Press items are Weibo permalinks from the resume; the English lines under
  each are my glosses of the Chinese titles, not official translations.
- The contact address is the one the resume gives (Ms. Zhang). Confirm it
  is the right public-facing address before the site goes live.
- `《if you》` from the resume is a Weibo-only video, so it is not in the
  grid — there is no YouTube ID for it.
- **No Bilibili channel yet.** All 13 `data-bv` slots in `zh/index.html`
  are empty; see *Adding the Bilibili ids* above.
- The Chinese copy is my translation, not Tony's own wording. Competition
  names use the common Chinese renderings where those are established and
  stay in English otherwise. Have a native speaker read it before launch —
  an artist bio is voice-sensitive.
- *Saturn Diary* has no Chinese title anywhere in the resume, so it is left
  in English on the Chinese page rather than invented.
- `zh/` NetEase and QQ Music links point at Tony's artist pages, not at the
  specific albums — the resume only gives profile-level URLs.

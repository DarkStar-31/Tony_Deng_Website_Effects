/* =========================================================
   Tony D — hero prototype
   Class structure follows the Music Tools reference:
   AudioEngine / Waveform / Tilt / Reveal / Ticker
   ========================================================= */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Drop one of Tony's clips at any of these paths and the page picks it up
   automatically — first one that exists wins, no code change needed.
   Until then AudioEngine falls back to a synthesised ambient pad.

   This is browsing music: it loops under someone who is reading, so a
   calm instrumental passage beats a full vocal take. */
const TRACKS = [
  'audio/tony-browse.mp3',
  'audio/tony-browse.m4a',
  'audio/tony-browse.ogg',
  'audio/overthinking-clip.mp3'   // the original placeholder path
];

/* Background level. Deliberately well under unity — this plays while
   someone reads, and it is not the point of the page. */
const LEVEL = 0.42;


/* ---------------------------------------------------------
   AudioEngine — real file if present, synth pad if not
   --------------------------------------------------------- */
class AudioEngine {
  constructor () {
    this.ctx      = null;
    this.analyser = null;
    this.playing  = false;
    this.mode     = null;      // 'file' | 'synth'
    this.el       = null;
    this.voices   = [];
    this.timer    = null;
    this.onstate  = () => {};
  }

  async _init () {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;

    /* Signal chain:  voices -> tone -> [dry + reverb] -> master -> analyser
       The filter and reverb are what make the pad sound like a room
       rather than an oscillator. They sit before the analyser so the
       waveform reacts to what you actually hear. */
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;              // faded up in start()
    this.master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    this.tone = this.ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 1400;        // takes the glare off
    this.tone.Q.value = 0.4;

    const wet = this.ctx.createGain();
    wet.gain.value = 0.34;
    const dry = this.ctx.createGain();
    dry.gain.value = 0.72;

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.4, 2.6);

    this.tone.connect(dry).connect(this.master);
    this.tone.connect(this.reverb).connect(wet).connect(this.master);

    // Probe for a real clip: first path that exists wins.
    for (const url of TRACKS) {
      const ok = await fetch(url, { method: 'HEAD' }).then(r => r.ok).catch(() => false);
      if (!ok) continue;
      this.mode = 'file';
      this.url  = url;
      this.el = new Audio(url);
      this.el.crossOrigin = 'anonymous';
      this.el.loop = true;
      this.ctx.createMediaElementSource(this.el).connect(this.master);
      return;
    }
    this.mode = 'synth';
  }

  /* Noise burst with an exponential decay — a cheap, decent room. */
  _impulse (seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len  = Math.floor(rate * seconds);
    const buf  = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  async toggle () {
    await this._init();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.playing ? this.stop() : this.start();
  }

  /* Fades matter here: an abrupt start is jarring when someone is reading. */
  start () {
    this.playing = true;
    clearTimeout(this.fade);

    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(Math.max(this.master.gain.value, 0.0001), t);
    this.master.gain.linearRampToValueAtTime(LEVEL, t + 1.4);

    if (this.mode === 'file') this.el.play().catch(() => {});
    else this._synthLoop();

    this.onstate(true, this.mode);
  }

  stop () {
    this.playing = false;

    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0.0001, t + 1.1);

    if (this.mode === 'file') {
      // pause only once the fade has actually finished
      this.fade = setTimeout(() => { if (!this.playing) this.el.pause(); }, 1200);
    } else {
      clearTimeout(this.timer);
      this.voices.forEach(v => {
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setTargetAtTime(0, t, 0.4);
        v.osc.stop(t + 2.4);
      });
      this.voices = [];
    }
    this.onstate(false, this.mode);
  }

  /* Ambient pad — placeholder until one of TRACKS exists.

     The old version was triads on a 2.6s cycle, which read as "hold
     music". This is slower and voiced with 7ths and 9ths so nothing
     resolves hard, each chord overlaps the next so there is never a
     seam, and every note is two slightly detuned oscillators for width.
     Written to sit under reading, not to be listened to. */
  _synthLoop () {
    // MIDI note numbers: Am9 / Fmaj7 / Cmaj7 / G6add9
    const CHORDS = [
      [57, 64, 67, 71],
      [53, 60, 64, 69],
      [48, 55, 59, 64],
      [55, 62, 64, 71]
    ];
    const hz = m => 440 * Math.pow(2, (m - 69) / 12);

    const HOLD  = 9.0;    // how long one chord rings
    const CYCLE = 6.2;    // next chord starts before this one ends

    let i = 0;
    const play = () => {
      if (!this.playing) return;
      const now = this.ctx.currentTime;

      CHORDS[i % CHORDS.length].forEach((midi, n) => {
        // two oscillators per note, detuned against each other
        [-6, 6].forEach((cents, k) => {
          const osc  = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          const pan  = this.ctx.createStereoPanner
                     ? this.ctx.createStereoPanner() : null;

          osc.type = n === 0 ? 'triangle' : 'sine';
          osc.frequency.value = hz(midi);
          osc.detune.value = cents;
          if (pan) pan.pan.value = (k ? 0.28 : -0.28) * (n / 3);

          // quieter for upper voices so the chord doesn't get shrill
          const peak = 0.085 / (1 + n * 0.5);

          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.exponentialRampToValueAtTime(peak, now + 2.4);   // slow swell
          gain.gain.setValueAtTime(peak, now + HOLD - 3.4);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + HOLD);

          osc.connect(gain);
          (pan ? gain.connect(pan) : gain).connect(this.tone);
          osc.start(now);
          osc.stop(now + HOLD + 0.2);
          this.voices.push({ osc, gain });
        });
      });

      // a slow filter drift so the texture is never static
      const open = 1150 + Math.sin(i * 0.7) * 320;
      const f = this.tone.frequency;
      f.cancelScheduledValues(now);
      f.setValueAtTime(f.value, now);        // anchor, else the ramp start is undefined
      f.linearRampToValueAtTime(open, now + CYCLE);

      this.voices = this.voices.slice(-64);
      i++;
      this.timer = setTimeout(play, CYCLE * 1000);
    };
    play();
  }
}


/* ---------------------------------------------------------
   Waveform — mirrored line, magenta, idles when silent
   --------------------------------------------------------- */
class Waveform {
  constructor (canvas, engine) {
    this.c      = canvas;
    this.ctx    = canvas.getContext('2d');
    this.engine = engine;
    this.t      = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
    this.loop();
  }

  resize () {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const r = this.c.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.c.width  = this.w * dpr;
    this.c.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  loop () {
    requestAnimationFrame(() => this.loop());
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    this.t += 0.02;

    const an = this.engine.analyser;
    const live = this.engine.playing && an;

    let data = null;
    if (live) {
      data = new Uint8Array(an.fftSize);
      an.getByteTimeDomainData(data);
    }

    const mid  = h * 0.62;
    const STEP = 2;

    ctx.beginPath();
    for (let x = 0; x <= w; x += STEP) {
      let v;
      if (live) {
        const idx = Math.floor((x / w) * data.length);
        v = (data[idx] - 128) / 128;          // -1 .. 1
        v *= 46;
      } else {
        // idle: a slow breathing sine so the line never looks dead
        v = Math.sin(x * 0.012 + this.t) * 5
          * Math.sin(x * 0.003 - this.t * 0.6)
          + Math.sin(this.t * 0.9) * 1.5;
      }
      const y = mid - v;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }

    // fade the line out toward both edges
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0,    'rgba(250,39,159,0)');
    grad.addColorStop(0.12, 'rgba(250,39,159,.85)');
    grad.addColorStop(0.5,  'rgba(250,39,159,1)');
    grad.addColorStop(0.88, 'rgba(250,39,159,.85)');
    grad.addColorStop(1,    'rgba(250,39,159,0)');

    ctx.strokeStyle = grad;
    ctx.lineWidth   = live ? 2 : 1.4;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    if (live) { ctx.shadowColor = 'rgba(250,39,159,.55)'; ctx.shadowBlur = 14; }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}


/* ---------------------------------------------------------
   Tilt — the reference effect, dialled back from 10deg to 4
   --------------------------------------------------------- */
class Tilt {
  constructor (sel = '[data-tilt]', max = 4) {
    if (REDUCED || matchMedia('(hover: none)').matches) return;
    this.max = max;
    document.querySelectorAll(sel).forEach(el => {
      el.style.transition = 'transform .5s cubic-bezier(.22,.61,.36,1)';
      el.addEventListener('mousemove', e => this.move(e, el));
      el.addEventListener('mouseleave', () => this.reset(el));
      el.addEventListener('mouseenter', () => { el.style.transition = 'transform .12s linear'; });
    });
  }
  move (e, el) {
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width  - 0.5;
    const py = (e.clientY - r.top)  / r.height - 0.5;
    el.style.transform =
      `perspective(900px) rotateX(${-py * this.max * 2}deg) ` +
      `rotateY(${px * this.max * 2}deg) translateY(-4px)`;
  }
  reset (el) {
    el.style.transition = 'transform .5s cubic-bezier(.22,.61,.36,1)';
    el.style.transform = '';
  }
}


/* ---------------------------------------------------------
   Reveal — staggered scroll-in
   --------------------------------------------------------- */
class Reveal {
  constructor (sel = '.reveal') {
    const items = document.querySelectorAll(sel);
    if (REDUCED || !('IntersectionObserver' in window)) {
      items.forEach(el => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry, i) => {
        if (!entry.isIntersecting) return;
        setTimeout(() => entry.target.classList.add('is-in'), i * 90);
        io.unobserve(entry.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    items.forEach(el => io.observe(el));

    // Failsafe: nothing should stay invisible just because the observer
    // never fired (print, full-page capture, odd scroll containers).
    setTimeout(() => items.forEach(el => el.classList.add('is-in')), 4000);
  }
}


/* ---------------------------------------------------------
   Ticker — seamless marquee, duplicated to fill the width
   --------------------------------------------------------- */
class Ticker {
  constructor (trackSel, speed = 42) {
    const track = document.querySelector(trackSel);
    if (!track) return;
    const set = track.querySelector('.ticker__set');

    // duplicate until we have at least 2x viewport, then one more for the wrap
    while (track.scrollWidth < innerWidth * 2) {
      track.appendChild(set.cloneNode(true));
    }
    track.appendChild(set.cloneNode(true));

    if (REDUCED) return;

    const cycle = set.getBoundingClientRect().width;
    let x = 0, last = performance.now();

    const step = (now) => {
      const dt = (now - last) / 1000; last = now;
      x -= speed * dt;
      if (-x >= cycle) x += cycle;
      track.style.transform = `translate3d(${x}px,0,0)`;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}


/* ---------------------------------------------------------
   MobileNav — the link row becomes a drop panel under 900px
   --------------------------------------------------------- */
class MobileNav {
  constructor (navSel, burgerSel) {
    this.nav    = document.querySelector(navSel);
    this.burger = document.querySelector(burgerSel);
    if (!this.nav || !this.burger) return;

    this.burger.addEventListener('click', () => this.toggle());

    // any link closes it — they are all same-page anchors
    this.nav.querySelectorAll('.nav__links a')
      .forEach(a => a.addEventListener('click', () => this.close()));

    addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });

    // resizing past the breakpoint must not strand the panel open
    matchMedia('(min-width: 901px)').addEventListener('change', e => {
      if (e.matches) this.close();
    });
  }

  toggle () { this.nav.classList.contains('nav--open') ? this.close() : this.open(); }

  open () {
    this.nav.classList.add('nav--open');
    this.burger.setAttribute('aria-expanded', 'true');
    this.burger.setAttribute('aria-label', 'Close menu');
    document.body.classList.add('is-locked');
  }

  close () {
    if (!this.nav.classList.contains('nav--open')) return;
    this.nav.classList.remove('nav--open');
    this.burger.setAttribute('aria-expanded', 'false');
    this.burger.setAttribute('aria-label', 'Open menu');
    document.body.classList.remove('is-locked');
  }
}


/* ---------------------------------------------------------
   ScrollSpy — marks the nav link for the section in view
   --------------------------------------------------------- */
class ScrollSpy {
  constructor (linkSel = '.nav__links a[href^="#"]') {
    const links = [...document.querySelectorAll(linkSel)];
    const map = new Map();

    links.forEach(a => {
      const id = a.getAttribute('href').slice(1);
      const target = id && document.getElementById(id);
      if (target) map.set(target, a);
    });
    if (!map.size || !('IntersectionObserver' in window)) return;

    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        // `is-visible` is bookkeeping only; the class the CSS reads is set below
        e.target.dataset.inview = e.isIntersecting ? '1' : '';
      });

      // topmost section still on screen wins, so overlaps don't flicker
      const current = [...map.keys()]
        .filter(el => el.dataset.inview)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];

      links.forEach(a => a.classList.remove('is-active'));
      if (current) map.get(current).classList.add('is-active');
    }, { rootMargin: '-45% 0px -45% 0px' });

    map.forEach((_, section) => io.observe(section));
  }
}


/* ---------------------------------------------------------
   VideoFacade — poster now, iframe only once asked for

   Each tile is a plain link in the markup, so with JS off it still
   works; here we upgrade it to load the player in place.

   Two back ends. Which one a tile uses is decided by the page, via
   <html data-video="bilibili">, because YouTube is unreachable from
   mainland China and Bilibili is what that audience actually uses:

     data-yt   YouTube id   — used by the English page
     data-bv   Bilibili BV  — used by the Chinese page

   A Chinese tile whose BV id is not filled in yet is deliberately left
   alone: it stays an ordinary outbound YouTube link rather than
   becoming an embedded player that would never load in China.
   --------------------------------------------------------- */
class VideoFacade {
  constructor (sel = '[data-yt],[data-bv]') {
    // 'youtube' unless the page opts into Bilibili
    this.prefer = document.documentElement.dataset.video || 'youtube';

    document.querySelectorAll(sel).forEach(el => {
      const bv = (el.dataset.bv || '').trim();
      const yt = (el.dataset.yt || '').trim();

      // Bilibili page + a real BV id -> Bilibili. Otherwise YouTube, but
      // only when this page hasn't declared itself Bilibili-first.
      const useBili = this.prefer === 'bilibili' && bv;
      if (!useBili && this.prefer === 'bilibili') {
        el.classList.add('vid--pending');   // no BV id yet; leave the link be
        return;
      }
      if (!useBili && !yt) return;

      const label = el.querySelector('.vid__title');
      const name  = label ? label.textContent.trim() : 'video';
      el.setAttribute('aria-label',
        useBili ? `播放《${name}》（哔哩哔哩）` : `Play ${name} (YouTube)`);

      if (useBili) el.href = `https://www.bilibili.com/video/${bv}`;

      el.addEventListener('click', e => {
        // let modified clicks do the normal thing: open the site properly
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        this.embed(el, useBili ? { kind: 'bilibili', id: bv }
                               : { kind: 'youtube',  id: yt });
      });
    });
  }

  embed (el, src) {
    const frame = el.querySelector('.vid__frame');
    if (!frame || frame.dataset.loaded) return;
    frame.dataset.loaded = '1';

    const iframe = document.createElement('iframe');
    iframe.src = src.kind === 'bilibili'
      ? `https://player.bilibili.com/player.html?bvid=${src.id}&autoplay=1&high_quality=1`
      : `https://www.youtube-nocookie.com/embed/${src.id}?autoplay=1&rel=0`;
    iframe.title = el.getAttribute('aria-label') || 'video';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.loading = 'lazy';

    frame.replaceChildren(iframe);

    // it is a player now, not a link
    el.removeAttribute('href');
    el.removeAttribute('target');
    el.removeAttribute('aria-label');
  }
}


/* ---------------------------------------------------------
   boot
   --------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  const engine = new AudioEngine();
  new Waveform(document.getElementById('wave'), engine);
  new Tilt();
  new Reveal();
  new Ticker('#tickerTrack');
  new MobileNav('#nav', '#navBurger');
  new ScrollSpy();
  new VideoFacade();

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  const btn  = document.getElementById('playBtn');
  const note = document.getElementById('audioNote');

  // the button label and the audio note are the only strings JS writes,
  // so they have to follow the page's language like everything else
  const zh = document.documentElement.lang.toLowerCase().startsWith('zh');
  const T = zh
    ? { play: '播放', pause: '暂停',
        placeholder: '当前为占位环境音 — 正式音频待上线' }
    : { play: 'Play', pause: 'Pause',
        placeholder: 'Placeholder ambient pad — add a clip at audio/tony-browse.mp3' };

  engine.onstate = (playing, mode) => {
    btn.setAttribute('aria-pressed', String(playing));
    btn.querySelector('.btn__label').textContent = playing ? T.pause : T.play;
    if (playing && mode === 'synth') {
      note.hidden = false;
      note.textContent = T.placeholder;
    } else {
      note.hidden = true;
    }
  };

  btn.addEventListener('click', () => engine.toggle());

  // space bar toggles playback, as in the reference
  addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      engine.toggle();
    }
  });
});

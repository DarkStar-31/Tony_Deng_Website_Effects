/* =========================================================
   Tony D — hero prototype
   Class structure follows the Music Tools reference:
   AudioEngine / Waveform / Tilt / Reveal / Ticker
   ========================================================= */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* The hero queue is emitted into the page by build.py, out of
   content/shared.json plus the locale file — paths and titles are content,
   not code, and the two locales can label the same file differently.

   Whatever is actually on disk wins: entries that 404 are dropped at boot,
   and if none survive AudioEngine falls back to the synthesised pad. That
   matters because audio/ is gitignored, so a deploy can legitimately have
   no files at all. */
function readPlaylist () {
  const tag = document.getElementById('playlist');
  if (!tag) return [];
  try {
    const list = JSON.parse(tag.textContent);
    return Array.isArray(list) ? list.filter(t => t && t.src) : [];
  } catch {
    return [];              // a malformed queue must not take the page down
  }
}

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
    this.queue    = [];
    this.index    = 0;
    this.onstate  = () => {};
    this.ontrack  = () => {};
  }

  async _init () {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.analyser = this.ctx.createAnalyser();
    /* 4096 rather than 2048: the log band split below is finer than a
       23Hz bin down in the bass, so the extra resolution is the difference
       between a low end with detail and one with steps in it. */
    this.analyser.fftSize = 4096;
    /* Lower than the old line wanted: bars read as sluggish long before
       a waveform does. */
    this.analyser.smoothingTimeConstant = 0.75;

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

    /* Probe every entry at once and keep the ones really there, in the
       order content/ gave them. */
    const listed  = readPlaylist();
    const present = await Promise.all(listed.map(
      t => fetch(t.src, { method: 'HEAD' }).then(r => r.ok).catch(() => false)));
    this.queue = listed.filter((_, i) => present[i]);

    if (this.queue.length) {
      this.mode = 'file';
      /* One element for the whole queue, never one per track:
         createMediaElementSource can only be called once for a given
         element, so advancing means swapping .src on this one rather than
         re-wiring the graph — and the node count stays at one. */
      this.el = new Audio();
      this.el.crossOrigin = 'anonymous';
      this.el.preload = 'none';
      this.el.addEventListener('ended', () => this.next());
      // a file that fails to decode should cost one track, not the set
      this.el.addEventListener('error', () => { if (this.playing) this.next(); });
      this.ctx.createMediaElementSource(this.el).connect(this.master);
      this._cue(0);
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

  get track () { return this.queue[this.index] || null; }

  _cue (i) {
    const n = this.queue.length;
    this.index = ((i % n) + n) % n;          // wraps in both directions
    this.el.src = this.queue[this.index].src;
    this.ontrack(this.track, this.index, n);
  }

  /* Skipping ducks the level across the change. Two different songs butted
     straight together is far more jarring than the half-second it costs. */
  next () {
    if (this.mode !== 'file' || !this.queue.length) return;

    const t = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.0001, t + 0.18);

    this._cue(this.index + 1);
    if (!this.playing) return;

    this.el.play().catch(() => {});
    g.linearRampToValueAtTime(LEVEL, t + 0.72);   // resumes where the duck ended
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
   Spectrum — mirrored bar analyser with falling peak caps

   This replaced a single time-domain line. The line was accurate and
   read as "signal"; bars read as "music", which is what wants to be
   under an artist's name. Same magenta, same fade into both edges.
   --------------------------------------------------------- */
class Spectrum {
  constructor (canvas, engine) {
    if (!canvas) return;
    this.c      = canvas;
    this.ctx    = canvas.getContext('2d');
    this.engine = engine;
    this.t      = 0;
    this.peaks  = [];          // held peak per bar, in px
    this.vel    = [];          // and its fall speed — caps accelerate down
    this.mix    = 0;           // 0 = idle shape, 1 = live audio (eased)
    this.mixT   = 0;           // raw 0..1 progress behind it
    this.last   = 0;
    this.round  = typeof this.ctx.roundRect === 'function';

    this.resize();
    addEventListener('resize', () => this.resize());

    /* The hero is one screen of a long page, so most of a visit is spent
       with this off-screen. Cheap to check, and it takes the analyser and
       every bar out of the frame budget while it is out of sight. */
    this.visible = true;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(
        ([e]) => { this.visible = e.isIntersecting; },
        { threshold: 0 }
      ).observe(canvas);
    }

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

    /* Narrow screens get narrower bars rather than fewer, so the spectrum
       spans the full width at every size instead of trailing off. */
    this.bw  = this.w < 640 ? 3 : 5;
    this.gap = this.w < 640 ? 2 : 3;
    this.n   = Math.max(8, Math.floor(this.w / (this.bw + this.gap)));

    this.peaks = new Array(this.n).fill(0);
    this.vel   = new Array(this.n).fill(0);
    this.edges = null;                       // band edges depend on n

    /* Axis sits low: the upward bars are the subject and the downward
       reflection is a short echo of them, not a symmetrical twin.
       upMax is capped well under the axis height because the hero CTAs sit
       just above this canvas — a full-height bar reads straight through the
       ghost button, which is transparent. */
    this.mid   = this.h * 0.72;
    this.upMax = Math.min(this.mid - 8, this.h * 0.55);
    this.dnMax = (this.h - this.mid) - 3;

    const g = this.ctx.createLinearGradient(0, this.mid - this.upMax, 0, this.mid);
    g.addColorStop(0,   'rgba(255,150,210,.95)');   // hot tips
    g.addColorStop(0.45,'rgba(250,39,159,1)');
    g.addColorStop(1,   'rgba(250,39,159,.45)');    // roots dissolve into the scrim
    this.fill = g;
  }

  /* Log-spaced band edges. An even split across FFT bins puts almost
     everything a listener actually hears in the leftmost tenth of the
     canvas, which is why linear analysers always look bass-only. */
  _bands (bins, sampleRate) {
    if (this.edges) return this.edges;
    const LO = 32, HI = 14000, nyq = sampleRate / 2;
    const edges = new Float32Array(this.n + 1);
    for (let i = 0; i <= this.n; i++) {
      const f = LO * Math.pow(HI / LO, i / this.n);
      // kept fractional on purpose — see the sampling in loop()
      edges[i] = Math.min(bins - 1, (f / nyq) * bins);
    }
    return (this.edges = edges);
  }

  _bar (x, y, w, h) {
    if (this.round) this.ctx.roundRect(x, y, w, h, Math.min(w / 2, h / 2));
    else this.ctx.rect(x, y, w, h);
  }

  loop () {
    requestAnimationFrame(() => this.loop());
    if (!this.visible || !this.w) return;

    const { ctx, w, h, mid } = this;
    ctx.clearRect(0, 0, w, h);
    this.t += 0.02;

    const an   = this.engine.analyser;
    const want = (this.engine.playing && an) ? 1 : 0;

    /* Morph between the two shapes rather than swapping them. Play and
       pause used to cut straight from the idle swell to the audio and back,
       which landed as a glitch.

       Progress is linear over MORPH and then smoothstepped, rather than an
       exponential ease toward the target: exponential does about 15% of the
       move in the first frame, which is most of what made the old switch
       feel abrupt. Smoothstep leaves both ends gentle and the middle quick,
       and reverses cleanly if play is hit again mid-fade. Driven by elapsed
       time, so 30Hz and 120Hz take the same wall-clock duration. */
    const MORPH = 900;
    const now = performance.now();
    const dt  = this.last ? Math.min(64, now - this.last) : 16;
    this.last = now;

    this.mixT = Math.max(0, Math.min(1, this.mixT + (want ? dt : -dt) / MORPH));
    this.mix  = this.mixT * this.mixT * (3 - 2 * this.mixT);

    /* Keep reading the analyser all the way through a fade-out: the engine
       ramps its own gain down over about a second, so the bars settle with
       the sound instead of dropping out from under it. */
    const live = an && this.mixT > 0;

    let freq = null, edges = null, bins = 0;
    if (live) {
      bins = an.frequencyBinCount;
      if (!this.freq || this.freq.length !== bins) this.freq = new Uint8Array(bins);
      an.getByteFrequencyData(this.freq);
      freq  = this.freq;
      edges = this._bands(bins, an.context.sampleRate);
    }

    const step = this.bw + this.gap;
    const ups  = new Array(this.n);

    for (let i = 0; i < this.n; i++) {
      // the idle shape is always computed — it is half of the crossfade
      let idle;
      if (REDUCED) {
        idle = 0.10;                     // present, but holding still
      } else {
        // two slow travelling swells, so the row is never switched off
        idle = 0.06
          + 0.05 * (Math.sin(i * 0.22 - this.t * 1.6) + 1)
          + 0.03 * (Math.sin(i * 0.07 + this.t * 0.7) + 1);
      }

      let v = idle;
      if (live) {
        const a = edges[i], b = edges[i + 1];
        if (b - a < 1) {
          /* Band narrower than a single bin — true right across the bass,
             where the log split is finest. Reading one bin per bar there
             gives a dozen neighbours the same value and the low end comes
             out as a staircase, so interpolate between bins instead. */
          const c = (a + b) / 2, f0 = Math.floor(c), t = c - f0;
          const f1 = Math.min(f0 + 1, bins - 1);
          v = (freq[f0] * (1 - t) + freq[f1] * t) / 255;
        } else {
          let peak = 0;
          for (let k = Math.floor(a); k <= Math.ceil(b) && k < bins; k++) {
            if (freq[k] > peak) peak = freq[k];
          }
          v = peak / 255;
        }
        /* Recorded music carries far less energy up top; without a tilt
           the right two-thirds of the row barely moves. */
        v = Math.min(1, v * (1 + 1.15 * (i / this.n)));
        v = Math.pow(v, 1.35);          // deepens the floor so quiet ≠ a slab
        v = idle + (v - idle) * this.mix;
      }

      const up = Math.max(1.5, v * this.upMax);
      ups[i] = up;

      // caps latch onto a new high instantly, then fall under gravity
      if (up >= this.peaks[i]) { this.peaks[i] = up; this.vel[i] = 0; }
      else { this.vel[i] += 0.22; this.peaks[i] = Math.max(up, this.peaks[i] - this.vel[i]); }
    }

    /* Every bar goes into one path and one fill. The gradient is defined
       in canvas space, so batching costs nothing visually and saves a few
       hundred fill calls a frame. */
    ctx.shadowColor = 'rgba(250,39,159,.5)';
    ctx.shadowBlur  = 5 + 7 * this.mix;
    ctx.fillStyle   = this.fill;
    ctx.beginPath();
    for (let i = 0; i < this.n; i++) {
      this._bar(i * step + this.gap * 0.5, mid - ups[i], this.bw, ups[i]);
    }
    ctx.fill();

    // the reflection: shorter and dimmer, an echo rather than a mirror
    ctx.globalAlpha = 0.26;
    ctx.beginPath();
    for (let i = 0; i < this.n; i++) {
      const dn = Math.min(this.dnMax, ups[i] * 0.45);
      this._bar(i * step + this.gap * 0.5, mid + 3, this.bw, dn);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;

    // peak caps, bone rather than magenta so they read as a separate mark.
    // They fade with the crossfade rather than appearing all at once.
    if (this.mix > 0.01) {
      ctx.fillStyle = 'rgba(237,230,220,' + (0.8 * this.mix).toFixed(3) + ')';
      ctx.beginPath();
      for (let i = 0; i < this.n; i++) {
        this._bar(i * step + this.gap * 0.5, mid - this.peaks[i] - 4, this.bw, 2);
      }
      ctx.fill();
    }

    // baseline — the one thing carried over from the old line
    ctx.fillStyle = 'rgba(250,39,159,.22)';
    ctx.fillRect(0, mid, w, 1);

    /* Fade both ends into the page. Erasing afterwards keeps the vertical
       gradient on the bars, which a horizontal fillStyle would have
       replaced. */
    ctx.globalCompositeOperation = 'destination-out';
    const mask = ctx.createLinearGradient(0, 0, w, 0);
    mask.addColorStop(0,    'rgba(0,0,0,1)');
    mask.addColorStop(0.13, 'rgba(0,0,0,0)');
    mask.addColorStop(0.87, 'rgba(0,0,0,0)');
    mask.addColorStop(1,    'rgba(0,0,0,1)');
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
}


/* ---------------------------------------------------------
   HeightVar — publishes an element's height as a custom property

   Two things on this page have to be laid out around rather than guessed
   at: the sticky nav, which anchor targets and the sticky rails in About
   and Press must clear, and the awards ticker, whose height the hero gives
   up so the strip lands at the foot of the first screen. Both move with the
   viewport, the locale and their own type, so both are measured. The CSS
   carries fallbacks for before this runs.
   --------------------------------------------------------- */
class HeightVar {
  constructor (sel, prop) {
    const el = document.querySelector(sel);
    if (!el) return;

    const publish = () => {
      const h = el.offsetHeight;
      if (h) document.documentElement.style.setProperty(prop, h + 'px');
    };
    publish();

    /* What the property feeds (the hero's height, scroll margins) never
       feeds back into these two elements, so observing them cannot loop. */
    if ('ResizeObserver' in window) new ResizeObserver(publish).observe(el);
    else addEventListener('resize', publish);
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
  new HeightVar('#nav', '--nav-h');
  new HeightVar('#ticker', '--ticker-h');
  new Spectrum(document.getElementById('wave'), engine);
  new Tilt();
  new Reveal();
  new Ticker('#tickerTrack');
  new MobileNav('#nav', '#navBurger');
  new ScrollSpy();
  new VideoFacade();

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  const btn  = document.getElementById('playBtn');
  const skip = document.getElementById('skipBtn');
  const note = document.getElementById('audioNote');

  // the button label and the audio note are the only strings JS writes,
  // so they have to follow the page's language like everything else
  const zh = document.documentElement.lang.toLowerCase().startsWith('zh');
  const T = zh
    ? { play: '播放', pause: '暂停',
        placeholder: '当前为占位环境音 — 正式音频待上线' }
    : { play: 'Play', pause: 'Pause',
        placeholder: 'Placeholder ambient pad — drop MP3s in audio/' };

  // "Now playing" is content, so it rides in on the element, not in here
  const NOW = (note && note.dataset.now) || '';
  let current = null;

  engine.ontrack = (track) => {
    current = track;
    if (engine.playing) paint(true, engine.mode);
  };

  function paint (playing, mode) {
    btn.setAttribute('aria-pressed', String(playing));
    btn.querySelector('.btn__label').textContent = playing ? T.pause : T.play;

    // a queue of one has nothing to skip to
    if (skip) skip.hidden = !(mode === 'file' && engine.queue.length > 1);

    if (playing && mode === 'synth') {
      note.hidden = false;
      note.textContent = T.placeholder;
    } else if (playing && current) {
      note.hidden = false;
      note.textContent = NOW ? `${NOW} — ${current.title}` : current.title;
    } else {
      note.hidden = true;
    }
  }

  engine.onstate = paint;

  btn.addEventListener('click', () => engine.toggle());
  if (skip) skip.addEventListener('click', () => engine.next());

  // space bar toggles playback, as in the reference
  addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      engine.toggle();
    }
  });
});

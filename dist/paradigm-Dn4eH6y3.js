import { s as splitElement, R as REVEAL_FROM, a as REVEAL_TO } from './word-reveal-D8bOuPxk.js';

/*
  Component: paradigm · data-component="paradigm"
  Autoplay tabs with a per-number underline (grey track + black fill, active-only) and a
  per-word text de-blur on each switch. Two modes: VIDEO-DRIVEN (one shared <video>; the
  playhead crossing each tab's data-video-time cue swaps the text and fills the underline)
  or the legacy TIMER (text-scaled dwell + image crossfade).
  CSS → ./styles/paradigm.css (bundled via src/styles.js) · Docs → .claude/rules/components/paradigm.md
*/


const { gsap } = window;

// Tuning
const CUE_ATTR = 'data-video-time'; // seconds at which this tab's text becomes active
const CROSSFADE = 0.6; // visual crossfade (timer mode only)
const OUT_FADE = 0.3; // outgoing text fade
// Outgoing fill eases out instead of snapping full → empty in one frame (reads as a glitch).
const FILL_OUT = {
  scaleX: 0,
  duration: 0.35,
  ease: 'power2.in',
  overwrite: true,
};
// Timer-mode autoplay dwell scales with the tab's text length (more words → longer).
const AUTOPLAY_BASE = 3.5; // seconds baseline per tab
const AUTOPLAY_PER_WORD = 0.35; // extra seconds per word of the tab's message
const AUTOPLAY_MIN = 4; // floor
const AUTOPLAY_MAX = 11; // ceiling

const clamp01 = (n) => Math.min(1, Math.max(0, n));

// Per-tab autoplay seconds from its message word count (timer mode).
function autoplayDuration(el) {
  const words = (el?.textContent || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const d = AUTOPLAY_BASE + words * AUTOPLAY_PER_WORD;
  return Math.min(AUTOPLAY_MAX, Math.max(AUTOPLAY_MIN, d))
}

// Outgoing tab: plain fade only. The de-blur lives on the words, never the parent —
// a filter on the title element would linger and blur the words on re-entry.
const REVEAL_OUT = { autoAlpha: 0, duration: OUT_FADE };

// The single shared video: explicit hook (on the <video> or its wrapper) → any video in
// the visual wrapper → any video in the root.
function resolveVideo(root) {
  const hook = root.querySelector('[data-paradigm-video]');
  if (hook) return hook.matches('video') ? hook : hook.querySelector('video')
  return (
    root.querySelector('.tabs-paradigm_visual-wrapper video') ||
    root.querySelector('video')
  )
}

function setupRoot(root) {
  const titles = gsap.utils.toArray(
    root.querySelectorAll('[data-paradigm="tab-title"]')
  );
  const messages = titles.map(
    (t) => t.querySelector('[data-paradigm-message]') || t
  );
  const links = gsap.utils.toArray(
    root.querySelectorAll('[data-paradigm="tab-link"]')
  );
  const visuals = gsap.utils.toArray(
    root.querySelectorAll('[data-paradigm-visual]')
  );
  const messagesWrap = root.querySelector('[data-paradigm-messages]');
  const visualsWrap = root.querySelector('.tabs-paradigm_visual-wrapper');

  const video = resolveVideo(root);
  // Video mode: the playhead owns the timing, so the visuals aren't paired per tab and
  // don't count towards the tab count.
  const count = video
    ? Math.min(titles.length, links.length)
    : Math.min(titles.length, links.length, visuals.length);
  if (count < 1) {
    console.warn(
      video
        ? '[paradigm] needs at least one tab-title / tab-link'
        : '[paradigm] needs at least one tab-title / tab-link / visual'
    );
    return null
  }

  root.classList.add('is-enhanced');

  // Per-number underline (active-only): inject a grey track + black fill into each number.
  // Only the active number's fill grows 0→1; the rest stay empty (inactive). Replaces the
  // single full-width .tabs_number-underline (hidden via CSS).
  const bars = links.slice(0, count).map((link) => {
    const track = document.createElement('span');
    track.className = 'tabs-paradigm_tab-link-underline is-track';
    const fill = document.createElement('span');
    fill.className = 'tabs-paradigm_tab-link-fill';
    track.appendChild(fill);
    link.appendChild(track);
    return fill
  });

  const wordsByTab = messages.slice(0, count).map(splitElement);

  // Initial states (before autoplay starts)
  gsap.set(titles, { autoAlpha: 0 });
  gsap.set(wordsByTab.flat(), REVEAL_FROM);
  gsap.set(bars, { scaleX: 0, transformOrigin: 'left center' });
  if (video) {
    // One asset for the whole section: show the visual holding the video, hide any leftover.
    const videoVisual = visuals.find((v) => v.contains(video));
    gsap.set(visuals, { autoAlpha: 0 });
    gsap.set(videoVisual || visuals, { autoAlpha: 1 });
  } else {
    gsap.set(visuals, { autoAlpha: 0 });
  }

  let index = 0;
  let started = false;
  let progressTl = null; // timer mode only
  let onScreen = false;
  let hover = false;
  let docVisible = !document.hidden;

  // Cue times (segment starts), seconds. Explicit from data-video-time on the link (title as
  // fallback), else the video duration split evenly — resolved once metadata is known.
  let cues = links.map((_, i) => i);
  let duration = 0;
  const evenSplit = (i) => (duration ? (i * duration) / count : i);
  const resolveCues = () => {
    duration = video && isFinite(video.duration) ? video.duration : 0;
    cues = links.slice(0, count).map((link, i) => {
      const raw = parseFloat(
        link.getAttribute(CUE_ATTR) ?? titles[i]?.getAttribute(CUE_ATTR)
      );
      return isFinite(raw) ? raw : evenSplit(i)
    });
    // Cues must strictly increase — they're segment STARTS. The same value on every tab
    // (a Webflow class/component edit applying one attribute to all of them) makes every
    // segment zero-length and strands the last tab active with the others empty. Warn and
    // fall back to an even split rather than shipping a section that looks broken.
    if (cues.some((c, i) => i > 0 && c <= cues[i - 1])) {
      console.warn(
        `[paradigm] ${CUE_ATTR} must increase per tab (got ${cues.join(', ')}) — falling back to an even split`
      );
      cues = links.slice(0, count).map((_, i) => evenSplit(i));
    }
  };
  const cueStart = (i) => cues[i] || 0;
  const cueEnd = (i) => (i < count - 1 ? cues[i + 1] : duration || cueStart(i));

  // Segment the playhead falls into (last cue <= t).
  const indexForTime = (t) => {
    let idx = 0;
    for (let i = 0; i < count; i++) if (t >= cueStart(i) - 0.001) idx = i;
    return idx
  };

  const playVideo = () => {
    const p = video.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  };

  // Video mode has no hover pause — hovering the section leaves the video playing.
  const shouldPlay = () =>
    started && onScreen && docVisible && (!!video || !hover);
  const sync = () => {
    const go = shouldPlay();
    if (video) go ? playVideo() : video.pause();
    else if (progressTl) go ? progressTl.play() : progressTl.pause();
  };

  const activate = (i) => {
    links.forEach((l, k) => {
      l.classList.toggle('is-active', k === i);
      l.setAttribute('aria-current', k === i ? 'true' : 'false');
    });

    titles.forEach((t, k) => {
      if (k !== i) gsap.to(t, REVEAL_OUT);
    });
    gsap.set(titles[i], { autoAlpha: 1 });
    gsap.set(wordsByTab[i], REVEAL_FROM);
    gsap.to(wordsByTab[i], REVEAL_TO);

    // Timer mode only — in video mode the single asset stays put.
    if (!video)
      visuals.forEach((v, k) =>
        gsap.to(v, {
          autoAlpha: k === i ? 1 : 0,
          duration: CROSSFADE,
          ease: 'sine.out',
        })
      );
  };

  // Every non-active number's fill eases out to empty (inactive).
  const setStaticFills = (i) => {
    bars.forEach((bar, k) => {
      if (k === i) return
      gsap.to(bar, FILL_OUT);
    });
  };

  // Reset the incoming bar to empty, dropping any FILL_OUT still easing it out (a switch
  // back inside that window would otherwise fight the fill).
  const armFill = (i) => {
    const bar = bars[i];
    if (!bar) return
    gsap.killTweensOf(bar);
    gsap.set(bar, { scaleX: 0, transformOrigin: 'left center' });
  };

  // Timer mode: underline = autoplay progress, active-only. Only the active number's fill
  // grows 0→1 over its text-scaled dwell; the others stay empty. Advances on complete.
  const runProgress = () => {
    progressTl && progressTl.kill();
    setStaticFills(index);
    armFill(index);
    progressTl = gsap.timeline({ onComplete: () => goTo((index + 1) % count) });
    progressTl.to(
      bars[index],
      { scaleX: 1, duration: autoplayDuration(messages[index]), ease: 'none' },
      0
    );
    sync();
  };

  function goTo(i) {
    index = i;
    activate(i);
    if (video) {
      setStaticFills(i);
      armFill(i); // the ticker fills it from the playhead
    } else {
      runProgress();
    }
  }

  // rAF driver (video mode): switch the text when the playhead crosses a cue, and fill the
  // active tab's underline across the current segment. The ticker (not `timeupdate`, ~4x/s)
  // keeps the fill smooth through pause/resume and buffering.
  const tick = () => {
    if (!started) return
    const t = video.currentTime;
    const i = indexForTime(t);
    if (i !== index) goTo(i);
    const bar = bars[i];
    if (!bar) return
    const s = cueStart(i);
    const span = cueEnd(i) - s;
    gsap.set(bar, { scaleX: span > 0 ? clamp01((t - s) / span) : 0 });
  };

  const start = () => {
    if (started) return
    started = true;
    if (video) resolveCues();
    goTo(0);
    if (video) sync();
  };

  // User-driven switch (click / keyboard) — also kicks off autoplay if not started yet.
  const select = (i) => {
    const first = !started;
    started = true;
    if (video) {
      if (first) resolveCues();
      try {
        video.currentTime = cueStart(i); // the ticker picks up the text + fill
      } catch {
        /* not seekable yet */
      }
      goTo(i);
      sync();
      return
    }
    goTo(i);
  };

  const wireButton = (el, onActivate, label) => {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', label);
    el.addEventListener('click', onActivate);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    });
  };

  // Clicking a number in the menu jumps to that tab.
  links.forEach((l, i) =>
    wireButton(l, () => select(i), 'Go to slide ' + (i + 1))
  );

  // Prep the shared video: muted + inline (autoplay-with-sound is blocked, so the playhead
  // would never move and the text would never change), LOOP on so it wraps back to tab 1.
  if (video) {
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.addEventListener('loadedmetadata', resolveCues);
    if (isFinite(video.duration) && video.duration > 0) resolveCues();
    gsap.ticker.add(tick);
  }

  // Visibility / hover / tab-focus gating
  const io = new window.IntersectionObserver(
    (entries) => {
      onScreen = entries[0].isIntersecting;
      if (onScreen && !started) start();
      else sync();
    },
    {
      // threshold stays 0 + a negative rootMargin: intersectionRatio is capped at
      // viewportHeight/elementHeight, so a section taller than ~2.5x the viewport
      // (routine on mobile) never reaches a 0.4 threshold and this never fires.
      threshold: 0,
      rootMargin: '-25% 0px -25% 0px',
    }
  );
  io.observe(root);

  // Timer mode: pause only while hovering the content (text + visual), not the whole
  // section. Video mode keeps playing on hover.
  if (!video) {
[messagesWrap, visualsWrap].forEach((el) => {
      if (!el) return
      el.addEventListener('mouseenter', () => {
        hover = true;
        sync();
      });
      el.addEventListener('mouseleave', () => {
        hover = false;
        sync();
      });
    });
  }
  document.addEventListener('visibilitychange', () => {
    docVisible = !document.hidden;
    sync();
  });
}

// Static fallback (no GSAP / reduced motion): show the first tab only via classes.
function staticFallback(root) {
  const first = (sel) => root.querySelector(sel);
  first('[data-paradigm="tab-title"]')?.classList.add('is-active');
  first('[data-paradigm="tab-link"]')?.classList.add('is-active');
  first('[data-paradigm-visual]')?.classList.add('is-active');
  root.classList.add('is-static');
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='paradigm']
 */
function paradigm (elements) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!gsap || reduce) {
    if (!gsap)
      console.warn('[paradigm] GSAP not found on window — static fallback');
    elements.forEach(staticFallback);
    return
  }

  elements.forEach(setupRoot);
}

export { paradigm as default };
//# sourceMappingURL=paradigm-Dn4eH6y3.js.map

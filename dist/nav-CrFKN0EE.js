/*
  Component: nav · data-component="nav"
  On scroll the bar morphs into a centred frosted-glass pill (GSAP Flip on desktop,
  CSS-only glass on mobile) and reverts at the top. Runs on all breakpoints.
  CSS → ./styles/nav.css (paste into Webflow head; keep --nav-morph in sync with
  FLIP_DURATION) · Docs → .claude/rules/components/nav.md
*/

const { gsap, Flip } = window;

// Hysteresis deadzone: float past *_ON, revert below *_OFF. Mobile ON is much higher
// because the address bar swings the viewport over the first scroll (morphing mid-swing read as jumpy).
const FLOAT_ON_DESKTOP = 24; // px scrolled before the bar floats (desktop)
const FLOAT_OFF_DESKTOP = 4; // px — revert near the very top (desktop)
const FLOAT_ON_MOBILE = 80; // px — clear the address-bar-collapse zone first
const FLOAT_OFF_MOBILE = 8; // px — a touch higher to absorb top overscroll
const FLIP_DURATION = 1;
const FLIP_EASE = 'power2.inOut';

// Load entrance — the nav drops in from above the viewport.
const ENTRANCE = {
  yPercent: -100,
  duration: 0.9,
  ease: 'power3.out',
  delay: 0.1,
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Wire one nav root. Returns { enable, disable } for gsap.matchMedia to switch per breakpoint.
function setupNav(root) {
  const inner = root.querySelector('[data-nav-inner]');
  if (!inner) {
    console.warn('[nav] missing [data-nav-inner] — skipping');
    return null
  }

  const logo = inner.querySelector('[data-nav-logo]');

  // DEBUG — dump the computed CSS applied to root/bar/glass/logo + the bar's real top.
  const logCss = (label) => {
    const r = window.getComputedStyle(root);
    const i = window.getComputedStyle(inner);
    const b = window.getComputedStyle(inner, '::before');
    const l = logo ? window.getComputedStyle(logo) : null;
    const rect = inner.getBoundingClientRect();
    console.log(`%c[nav] ${label}`, 'color:#a78bfa;font-weight:bold');
    console.table({
      'root.position': r.position,
      'root.width': r.width,
      'root.paddingTop': r.paddingTop,
      'root.paddingBottom': r.paddingBottom,
      'token --nav-rest-top':
        r.getPropertyValue('--nav-rest-top').trim() || '(unset)',
      'token --nav-float-top':
        r.getPropertyValue('--nav-float-top').trim() || '(unset)',
      'inner.position': i.position,
      'inner.display': i.display,
      'inner.width': i.width,
      'inner.margin': i.margin,
      'inner.padding': i.padding,
      'inner.top (px from viewport)': Math.round(rect.top),
      'inner.left (px)': Math.round(rect.left),
      'glass.opacity': b.opacity,
      'glass.borderRadius': b.borderRadius,
      'logo.transform': l ? l.transform : '—',
    });
  };

  let isFloating = null; // null until first sync
  let flip = null; // current Flip tween, so a fast reverse can interrupt it
  let floatOn = FLOAT_ON_DESKTOP; // set per breakpoint in enable()
  let floatOff = FLOAT_OFF_DESKTOP;
  let useFlip = true; // desktop morphs with Flip; mobile uses CSS-only glass
  let rafId = null;
  const stopDebug = () => {
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = null;
  };

  const setFloating = (floating, animate) => {
    if (floating === isFloating) return
    isFloating = floating;

    // Class-only path: initial sync, reduced motion, AND mobile/tablet. Mobile morph
    // is pure CSS (no Flip getState/re-measure for the address-bar resize to corrupt).
    if (!animate || reduceMotion.matches || !useFlip) {
      inner.classList.toggle('is-floating', floating);
      return
    }

    // Center variant reflows its inner content (spread ↔ clustered pill), so capture the
    // moving wrappers too and let Flip tween them — otherwise the content snaps.
    const extra =
      root.getAttribute('data-nav-center') === 'True'
        ? gsap.utils
            .toArray(
              inner.querySelectorAll(
                '.nav_container, .nav_menu, .nav_menu-inner, .nav_links-wrapper, .nav_button-wrapper, .nav_brand'
              )
            )
            .filter((el) => el.getClientRects().length)
        : [];
    const state = Flip.getState(extra.length ? [inner, ...extra] : inner);
    inner.classList.toggle('is-floating', floating);
    flip && flip.kill();
    flip = Flip.from(state, {
      duration: FLIP_DURATION,
      ease: FLIP_EASE,
      absolute: true,
      nested: true,
      onComplete: () => {
        logCss(floating ? 'settled → FLOATING' : 'settled → REST');
      },
    });
  };

  // rAF-throttled scroll read — hysteresis flips the float state only when leaving the deadzone.
  let ticking = false;
  const onScroll = () => {
    if (ticking) return
    ticking = true;
    window.requestAnimationFrame(() => {
      const y = Math.max(0, window.scrollY);
      let next = isFloating;
      if (!isFloating && y > floatOn) next = true;
      else if (isFloating && y < floatOff) next = false;
      setFloating(next, true);
      ticking = false;
    });
  };

  return {
    enable(opts = {}) {
      floatOn = opts.floatOn ?? FLOAT_ON_DESKTOP;
      floatOff = opts.floatOff ?? FLOAT_OFF_DESKTOP;
      useFlip = opts.useFlip ?? true;
      // Feed nav_component's real padding-top to the CSS so the floating bar lands
      // at --nav-float-top whatever the Webflow padding (no token ↔ padding coupling).
      root.style.setProperty(
        '--nav-rest-top',
        window.getComputedStyle(root).paddingTop
      );
      window.addEventListener('scroll', onScroll, { passive: true });
      setFloating(window.scrollY > floatOff, false); // sync without animating (handles reload mid-page)
      logCss(isFloating ? 'init → FLOATING' : 'init → REST');
    },
    disable() {
      window.removeEventListener('scroll', onScroll);
      flip && flip.kill();
      inner.classList.remove('is-floating');
      isFloating = null;
      gsap.set(root, { clearProps: 'transform' }); // clear the entrance transform on breakpoint switch
      stopDebug(); // DEBUG
    },
  }
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='nav']
 */
function nav (elements) {
  if (!gsap || !Flip) {
    console.warn('[nav] GSAP / Flip not found on window — skipping');
    return
  }
  gsap.registerPlugin(Flip);

  const navs = elements.map(setupNav).filter(Boolean);
  if (!navs.length) return

  // Load entrance: drop the nav in from above (gate lifted first). clearProps drops
  // the leftover transform so it can't break the floating glass backdrop-filter.
  gsap.set(elements, { autoAlpha: 1 });
  if (!reduceMotion.matches) {
    gsap.from(elements, { ...ENTRANCE, clearProps: 'transform' });
  }

  // Two matchMedia branches run the same enable/disable, split at 992px so crossing
  // re-runs enable() + re-measures --nav-rest-top. Geometry differs purely in CSS.
  const activate = (opts) => {
    navs.forEach((n) => n.enable(opts));
    return () => navs.forEach((n) => n.disable())
  };
  const mm = gsap.matchMedia();
  mm.add('(min-width: 992px)', () =>
    activate({
      floatOn: FLOAT_ON_DESKTOP,
      floatOff: FLOAT_OFF_DESKTOP,
      useFlip: true, // desktop: Flip handles the edge-left → centre slide
    })
  );
  mm.add('(max-width: 991px)', () =>
    activate({
      floatOn: FLOAT_ON_MOBILE,
      floatOff: FLOAT_OFF_MOBILE,
      useFlip: false, // mobile: CSS-only transform morph (robust to address-bar resize)
    })
  );
}

export { nav as default };
//# sourceMappingURL=nav-CrFKN0EE.js.map

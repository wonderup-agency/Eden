/*
  Component: logo-wall · data-component="logo-wall"
  Grid of slots: most cycle logos in a loop (from a pool of virtual clones); the
  .is-last target stays fixed. On hover/focus the wall pauses and that slot's
  testimonial replaces the logo.
  CSS → ./styles/logo-wall.css (paste into Webflow head; keep --logo-wall-fade ~
  SWAP_DURATION) · Docs → .claude/rules/components/logo-wall.md
*/

const { gsap } = window;

const LOOP_DELAY = 1.5; // seconds between swaps
const SWAP_DURATION = 1.1; // logo roll duration — longer = gentler
const SWAP_TRAVEL = 100; // % of slot height — full roll so logos never crowd the centre
const SWAP_EASE = 'power2.inOut'; // even motion across the roll (expo crossed too fast)

// Logo ⇄ testimonial hover crossfade (GSAP fades the logo; CSS de-blurs the testimonial).
const LOGO_FADE = 0.5; // keep ~ --logo-wall-fade (CSS)
const LOGO_EASE = 'power2.inOut';

// Data hook preferred; falls back to the current Webflow class.
const TESTIMONIAL_SELECTOR =
  '[data-logo-wall-testimonial], .logo-wall_testimonial';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]];
  }
  return a
}

// Resolve a wall's slots → { parent, target, testimonial, isFixed }.
function resolveSlots(root) {
  const list = root.querySelector('[data-logo-wall-list]');
  if (!list) {
    console.warn('[logo-wall] missing [data-logo-wall-list] — skipping');
    return null
  }

  const slots = Array.from(list.querySelectorAll('[data-logo-wall-item]'))
    .map((item) => {
      const parent =
        item.querySelector('[data-logo-wall-target-parent]') || item;
      const target = parent.querySelector('[data-logo-wall-target]');
      // Testimonial may sit inside the slot or as a sibling — normalize it into the slot.
      const testimonial = item.querySelector(TESTIMONIAL_SELECTOR);
      if (testimonial && testimonial.parentElement !== parent) {
        parent.appendChild(testimonial);
      }
      // Fixed slot = CMS-bound data-logo-last on the item or target, or the legacy
      // .is-last class. Accepts 'Last' (the value bound from the CMS Name field) and
      // 'True'/'true'; empty (a non-fixed record) is NOT fixed. Case-insensitive.
      const isLast = (el) => {
        if (!el) return false
        const v = (el.getAttribute('data-logo-last') || '').toLowerCase();
        return v === 'last' || v === 'true'
      };
      const isFixed =
        isLast(item) ||
        isLast(target) ||
        (!!target && target.classList.contains('is-last'));
      return { item, parent, target, testimonial, isFixed }
    })
    .filter((s) => s.target);

  return slots.length ? slots : null
}

// Reveal / hide a slot's current testimonial.
function showTestimonial(slot) {
  if (!slot.current || !slot.current.testimonial) return
  slot.parent.classList.add('is-showing-testimonial');
  slot.current.testimonial.classList.add('is-visible');
  slot.current.testimonial.setAttribute('aria-hidden', 'false');
  // Fade the logo out as the testimonial de-blurs in. fromTo forces the start at
  // full so GSAP doesn't read the CSS-hidden state as 0 and skip the tween.
  if (!reduceMotion.matches) {
    gsap.fromTo(
      slot.current.target,
      { autoAlpha: 1 },
      { autoAlpha: 0, duration: LOGO_FADE, ease: LOGO_EASE }
    );
  }
}

function hideTestimonial(slot) {
  slot.parent.classList.remove('is-showing-testimonial');
  if (slot.current && slot.current.testimonial) {
    slot.current.testimonial.classList.remove('is-visible');
    slot.current.testimonial.setAttribute('aria-hidden', 'true');
  }
  // Fade the logo back in as the testimonial fades out.
  if (slot.current && slot.current.target && !reduceMotion.matches) {
    gsap.to(slot.current.target, {
      autoAlpha: 1,
      duration: LOGO_FADE,
      ease: LOGO_EASE,
    });
  }
}

function setupLogoWall(root) {
  const entries = resolveSlots(root);
  if (!entries) return

  // Split the entries into the visible grid slots and a surplus queue. The queue
  // is real, unique logos that AREN'T on screen — so rotation never repeats a logo.
  // Visible cycling positions = data-logo-wall-slots (cycling only); default = every
  // cycling entry → no surplus → the wall stays static (paused). "7 logos → paused".
  const cyclingAll = entries.filter((e) => !e.isFixed);
  // Diagnostic: data-logo-last must mark ONE item. If every item is flagged, the CMS
  // binding is static ('True' on all) instead of bound to a per-record field → nothing cycles.
  if (!cyclingAll.length && entries.length > 1) {
    console.warn(
      '[logo-wall] every item is marked data-logo-last="True" — bind that attribute ' +
        'to a CMS field so only the fixed item carries it; otherwise nothing cycles'
    );
  }
  const visibleCount =
    parseInt(root.getAttribute('data-logo-wall-slots'), 10) || cyclingAll.length;
  const cycling = cyclingAll.slice(0, visibleCount);
  const surplus = cyclingAll.slice(visibleCount);

  // Pull the surplus logos out of the grid — they exist only in the rotation queue.
  surplus.forEach((e) => e.item.remove());

  // Pin the fixed slot(s) to the end of the list so it's always the last visible
  // cell (the 4th, with 3 cycling before it) regardless of CMS order. It's never
  // cycled nor queued, so it stays put and visible forever.
  entries
    .filter((e) => e.isFixed)
    .forEach((e) => e.item.parentElement.appendChild(e.item));

  // The slots that occupy the grid (visible cycling + the fixed one).
  const slots = entries.filter((e) => cycling.includes(e) || e.isFixed);

  // Every slot (cycling AND fixed) can reveal its testimonial on hover; only cycling
  // slots join the loop, fed by the surplus queue.
  slots.forEach((slot, i) => {
    slot.current = { target: slot.target, testimonial: slot.testimonial };
    slot.busy = false;
    slot.hovered = false;
    // Force every original logo visible — Webflow starts some at opacity:0 on certain
    // breakpoints, which left them blank until their first swap.
    if (!reduceMotion.matches) gsap.set(slot.target, { autoAlpha: 1 });
    // Reset to the rest state — the Designer may ship the hover-state classes baked in
    // (is-showing-testimonial / is-visible), which would leave the testimonial shown.
    slot.parent.classList.remove('is-showing-testimonial');
    if (slot.testimonial) {
      slot.testimonial.classList.remove('is-visible');
      slot.testimonial.setAttribute('aria-hidden', 'true');
    } else console.warn(`[logo-wall] slot ${i} has no testimonial`);
  });
  console.log(
    `[logo-wall] resolved ${slots.length} slots — ${cycling.length} cycling, ${
      slots.length - cycling.length
    } fixed, ${surplus.length} surplus in queue`
  );

  // Hover / focus → pause the wall + show that slot's testimonial.
  let loopTl = null;
  let onScreen = false;

  const maybeResume = () => {
    if (!loopTl) return
    // Hovering ANY slot (including the fixed one) keeps the wall paused.
    const anyHovered = slots.some((s) => s.hovered);
    if (onScreen && !document.hidden && !anyHovered) loopTl.play();
  };

  const setActive = (slot, on) => {
    if (slot.hovered === on) return
    slot.hovered = on;
    if (on) {
      console.log('[logo-wall] hover → pause + show testimonial');
      loopTl && loopTl.pause();
      // Finish any in-flight swap so the wall is settled before the testimonial shows
      // (swap tweens run outside loopTl, so pausing the loop alone wouldn't stop a roll).
      cycling.forEach((s) => s.finishSwap && s.finishSwap());
      showTestimonial(slot);
    } else {
      console.log('[logo-wall] unhover → resume');
      hideTestimonial(slot);
      maybeResume();
    }
  };

  // Wire hover/focus on every slot with a testimonial (including the fixed one).
  slots.forEach((slot) => {
    if (!slot.testimonial) return
    slot.parent.setAttribute('tabindex', '0');
    slot.parent.addEventListener('mouseenter', () => setActive(slot, true));
    slot.parent.addEventListener('mouseleave', () => setActive(slot, false));
    slot.parent.addEventListener('focusin', () => setActive(slot, true));
    slot.parent.addEventListener('focusout', () => setActive(slot, false));
  });

  // No loop when: reduced motion, no cycling slots, OR no surplus logos to rotate in.
  // With as many logos as slots there's nothing to swap without repeating → paused.
  if (reduceMotion.matches || cycling.length < 1 || surplus.length < 1) return

  // The rotation queue: the real surplus logos, none currently on screen. A swap
  // pulls the front and sends the outgoing logo to the back, so the displayed set
  // and the queue stay disjoint — a logo is never shown twice at once.
  let pool = surplus.map((e) => ({
    target: e.target,
    testimonial: e.testimonial,
  }));
  pool.forEach((entry) => {
    if (entry.testimonial) {
      entry.testimonial.classList.remove('is-visible');
      entry.testimonial.setAttribute('aria-hidden', 'true');
    }
  });
  console.log(`[logo-wall] rotation queue → ${pool.length} unique logos`);

  const shuffleEnabled = root.getAttribute('data-logo-wall-shuffle') !== 'false';
  if (shuffleEnabled) pool = shuffle(pool);

  root.classList.add('is-cycling');

  // Slide the current logo out and the next pool entry in. Its testimonial rides
  // along (hidden) so a later hover matches the logo that settled here.
  function swapSlot(slot) {
    if (slot.busy || !pool.length) return
    slot.busy = true;

    const incoming = pool.shift();
    const outgoing = slot.current;

    if (incoming.testimonial) {
      incoming.testimonial.classList.remove('is-visible');
      slot.parent.appendChild(incoming.testimonial);
    }

    // Incoming overlays absolutely (is-incoming) so it doesn't push the slot; both
    // roll up together, clipped by the slot's overflow:hidden.
    incoming.target.classList.add('is-incoming');
    gsap.set(incoming.target, { yPercent: SWAP_TRAVEL, autoAlpha: 0 });
    slot.parent.appendChild(incoming.target);

    // Settle the swap to its final DOM state. Idempotent (guards on slot.busy) so it's
    // safe from both onComplete and a hover-forced finishSwap(). clearProps wipes
    // GSAP's inline opacity so the CSS hover-hide can win.
    const finish = () => {
      if (!slot.busy) return
      // Promote incoming to the in-flow sizer, drop outgoing same tick (slot keeps height).
      incoming.target.classList.remove('is-incoming');
      outgoing.target.remove();
      if (outgoing.testimonial) outgoing.testimonial.remove();
      gsap.set(outgoing.target, { clearProps: 'all' });
      gsap.set(incoming.target, { clearProps: 'all' });
      pool.push(outgoing);
      slot.current = incoming;
      slot.busy = false;
      if (slot.swapTl) {
        slot.swapTl.kill();
        slot.swapTl = null;
      }
      slot.finishSwap = null;
    };
    slot.finishSwap = finish;

    // One timeline owns both rolls so a hover can snap the swap to its end (finishSwap).
    slot.swapTl = gsap
      .timeline({ onComplete: finish })
      .to(
        incoming.target,
        { yPercent: 0, autoAlpha: 1, duration: SWAP_DURATION, ease: SWAP_EASE },
        0
      )
      .to(
        outgoing.target,
        {
          yPercent: -SWAP_TRAVEL,
          autoAlpha: 0,
          duration: SWAP_DURATION,
          ease: SWAP_EASE,
        },
        0
      );
  }

  // One slot rotates per tick, in shuffled order.
  let pattern = shuffle(cycling.map((_, i) => i));
  let patternIndex = 0;

  loopTl = gsap.timeline({ repeat: -1, repeatDelay: LOOP_DELAY, paused: true });
  loopTl.call(() => {
    if (cycling.some((s) => s.hovered)) return
    const slotIndex = pattern[patternIndex % cycling.length];
    patternIndex++;
    console.log(
      `[logo-wall] tick → swap slot ${slotIndex} (pool ${pool.length})`
    );
    swapSlot(cycling[slotIndex]);
  });

  // Play only while on-screen (IntersectionObserver self-starts if already visible).
  const io = new window.IntersectionObserver(
    (entries) => {
      onScreen = entries[0].isIntersecting;
      console.log(`[logo-wall] visibility → onScreen ${onScreen}`);
      if (onScreen) maybeResume();
      else loopTl.pause();
    },
    { threshold: 0 }
  );
  io.observe(root);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loopTl.pause();
    else maybeResume();
  });
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='logo-wall']
 */
function logoWall (elements) {
  if (!gsap) {
    console.warn('[logo-wall] GSAP not found on window — skipping');
    return
  }
  console.log(`[logo-wall] loaded — ${elements.length} wall(s)`);
  elements.forEach(setupLogoWall);
}

export { logoWall as default };
//# sourceMappingURL=logo-wall-DmPrD9nw.js.map

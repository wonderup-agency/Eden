/*
Shared word-split + de-blur reveal helpers (the paradigm text effect).
Used by title-animation and hero so the reveal stays identical and DRY.
*/

// Sharpen from a soft blur while fading + rising.
const REVEAL_FROM = { autoAlpha: 0, filter: 'blur(16px)', yPercent: 16 };
const REVEAL_TO = {
  autoAlpha: 1,
  filter: 'blur(0px)',
  yPercent: 0,
  duration: 1.1,
  stagger: 0.09,
  ease: 'sine.out',
};

const HEADING_SEL = 'h1,h2,h3,h4,h5,h6';

// Resolve the real text node(s) inside a marked element (rich-text friendly):
// headings first, else paragraphs, else the element itself.
function textTargets(el) {
  if (el.matches(`${HEADING_SEL},p`)) return [el]
  const heads = el.querySelectorAll(HEADING_SEL);
  if (heads.length) return Array.from(heads)
  const paras = el.querySelectorAll('p');
  if (paras.length) return Array.from(paras)
  return [el]
}

// Wrap each word of `el` in an inline-block span (styles inline → no external CSS).
function splitWords(el) {
  const words = el.textContent.trim().split(/\s+/);
  if (!words[0]) return []
  el.textContent = '';
  return words.map((text, i) => {
    const span = document.createElement('span');
    span.className = 'title-anim_word';
    span.style.display = 'inline-block';
    span.style.willChange = 'transform, filter, opacity';
    span.textContent = text;
    el.appendChild(span);
    if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
    return span
  })
}

// Split a marked element into per-word spans across all its text targets.
function splitElement(el) {
  return textTargets(el).flatMap(splitWords)
}

export { REVEAL_FROM as R, REVEAL_TO as a, splitElement as s };
//# sourceMappingURL=word-reveal-D8bOuPxk.js.map

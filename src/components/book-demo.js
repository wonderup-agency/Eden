/*
  Component: book-demo · data-component="book-demo"
  The Book a Demo form: drives the two custom dropdowns (the chosen value is mirrored
  into the hidden Webflow <select>, which is what actually gets submitted) and owns the
  validation, since the visible controls are divs the browser cannot validate.
  CSS → ./styles/book-demo.css · Docs → .claude/rules/components/book-demo.md
*/

const OPEN = 'is-open' // on [data-dropdown]
const FILLED = 'is-filled' // on the control — placeholder grey → ink
const ERROR = 'is-error' // on the field
const SELECTED = 'is-selected' // the chosen option
const ACTIVE = 'is-active' // the keyboard-highlighted option
const INTL = 'is-intl' // on the phone control once intl-tel-input has taken over

// Every field is required by DEFAULT — opt out with data-optional on the input /
// dropdown, its control or its field.
const OPTIONAL = '[data-optional]'

const MESSAGES = {
  required: 'This field is required.',
  choose: 'Please choose an option.',
  email: 'Enter a valid email address.',
  phone: 'Enter a valid phone number.',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_MIN_DIGITS = 7 // loosest sane check — no country rules until intl-tel-input
const SKIP_TYPES = new Set([
  'hidden',
  'submit',
  'button',
  'reset',
  'checkbox',
  'radio',
  'file',
])
const SCROLL_GAP = 120 // px above an invalid field when scrolling it into view

let uid = 0
let openDropdown = null // only one list open at a time, across every instance
let outsideBound = false

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='book-demo']
 */
export default function (elements) {
  elements.forEach((root) => {
    try {
      init(root)
    } catch (err) {
      console.error('[book-demo] init failed', err)
    }
  })
}

function init(root) {
  const form =
    root.querySelector('[data-book-demo-form]') || root.querySelector('form')

  if (!form) {
    console.warn('[book-demo] no form found — skipping')
    return
  }

  // We own every message, so the browser must not also fire its own bubbles.
  // Set from JS: with no JS the native validation still runs.
  form.noValidate = true

  const entries = [
    ...Array.from(root.querySelectorAll('[data-dropdown]'), (dd) =>
      initDropdown(dd, root)
    ),
    ...inputsOf(form).map((el) => initInput(el, root)),
  ].filter(Boolean)

  if (!entries.length) {
    console.warn('[book-demo] no fields found — skipping')
    return
  }

  // Dropdowns are collected before the inputs, so sort back into DOM order —
  // otherwise a failed submit jumps to the lowest field instead of the first.
  entries.sort((a, b) =>
    a.field.compareDocumentPosition(b.field) &
    window.Node.DOCUMENT_POSITION_FOLLOWING
      ? -1
      : 1
  )

  // Capture on document, so this runs before Webflow's submit handler whatever
  // that binds to (the form or a delegated document listener).
  document.addEventListener(
    'submit',
    (event) => {
      if (event.target !== form) return
      // filter, not some: every invalid field must show its message at once.
      const invalid = entries.filter((entry) => !entry.validate())
      if (invalid.length) {
        event.preventDefault()
        event.stopImmediatePropagation()
        reveal(invalid[0])
        return
      }
      // Valid: last chance to rewrite what actually gets serialised, then let Webflow's
      // own handler take the event.
      entries.forEach((entry) => entry.beforeSubmit?.())
    },
    true
  )

  bindOutsideClose()

  // Async and deliberately not awaited — the form is fully usable while the widget
  // downloads, and the phone field degrades to a plain tel input if it never arrives.
  const withPhone = entries.find((entry) => entry.phone)
  if (withPhone) enhancePhone(withPhone)
}

// — Dropdown ————————————————————————————————————————————————

// An open panel used to stay open until the toggle was clicked again: clicking anywhere
// else on the page left it painting over the fields below it (the control is lifted to
// z-index 5 while open) and left the caret stuck at rotate(180deg), which reads as a
// broken arrow. Only one list is open at a time, so one document listener covers every
// instance. `pointerdown` (not `click`) so it also covers touch and fires before the
// click lands on whatever is underneath.
function bindOutsideClose() {
  if (outsideBound) return
  outsideBound = true
  document.addEventListener('pointerdown', (event) => {
    if (!openDropdown || openDropdown.element.contains(event.target)) return
    openDropdown.close()
  })
  // A focus that lands outside (Tab out of the list, a click into another field's input)
  // has to close it too — pointerdown never fires for keyboard navigation.
  document.addEventListener('focusin', (event) => {
    if (!openDropdown || openDropdown.element.contains(event.target)) return
    openDropdown.close()
  })
}

function initDropdown(dd, root) {
  const toggle = dd.querySelector('[data-dropdown-toggle]')
  const valueEl = dd.querySelector('[data-dropdown-value]')
  const native = dd.querySelector('[data-dropdown-native]')
  const options = Array.from(dd.querySelectorAll('[data-dropdown-option]'))
  // [data-dropdown-list] is missing from the Webflow markup, so fall back to the
  // options' own parent — the list element by definition.
  const list =
    dd.querySelector('[data-dropdown-list]') ||
    options[0]?.parentElement ||
    dd.querySelector('ul, ol')

  if (!toggle || !valueEl || !list || !options.length) {
    console.warn('[book-demo] incomplete dropdown — skipping', dd)
    return null
  }

  const field = fieldOf(dd, root)
  if (!field) {
    console.warn(
      '[book-demo] dropdown has no [data-error] field — skipping',
      dd
    )
    return null
  }

  const control = dd.closest('.book-demo_control') || dd.parentElement
  const entry = { field, error: errorOf(field), target: toggle }
  const required = !dd.closest(OPTIONAL) && !toggle.closest(OPTIONAL)

  // The toggle is a div in Webflow (not a <button>), so it is not focusable and
  // not in the tab order until we say so.
  if (!toggle.matches('button, [href], input, select, textarea, [tabindex]')) {
    toggle.tabIndex = 0
  }
  toggle.setAttribute('role', 'combobox')
  toggle.setAttribute('aria-haspopup', 'listbox')
  toggle.setAttribute('aria-expanded', 'false')
  if (required) toggle.setAttribute('aria-required', 'true')

  // aria-labelledby may point at an id the Designer never set on the label (it's
  // easy to lose in a paste) — fall back to the field's own label text so the
  // combobox always has an accessible name.
  const labelledBy = toggle.getAttribute('aria-labelledby')
  if (!labelledBy || !document.getElementById(labelledBy)) {
    const text = field
      .querySelector('label, .book-demo_label')
      ?.textContent.trim()
    if (text) toggle.setAttribute('aria-label', text)
  }

  list.id =
    list.id || toggle.getAttribute('aria-controls') || `bd-list-${++uid}`
  list.setAttribute('role', 'listbox')
  toggle.setAttribute('aria-controls', list.id)
  list.hidden = true

  let active = -1
  options.forEach((option, i) => {
    option.id = option.id || `${list.id}-option-${i}`
    option.setAttribute('role', 'option')
    if (!option.hasAttribute('aria-selected')) {
      option.setAttribute('aria-selected', 'false')
    }
  })

  hideNative(native)
  syncNative(native, options, valueEl.textContent)

  // A pre-marked option wins; otherwise nothing is chosen yet and the <select>
  // must be empty — its first real option would otherwise be submitted as if
  // the user had picked it.
  const preset = options.find(
    (option) => option.getAttribute('aria-selected') === 'true'
  )
  if (preset) choose(preset, { silent: true })
  else if (native) native.value = ''

  function open() {
    if (openDropdown && openDropdown !== api) openDropdown.close()
    dd.classList.add(OPEN)
    // Also on the CONTROL: it's position:relative with z-index:auto, so it creates no
    // stacking context and the list's own z-index competes globally — a later field (or
    // the submit button) would paint over it. Raising the control fixes the whole layer.
    control?.classList.add(OPEN)
    list.hidden = false
    toggle.setAttribute('aria-expanded', 'true')
    openDropdown = api
    setActive(Math.max(0, options.indexOf(selected())))
  }

  function close({ focus } = {}) {
    dd.classList.remove(OPEN)
    control?.classList.remove(OPEN)
    list.hidden = true
    toggle.setAttribute('aria-expanded', 'false')
    toggle.removeAttribute('aria-activedescendant')
    options.forEach((option) => option.classList.remove(ACTIVE))
    active = -1
    if (openDropdown === api) openDropdown = null
    if (focus) toggle.focus()
  }

  function setActive(index) {
    active = index
    options.forEach((option, i) => option.classList.toggle(ACTIVE, i === index))
    const option = options[index]
    if (!option) return
    toggle.setAttribute('aria-activedescendant', option.id)
    scrollIntoList(list, option)
  }

  function selected() {
    return options.find((option) => option.classList.contains(SELECTED))
  }

  function choose(option, { silent } = {}) {
    options.forEach((other) => {
      const on = other === option
      other.setAttribute('aria-selected', String(on))
      other.classList.toggle(SELECTED, on)
    })
    valueEl.textContent = label(option)
    control?.classList.add(FILLED)
    if (native) {
      native.value = value(option)
      if (!silent) {
        native.dispatchEvent(new window.Event('change', { bubbles: true }))
      }
    }
    clearError(entry)
  }

  toggle.addEventListener('click', () => {
    if (dd.classList.contains(OPEN)) close({ focus: true })
    else open()
  })

  toggle.addEventListener('keydown', (event) => {
    const isOpen = dd.classList.contains(OPEN)
    const { key } = event

    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault()
      if (!isOpen) return open()
      const step = key === 'ArrowDown' ? 1 : -1
      const from = active < 0 ? (step > 0 ? -1 : 0) : active
      return setActive((from + step + options.length) % options.length)
    }
    if (!isOpen && (key === 'Enter' || key === ' ')) {
      event.preventDefault()
      return open()
    }
    if (!isOpen) return

    if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      if (options[active]) choose(options[active])
      close({ focus: true })
    } else if (key === 'Escape') {
      event.preventDefault()
      close({ focus: true })
    } else if (key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (key === 'End') {
      event.preventDefault()
      setActive(options.length - 1)
    } else if (key === 'Tab') {
      close()
    }
  })

  list.addEventListener('click', (event) => {
    const option = event.target.closest('[data-dropdown-option]')
    if (!option || !options.includes(option)) return
    choose(option)
    close({ focus: true })
  })

  list.addEventListener('mousemove', (event) => {
    const option = event.target.closest('[data-dropdown-option]')
    if (option) setActive(options.indexOf(option))
  })

  const api = {
    ...entry,
    element: dd, // read by bindOutsideClose to tell inside from outside
    close,
    focus: () => toggle.focus({ preventScroll: true }),
    validate() {
      const has = native ? !!native.value : !!selected()
      if (required && !has) {
        setError(entry, MESSAGES.choose)
        return false
      }
      clearError(entry)
      return true
    },
  }
  return api
}

// The <select> is a value carrier: Webflow submits it, nobody should ever click it. Its
// visually-hidden state is FORCED here (inline, so no Designer style can outrank it)
// rather than trusted to a class — `clip-path` can't be authored in the Designer, so a
// paste tends to keep only `position: absolute`, and an absolute select paints above the
// static toggle and eats every click. What opens then is the OS's own select menu, which
// no z-index reaches: it draws over the fields below and over the submit button.
// Done from JS, not CSS, for the same reason as the phone's `.is-intl`: if the bundle
// never lands, the native select must stay usable as the no-JS fallback.
function hideNative(native) {
  if (!native) return
  native.tabIndex = -1
  native.setAttribute('aria-hidden', 'true')
  Object.assign(native.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '0',
    padding: '0',
    border: '0',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    clipPath: 'inset(50%)',
    pointerEvents: 'none', // belt and braces: a 1px box is still a hit target
  })
}

// Webflow's <select> choices are authored in the Designer and can drift from the
// visible list — a value with no matching <option> is silently dropped, so the
// field would submit empty. Mirror the list instead of trusting it.
function syncNative(native, options, placeholder) {
  if (!native) return
  const values = new Set(Array.from(native.options, (option) => option.value))
  if (!values.has('')) {
    const blank = new window.Option((placeholder || 'Select').trim(), '')
    blank.disabled = true
    native.add(blank, 0)
  }
  // The hidden select is aria-hidden + tabindex="-1": if it were `required`,
  // Chrome would block the submit on an unfocusable control with no visible cue.
  native.removeAttribute('required')
  options.forEach((option) => {
    if (!values.has(value(option))) {
      native.add(new window.Option(label(option), value(option)))
    }
  })
}

// offsetTop against the absolutely-positioned list, then scrollTop — never
// scrollIntoView, which would scroll the window and fight Lenis.
function scrollIntoList(list, option) {
  const top = option.offsetTop
  const bottom = top + option.offsetHeight
  if (top < list.scrollTop) list.scrollTop = top
  else if (bottom > list.scrollTop + list.clientHeight) {
    list.scrollTop = bottom - list.clientHeight
  }
}

const value = (option) =>
  option.getAttribute('data-value') ?? option.textContent.trim()
const label = (option) => option.textContent.trim()

// — Inputs ————————————————————————————————————————————————

function inputsOf(form) {
  return Array.from(form.querySelectorAll('input, textarea')).filter(
    (el) => !el.closest('[data-dropdown]') && !SKIP_TYPES.has(el.type)
  )
}

function initInput(el, root) {
  const field = fieldOf(el, root)
  if (!field) {
    console.warn('[book-demo] input has no [data-error] field — skipping', el)
    return null
  }

  const control = el.closest('.book-demo_control') || el.parentElement
  const entry = { field, error: errorOf(field), target: el }
  const required = el.required || !el.closest(OPTIONAL)
  if (required) el.setAttribute('aria-required', 'true')

  // Filled in by enhancePhone once (and only if) intl-tel-input actually loads.
  const phone = el.type === 'tel' ? { iti: null, ready: false, control } : null

  // Only the phone code and the dropdown value read .is-filled, but keeping it
  // on every control means a Designer rule can use it on any field.
  const syncFilled = () => control?.classList.toggle(FILLED, !!el.value.trim())
  syncFilled()

  el.addEventListener('input', () => {
    syncFilled()
    clearError(entry) // errors appear on submit and clear as the user types
  })

  return {
    ...entry,
    phone,
    focus: () => el.focus({ preventScroll: true }),
    beforeSubmit: () => normalisePhone(el, phone),
    validate() {
      const text = el.value.trim()
      const message =
        !text && required
          ? MESSAGES.required
          : text && el.type === 'email' && !EMAIL_RE.test(text)
            ? MESSAGES.email
            : text && el.type === 'tel' && !validPhone(text, phone)
              ? MESSAGES.phone
              : ''

      if (message) {
        setError(entry, message)
        return false
      }
      clearError(entry)
      return true
    },
  }
}

const digits = (text) => (text.match(/\d/g) || []).length

// — Phone (intl-tel-input) ————————————————————————————————————

// The widget knows each country's real rules; the digit count is only the fallback for
// the window before its utils script lands, or if the CDN is unreachable.
function validPhone(text, phone) {
  if (phone?.ready && phone.iti) return phone.iti.isValidNumber() !== false
  return digits(text) >= PHONE_MIN_DIGITS
}

// Webflow serialises the raw input, and `separateDialCode` deliberately keeps the code
// OUT of it — so without this the submitted number would arrive with no country code.
function normalisePhone(el, phone) {
  if (!phone?.iti) return
  if (phone.ready) {
    const full = phone.iti.getNumber() // E.164, e.g. +15551234567
    if (full) el.value = full
    return
  }
  // Utils never loaded: read the code off the widget's own visible element rather than
  // submitting a number without one.
  const code = phone.control
    ?.querySelector('.iti__selected-dial-code')
    ?.textContent.trim()
  const typed = el.value.trim()
  if (code && typed && !typed.startsWith('+')) el.value = `${code} ${typed}`
}

// Loaded on demand from the CDN, never bundled and NOT in the Webflow head — the same
// pattern as impact-map's d3-geo, so it only downloads on this page. The three URLs are
// pinned to one exact version and must be bumped together (paths and option names were
// verified against 29.1.2; the layout moved from build/ to dist/ after v25).
function ensureItiStyles() {
  const id = 'iti-css'
  if (document.getElementById(id)) return Promise.resolve()
  return new Promise((resolve) => {
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href =
      'https://cdn.jsdelivr.net/npm/intl-tel-input@29.1.2/dist/css/intlTelInput.min.css'
    // Awaited so the country button can't paint unstyled for a frame; a CSS failure
    // must not block the widget itself.
    link.addEventListener('load', resolve)
    link.addEventListener('error', resolve)
    document.head.appendChild(link)
  })
}

async function enhancePhone(entry) {
  const el = entry.target
  const { phone } = entry

  try {
    await ensureItiStyles()
    const { default: intlTelInput } =
      await import('https://cdn.jsdelivr.net/npm/intl-tel-input@29.1.2/dist/js/intlTelInput.mjs')

    phone.iti = intlTelInput(el, {
      initialCountry: 'us',
      separateDialCode: true, // dial code beside the flag, as the design draws it
      strictMode: true, // digits only, capped at the country's max length (needs utils)
      loadUtils: () =>
        import('https://cdn.jsdelivr.net/npm/intl-tel-input@29.1.2/dist/js/utils.js'),
    })

    // Only now is the widget really there, so only now do we let the CSS hide our own
    // static trigger — a CDN failure leaves the 🇺🇸 +1 markup in place and the field usable.
    phone.control?.classList.add(INTL)

    await phone.iti.promise // resolves once utils is in; isValidNumber needs it
    phone.ready = true
  } catch (err) {
    console.warn(
      '[book-demo] intl-tel-input failed to load — plain tel input',
      err
    )
  }
}

// — Field / error plumbing ————————————————————————————————————

// The field wrapper has no attribute of its own — it's the nearest ancestor that
// owns a [data-error] child, which is what makes it the field.
function fieldOf(el, root) {
  let node = el.parentElement
  while (node && node !== root) {
    if (node.querySelector(':scope > [data-error]')) return node
    node = node.parentElement
  }
  return null
}

function errorOf(field) {
  const error = field.querySelector('[data-error]')
  if (error) error.id = error.id || `bd-error-${++uid}`
  return error
}

function setError({ field, error, target }, message) {
  field.classList.add(ERROR)
  target.setAttribute('aria-invalid', 'true')
  if (!error) return
  error.textContent = message
  target.setAttribute('aria-describedby', error.id)
}

function clearError({ field, error, target }) {
  if (!field.classList.contains(ERROR)) return
  field.classList.remove(ERROR)
  target.removeAttribute('aria-invalid')
  target.removeAttribute('aria-describedby')
  if (error) error.textContent = ''
}

// Focus alone can leave the message off-screen on mobile, which reads as a submit
// that did nothing. Route the scroll through Lenis when it's running.
function reveal(entry) {
  entry.focus()
  const rect = entry.field.getBoundingClientRect()
  if (rect.top >= 0 && rect.bottom <= window.innerHeight) return
  if (window.lenis) window.lenis.scrollTo(entry.field, { offset: -SCROLL_GAP })
  else entry.field.scrollIntoView({ block: 'center', behavior: 'auto' })
}

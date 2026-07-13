---
name: Radix Switch BubbleInput synthetic-click loop
description: Radix react-switch dispatches a bubbling synthetic click on programmatic checked changes; an ancestor onClick toggle turns it into an infinite React #185 loop
---

# Radix Switch BubbleInput synthetic-click loop (React #185)

Radix `@radix-ui/react-switch` renders a hidden `SwitchBubbleInput` `<input>` with a
`useEffect` that dispatches `new Event("click", { bubbles })` on that input EVERY time
the controlled `checked` prop changes **programmatically** (form.reset / setValue), not
just on real user clicks. `bubbles` is true unless a real prior user click on the switch
button set an internal ref — so a reset/setValue-driven `checked` change dispatches a
**bubbling** synthetic click.

If the Switch sits inside a clickable ancestor (e.g. a card `<div role="button"
onClick={toggle}>`), that synthetic click bubbles PAST the switch button's own
`onClick={e => e.stopPropagation()}` (the synthetic event originates on the hidden input,
above/around the button's handler) up to the ancestor → ancestor toggles the value →
`checked` changes → BubbleInput dispatches again → ∞ → React error #185 "Maximum update
depth exceeded". Kickoff is often a mount-time mismatch (useForm default ≠ the value the
load `form.reset()` supplies), which flips `checked` on first render.

**Fix:** guard the ANCESTOR's onClick with `if (!e.nativeEvent.isTrusted) return;`.
`isTrusted` is spec-guaranteed false for any script-dispatched event and true for
user-agent-generated ones (universal across evergreen browsers). Real clicks and AT/
screen-reader activation are trusted (toggle works); the library's synthetic dispatch is
untrusted (ignored). Keyboard paths via a separate `onKeyDown` are real events — leave
them untouched.

**Also:** an agent-load `useEffect` with a bare `[agent]` dep is a co-conspirator —
data hooks (e.g. TanStack `useGetAgent`) return a fresh object reference every render, so
`form.reset()` runs every render. Gate it on a real data signature (`id + updatedAt`)
stored in a ref, not the object identity.

**Why:** these two together made the agent editor (`builder.tsx`) crash on load for ANY
agent in production.

**How to apply:** whenever a Radix `<Switch>` (or any Radix control using BubbleInput —
Checkbox does the same) is wrapped by a clickable ancestor whose onClick mutates the same
value the switch reflects, add the `isTrusted` guard on the ancestor. Also treat
"form.reset() in an effect with a bare `[queryData]` dep" as a render-loop smell.
Note: testing-library `fireEvent.click` is untrusted and would be blocked by the guard;
Playwright/CDP input is trusted.

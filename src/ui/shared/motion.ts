// A scroll the page starts on its own (a banner taking someone to a button) has to follow the system's motion setting
// like the stylesheet's transitions do: CSS cannot reach scrollIntoView's `behavior`, so the call asks here.
export function scrollBehavior(): ScrollBehavior {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  } catch {
    return 'smooth';
  }
}

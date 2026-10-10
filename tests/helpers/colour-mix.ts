// CSS color-mix() and WCAG contrast for the looks' tables. The house values mix in oklab and the looks' tints in
// oklch, and the two give different colours from the same inputs, so a table mixes each pair the way its sheet does.

const toLin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const fromLin = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));

function oklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => toLin(parseInt(hex.slice(i, i + 2), 16)));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

// Out-of-gamut results are clipped per channel, as Chrome renders a mix.
function hexOf([L, A, B]: [number, number, number]): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return '#' + rgb.map((v) => fromLin(v).toString(16).padStart(2, '0')).join('');
}

/** color-mix(in oklab, a p, b), with p from 0 to 1. */
export function mixOklab(a: string, p: number, b: string): string {
  const x = oklab(a), y = oklab(b);
  return hexOf([0, 1, 2].map((i) => x[i] * p + y[i] * (1 - p)) as [number, number, number]);
}

/** color-mix(in srgb, a p, b), with p from 0 to 1. */
export function mixSrgb(a: string, p: number, b: string): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return '#' + [1, 3, 5].map((i) => Math.round(ch(a, i) * p + ch(b, i) * (1 - p)).toString(16).padStart(2, '0')).join('');
}

/** color-mix(in oklch, a p, b): hue goes the shorter way round, and a grey's hue is missing, so it takes the other's. */
export function mixOklch(a: string, p: number, b: string): string {
  const lch = (hex: string): [number, number, number] => {
    const [L, A, B] = oklab(hex);
    const C = Math.hypot(A, B);
    return [L, C, C < 1e-4 ? NaN : Math.atan2(B, A)];
  };
  const [L1, C1, h1] = lch(a), [L2, C2, h2] = lch(b);
  const H1 = Number.isNaN(h1) ? (Number.isNaN(h2) ? 0 : h2) : h1;
  const H2 = Number.isNaN(h2) ? H1 : h2;
  let d = H2 - H1;
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  const H = H1 + d * (1 - p), L = L1 * p + L2 * (1 - p), C = C1 * p + C2 * (1 - p);
  return hexOf([L, C * Math.cos(H), C * Math.sin(H)]);
}

const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (h: string) => 0.2126 * lin(parseInt(h.slice(1, 3), 16)) + 0.7152 * lin(parseInt(h.slice(3, 5), 16)) + 0.0722 * lin(parseInt(h.slice(5, 7), 16));

/** The WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The percentage a sheet gives a mix, read from the rule the pattern finds, as a fraction. */
export function share(css: string, pattern: RegExp, group = 1): number {
  const m = pattern.exec(css);
  if (!m) throw new Error(`mix not found: ${pattern}`);
  return Number(m[group]) / 100;
}

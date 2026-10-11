import type { Numbers, Word } from './types';

/**
 * Builds the spoken form of any number from pack data. No language is hard-coded.
 *
 * Method:
 *  1. If the pack lists the exact number in `words`, use it.
 *  2. Otherwise take the largest multiplier that fits (e.g. 1000), split the number into
 *     quantity x multiplier + remainder, and build each part.
 *  3. `overrides` replaces irregular groups such as 300 or 8000.
 *  4. `omitOne` drops the quantity when it is 1 (e.g. "100", not "1 100"). With "leading" it does so
 *     only at the start of the number (Mandarin 十 for 10, but 一百一十 for 110).
 *  5. `zero`, when set, marks a skipped place (Mandarin 一百零五 for 105).
 */
export function composeNumber(n: number, data: Numbers): Word {
  if (!Number.isInteger(n) || n < 0) throw new Error(`cannot compose ${n}`);
  const parts = group(n, data);
  const join = (f: (w: Word) => string, sep: string) => parts.map(f).join(sep);
  const gap = data.nativeSeparator ?? '';
  return {
    native: join((w) => w.native, gap),
    reading: join((w) => w.reading, data.separator),
    speak: join((w) => w.speak ?? w.native, gap),
  };
}

function group(n: number, data: Numbers, leading = true): Word[] {
  const exact = data.words[String(n)];
  if (exact) return [exact];
  const multipliers = [...data.multipliers].sort((a, b) => b.value - a.value);
  const m = multipliers.find((x) => x.value <= n);
  if (!m) throw new Error(`no words or multiplier cover ${n}`);
  const q = Math.floor(n / m.value);
  const rest = n % m.value;
  const out: Word[] = [];

  const irregular = data.overrides?.[String(q * m.value)];
  if (irregular) {
    out.push(irregular);
  } else {
    const mw: Word = { native: m.native, reading: m.reading, speak: m.speak };
    if (q === 1 && (m.omitOne === true || (m.omitOne === 'leading' && leading))) out.push(mw);
    else {
      // quantity + multiplier read as one unit, e.g. ni + hyaku -> nihyaku (or "dua puluh" with a separator)
      const qw = group(q, data);
      const gap = data.nativeSeparator ?? '';
      const readGap = data.nativeSeparator === undefined ? '' : data.separator;
      out.push({
        native: qw.map((w) => w.native).join(gap) + gap + mw.native,
        reading: qw.map((w) => w.reading).join(readGap) + readGap + mw.reading,
        speak: qw.map((w) => w.speak ?? w.native).join(gap) + gap + (mw.speak ?? mw.native),
      });
    }
  }
  if (rest > 0 && data.zero && rest < m.value / 10) out.push(data.zero);
  if (rest > 0) out.push(...group(rest, data, false));
  return out;
}

/** Spoken form of a price: number words followed by the currency unit. */
export function composePrice(n: number, data: Numbers, unit: Word): Word {
  const w = composeNumber(n, data);
  const gap = data.nativeSeparator ?? '';
  return {
    native: w.native + gap + unit.native,
    reading: w.reading + data.separator + unit.reading,
    speak: (w.speak ?? w.native) + gap + (unit.speak ?? unit.native),
  };
}

export function formatPrice(n: number, cur: { symbol: string; position: 'prefix' | 'suffix' }): string {
  const s = n.toLocaleString('en-SG');
  return cur.position === 'suffix' ? `${s}${cur.symbol}` : `${cur.symbol}${s}`;
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composeNumber, composePrice, formatPrice } from './numbers';
import type { Numbers, PackMeta } from './types';

const read = <T>(f: string) => JSON.parse(readFileSync(new URL(`../../content/ja/${f}`, import.meta.url), 'utf8')) as T;
const data = read<Numbers>('numbers.json');
const meta = read<PackMeta>('pack.json');

describe('composeNumber (ja)', () => {
  const cases: [number, string, string][] = [
    [0, 'zero', 'ゼロ'],
    [7, 'nana', '七'],
    [10, 'juu', '十'],
    [11, 'juu ichi', '十一'],
    [20, 'nijuu', '二十'],
    [100, 'hyaku', '百'],
    [300, 'sanbyaku', '三百'],
    [600, 'roppyaku', '六百'],
    [800, 'happyaku', '八百'],
    [1000, 'sen', '千'],
    [1280, 'sen nihyaku hachijuu', '千二百八十'],
    [3000, 'sanzen', '三千'],
    [8000, 'hassen', '八千'],
    [9999, 'kyuusen kyuuhyaku kyuujuu kyuu', '九千九百九十九'],
    [10000, 'ichiman', '一万'],
  ];
  it.each(cases)('%i', (n, reading, native) => {
    const w = composeNumber(n, data);
    expect(w.reading).toBe(reading);
    expect(w.native).toBe(native);
  });

  it('composes every number in range', () => {
    for (let n = data.range.min; n <= data.range.max; n++) expect(() => composeNumber(n, data)).not.toThrow();
  });

  it('adds the currency unit to prices', () => {
    expect(composePrice(1280, data, meta.currency.unit).reading).toBe('sen nihyaku hachijuu en');
    expect(composePrice(1280, data, meta.currency.unit).speak).toBe('せんにひゃくはちじゅうえん');
  });

  it('formats prices per pack currency', () => {
    expect(formatPrice(1280, meta.currency)).toBe('1,280円');
  });
});

describe('composeNumber (zh)', () => {
  const zh = JSON.parse(readFileSync(new URL('../../content/zh/numbers.json', import.meta.url), 'utf8')) as Numbers;
  const cases: [number, string, string][] = [
    [10, 'shí', '十'],
    [15, 'shí wǔ', '十五'],
    [105, 'yībǎi líng wǔ', '一百零五'],
    [110, 'yībǎi yīshí', '一百一十'],
    [250, 'liǎngbǎi wǔshí', '兩百五十'],
    [1050, 'yīqiān líng wǔshí', '一千零五十'],
    [1280, 'yīqiān liǎngbǎi bāshí', '一千兩百八十'],
    [10000, 'yīwàn', '一萬'],
  ];
  it.each(cases)('%i', (n, reading, native) => {
    const w = composeNumber(n, zh);
    expect(w.reading).toBe(reading);
    expect(w.native).toBe(native);
  });
});

describe('composeNumber (id)', () => {
  const read = <T>(f: string) => JSON.parse(readFileSync(new URL(`../../content/id/${f}`, import.meta.url), 'utf8')) as T;
  const id = read<Numbers>('numbers.json');
  const idMeta = read<PackMeta>('pack.json');
  const cases: [number, string, string][] = [
    [10, 'sepuluh', 'seh-poo-loo'],
    [15, 'lima belas', 'lee-mah beh-lahs'],
    [21, 'dua puluh satu', 'doo-ah poo-loo sah-too'],
    [100, 'seratus', 'seh-rah-toos'],
    [115, 'seratus lima belas', 'seh-rah-toos lee-mah beh-lahs'],
    [250, 'dua ratus lima puluh', 'doo-ah rah-toos lee-mah poo-loo'],
    [1100, 'seribu seratus', 'seh-ree-boo seh-rah-toos'],
    [2500, 'dua ribu lima ratus', 'doo-ah ree-boo lee-mah rah-toos'],
    [12000, 'dua belas ribu', 'doo-ah beh-lahs ree-boo'],
    [100000, 'seratus ribu', 'seh-rah-toos ree-boo'],
  ];
  it.each(cases)('%i', (n, native, reading) => {
    const w = composeNumber(n, id);
    expect(w.native).toBe(native);
    expect(w.reading).toBe(reading);
    expect(w.speak).toBe(native);
  });

  it('composes every number in range', () => {
    for (let n = id.range.min; n <= id.range.max; n++) expect(() => composeNumber(n, id)).not.toThrow();
  });

  it('adds the rupiah unit to prices', () => {
    const w = composePrice(25000, id, idMeta.currency.unit);
    expect(w.native).toBe('dua puluh lima ribu rupiah');
    expect(w.reading).toBe('doo-ah poo-loo lee-mah ree-boo rupiah');
    expect(w.speak).toBe('dua puluh lima ribu rupiah');
  });

  it('formats prices per pack currency', () => {
    expect(formatPrice(25000, idMeta.currency)).toBe('Rp25,000');
  });
});

describe('nativeSeparator', () => {
  it('leaves packs without it unchanged', () => {
    for (const code of ['ja', 'ko', 'zh']) {
      const n = JSON.parse(readFileSync(new URL(`../../content/${code}/numbers.json`, import.meta.url), 'utf8')) as Numbers;
      expect(n.nativeSeparator).toBeUndefined();
    }
  });
});

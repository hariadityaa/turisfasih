export interface Word { native: string; reading: string; speak?: string }

export interface Situation { id: string; label: string }

export interface PackMeta {
  schemaVersion: 1;
  code: string;
  name: string;
  nativeName: string;
  ttsLocale: string;
  readingSystem: string;
  scriptSystems: string[];
  /** Topics. Phrases and dialogues refer to them by id. */
  situations: Situation[];
  /** Phrase ids for the phrasebook's Survival list: the few that get you through most days. */
  survival?: string[];
  currency: { code: string; symbol: string; position: 'prefix' | 'suffix'; decimals: number; unit: Word };
  restDay: number;
}

export interface KanaChar { id: string; char: string; reading: string; speak?: string }
export interface KanaGroup { id: string; label: string; chars: KanaChar[] }
export interface ReadingWord { id: string; native: string; reading: string; english: string; speak?: string }
export interface WordSet { id: string; label: string; words: ReadingWord[] }
export interface ScriptSystem { id: string; name: string; groups: KanaGroup[]; wordSets?: WordSet[] }
export interface Scripts { schemaVersion: 1; systems: ScriptSystem[] }

export interface Phrase {
  id: string; native: string; reading: string; english: string; speak?: string;
  tags: string[]; difficulty: 1 | 2 | 3; audioSrc?: string;
  /** Something you hear, not say (staff lines). Cards play audio first and ask for the meaning. */
  listen?: boolean;
  /** For a listen phrase: the phrase to say back. */
  replyId?: string;
  /** Phrasebook only: listed, searchable and starrable, but never a lesson, practice item or part of the learned count. */
  book?: boolean;
  /** Lowercase English synonyms the phrasebook search also matches, e.g. ["lift", "elevator"]. */
  keywords?: string[];
}
export interface Phrases { schemaVersion: 1; phrases: Phrase[] }

export interface Multiplier {
  value: number; native: string; reading: string; speak?: string;
  /** Drop the quantity 1 before this multiplier. "leading" drops it only at the start of the number. */
  omitOne: boolean | 'leading';
}
export interface Numbers {
  schemaVersion: 1;
  range: { min: number; max: number };
  words: Record<string, Word>;
  multipliers: Multiplier[];
  overrides?: Record<string, Word>;
  /** Said where a place is skipped, e.g. Mandarin 零 in 一百零五. */
  zero?: Word;
  separator: string;
  /** Put between native parts, e.g. " " for "dua puluh lima ribu". Unset joins them with no gap. */
  nativeSeparator?: string;
  priceDrill: { min: number; max: number; step: number };
}

export interface DialogueReply {
  phraseId?: string; native?: string; reading?: string; english?: string; speak?: string;
  next: string; good: boolean; feedback?: string;
}
export interface DialogueNode {
  speaker?: 'npc' | 'narrator'; native: string; reading: string; english: string; speak?: string;
  end?: boolean; replies?: DialogueReply[];
}
export interface Dialogue {
  id: string; title: string; situation: string; intro?: string; start: string;
  nodes: Record<string, DialogueNode>;
}
export interface Dialogues { schemaVersion: 1; dialogues: Dialogue[] }

/** Everything a language pack provides. The engine only ever sees this shape. */
export interface Pack {
  meta: PackMeta;
  scripts: Scripts;
  phrases: Phrases;
  numbers: Numbers;
  dialogues: Dialogues;
}

/** One thing that can be reviewed with spaced repetition. */
export interface Item {
  id: string;
  kind: 'kana' | 'phrase';
  front: string;       // what is shown first (text-first)
  reading: string;
  english?: string;
  speak: string;       // what the voice says
  audioSrc?: string;
  system?: string;     // kana: script system id
  tags?: string[];     // phrase: situations
  listen?: boolean;    // phrase: recognise by ear only
}

/**
 * Pure readings of the fields the native character creator added to `SheetV1`
 * (docs/CHARGEN.md §8.3), shared by the sheet in play and the builder's own
 * last screen so the two never say different things about one record.
 *
 * The chain that ended here was complete up to the sheet and then stopped:
 * the compiler filled `knowledge`, `languages`, `augments[].grade/rating`,
 * `qualities[].type/karma/rating`, `identity.realName/age/sex` and
 * `awakening.drain` from the build, the builder's preview rendered them, and
 * the tabs in play read none of them. A player spent Karma on a knowledge
 * skill, the GM approved it, a revision recorded it — and nothing on the sheet
 * changed. These are the words the tabs were missing; no React, no I/O.
 */
import type { SheetAugment, SheetKnowledge, SheetLanguage, SheetQuality, SheetV1 } from '@safehouse/contracts';

// ---------------------------------------------------------------------------
// Knowledge skills and languages (SR5 p.89; a mandatory pool at creation)
// ---------------------------------------------------------------------------

export interface KnowledgeLine {
  key: string;
  name: string;
  /** The knowledge category, or `language` for a language. */
  kind: string;
  /** The rating, or `N` for a native language, which has none to roll. */
  rating: string;
  spec: string | null;
}

/**
 * Both lists as one run of lines: the knowledge skills in their own order,
 * then the languages with the native ones first. A native language reads `N`
 * rather than a rating of 0, because that is what the book writes and what a
 * rating of 0 would otherwise look like — a skill nobody bought.
 */
export function knowledgeLines(
  sheet: Pick<SheetV1, 'knowledge' | 'languages'> & {
    knowledge: readonly SheetKnowledge[];
    languages: readonly SheetLanguage[];
  },
): KnowledgeLine[] {
  const knowledge = sheet.knowledge.map((k, i) => ({
    key: `k|${k.name}|${i}`,
    name: k.name,
    kind: k.category,
    rating: String(k.rating),
    spec: k.spec ?? null,
  }));
  const languages = [...sheet.languages]
    .sort((a, b) => Number(b.native) - Number(a.native))
    .map((l, i) => ({
      key: `l|${l.name}|${i}`,
      name: l.name,
      kind: 'language',
      rating: l.native ? 'N' : String(l.rating),
      spec: l.spec ?? null,
    }));
  return [...knowledge, ...languages];
}

// ---------------------------------------------------------------------------
// Qualities
// ---------------------------------------------------------------------------

/**
 * "costs 12 Karma", "gives 12 Karma", "costs 10 Karma to buy off" — the
 * builder's own wording for a quality's price, which is the only place the
 * side of the ledger is stated in words rather than in a column heading.
 * `null` for a quality written before the builder, which recorded neither.
 */
export function qualityKarmaText(
  quality: { type?: 'positive' | 'negative' | undefined; karma?: number | undefined },
  options: { buyOff?: boolean } = {},
): string | null {
  if (quality.karma === undefined || quality.type === undefined) return null;
  return quality.type === 'negative'
    ? `gives ${quality.karma} Karma`
    : `costs ${quality.karma} Karma${options.buyOff ? ' to buy off' : ''}`;
}

/** "costs 12 Karma · rating 3" — the quality's price and its rating, as it has them. */
export function qualityDetail(quality: Pick<SheetQuality, 'type' | 'karma' | 'rating'>): string | null {
  const parts = [qualityKarmaText(quality), quality.rating === undefined ? null : `rating ${quality.rating}`].filter(
    (p): p is string => p !== null,
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ---------------------------------------------------------------------------
// Augmentations
// ---------------------------------------------------------------------------

/**
 * "alphaware · rating 2 · −0.08 ess" — the grade first, because it is the
 * decision the player made and paid for (alphaware and used change both the
 * price and the Essence, and the validator treats a grade at creation as a
 * call the GM must allow).
 */
export function augmentDetail(aug: Pick<SheetAugment, 'essence' | 'grade' | 'rating'>): string {
  return [
    aug.grade ?? null,
    aug.rating === undefined ? null : `rating ${aug.rating}`,
    aug.essence > 0 ? `−${aug.essence} ess` : 'no essence cost',
  ]
    .filter((p): p is string => p !== null)
    .join(' · ');
}

// ---------------------------------------------------------------------------
// Who the runner is
// ---------------------------------------------------------------------------

export interface IdentityLine {
  label: string;
  value: string;
}

/**
 * The fields behind the alias, the ones the record actually carries. A build
 * that named none of them shows none of them rather than a row of dashes.
 */
export function identityDetails(identity: SheetV1['identity']): IdentityLine[] {
  const out: IdentityLine[] = [];
  const realName = identity.realName?.trim();
  if (realName) out.push({ label: 'Real name', value: realName });
  if (identity.age !== undefined) out.push({ label: 'Age', value: String(identity.age) });
  const sex = identity.sex?.trim();
  if (sex) out.push({ label: 'Sex', value: sex });
  return out;
}

// ---------------------------------------------------------------------------
// Drain
// ---------------------------------------------------------------------------

/** The four attributes a tradition resists Drain with beside Willpower (SR5 p.281). */
export const DRAIN_ATTR_IDS = ['cha', 'log', 'int', 'wil'] as const;
export type DrainAttrId = (typeof DRAIN_ATTR_IDS)[number];

/**
 * The second half of the Drain resistance pool, as the sheet knows it:
 * `awakening.drain` is `[WIL, the tradition's attribute]`, written by the
 * builder from the tradition the player picked (§8.3). Charisma is the
 * fallback for a sheet that carries no tradition — an import, or a character
 * made before the builder — not a default the app prefers to the record.
 *
 * A pair naming something the chips cannot offer (a technomancer's
 * WIL + RES, which is Fading rather than Drain and belongs to no spell) falls
 * back the same way rather than showing an attribute nothing can change.
 */
export function drainAttrOf(sheet: Pick<SheetV1, 'awakening'>): DrainAttrId {
  const second = sheet.awakening?.drain?.[1];
  return (DRAIN_ATTR_IDS as readonly string[]).includes(second ?? '') ? (second as DrainAttrId) : 'cha';
}

/**
 * Writing in a purchase the campaign's books do not list (FR3.9,
 * docs/CHARGEN.md §4.4 Step 7; the sheet's "write your own" for the builder).
 *
 * A table's own gear, a row the book reader could not parse, a piece of kit
 * from a book the table owns on paper only — a player still has to be able to
 * buy it. The form asks what the engine needs to price and cap a line: a
 * name and kind, the price each, the Availability code as printed, and for
 * 'ware its Essence and whether it is cyberware or bioware (Sensitive System
 * tells them apart). It does not add anything itself: "continue" turns the
 * fields into a catalogue-shaped row (`customPurchaseHit`) and hands it to
 * the same add panel a row from the books goes through, so quantity, grade,
 * the caps and the Magic warning are asked the same way. The words in it are
 * the player's (§14).
 */
import { useId, useState } from 'react';
import { KIND_LABEL, type CatalogueKind } from '../../../sheet/catalogue/api.js';
import type { CatalogueHit } from '../../../sheet/catalogue/toSheet.js';
import { CUSTOM_KINDS, EMPTY_CUSTOM, customPurchaseHit, type CustomPurchaseInput } from './gear.js';

const inputClass =
  'w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none';

export interface CustomPurchaseViewProps {
  value: CustomPurchaseInput;
  onChange: (value: CustomPurchaseInput) => void;
  onContinue: (hit: CatalogueHit) => void;
}

export function CustomPurchaseView({ value, onChange, onContinue }: CustomPurchaseViewProps) {
  const hintId = useId();
  const hit = customPurchaseHit(value);
  const set = (patch: Partial<CustomPurchaseInput>) => onChange({ ...value, ...patch });
  const ware = value.kind === 'augmentation';
  return (
    <form
      className="space-y-2 rounded-md border border-edge bg-deck/60 p-3"
      aria-label="Write in a purchase"
      data-testid="gear-custom"
      onSubmit={(e) => {
        e.preventDefault();
        if (hit) onContinue(hit);
      }}
    >
      <p id={hintId} className="text-xs text-dim">
        For something the campaign&apos;s books do not list. Your own words; the GM sees it like any other line.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-0.5 sm:col-span-2">
          <span className="mono-label">Name</span>
          <input className={inputClass} value={value.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} data-testid="gear-custom-name" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="mono-label">Kind</span>
          <select className={inputClass} value={value.kind} onChange={(e) => set({ kind: e.target.value as CatalogueKind })} data-testid="gear-custom-kind">
            {CUSTOM_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="mono-label">Price each, in nuyen</span>
          <input className={inputClass} inputMode="numeric" value={value.price} placeholder="e.g. 2,500" onChange={(e) => set({ price: e.target.value })} data-testid="gear-custom-price" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="mono-label">Availability</span>
          <input className={inputClass} value={value.avail} placeholder="e.g. 6R" maxLength={24} onChange={(e) => set({ avail: e.target.value })} data-testid="gear-custom-avail" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="mono-label">Rating</span>
          <input className={inputClass} inputMode="numeric" value={value.rating} onChange={(e) => set({ rating: e.target.value })} data-testid="gear-custom-rating" />
        </label>
        {ware && (
          <>
            <label className="flex flex-col gap-0.5">
              <span className="mono-label">Essence each</span>
              <input className={inputClass} inputMode="decimal" value={value.essence} placeholder="e.g. 0.2" onChange={(e) => set({ essence: e.target.value })} data-testid="gear-custom-essence" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="mono-label">Cyberware or bioware</span>
              <select className={inputClass} value={value.ware} onChange={(e) => set({ ware: e.target.value === 'bioware' ? 'bioware' : 'cyberware' })} data-testid="gear-custom-ware">
                <option value="cyberware">cyberware</option>
                <option value="bioware">bioware</option>
              </select>
            </label>
          </>
        )}
      </div>
      <button
        type="submit"
        className={`btn px-3 py-1.5 ${hit ? 'btn-accent' : 'cursor-not-allowed opacity-60'}`}
        {...(hit ? {} : { 'aria-disabled': true })}
        aria-describedby={hintId}
        data-testid="gear-custom-continue"
      >
        {hit ? `continue with ${hit.name}` : 'name it to continue'}
      </button>
    </form>
  );
}

/** The live form: its fields, kept until the shop remounts it after the line is bought (so "not now" loses nothing). */
export default function CustomPurchase({ onContinue }: { onContinue: (hit: CatalogueHit) => void }) {
  const [value, setValue] = useState<CustomPurchaseInput>(EMPTY_CUSTOM);
  return <CustomPurchaseView value={value} onChange={setValue} onContinue={onContinue} />;
}

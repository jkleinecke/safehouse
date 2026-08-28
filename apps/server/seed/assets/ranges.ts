/**
 * Range band edges in metres — [short, medium, long, extreme] — as the GM
 * would type them into a sheet (FR9.9; range tables are user-entered data, G6).
 * Shared by the demo's PCs and the Rusted Halo template so a shot from the
 * catwalk to the loading dock (≈22 m) lands in the same band for everyone.
 */
import type { RangeTables } from '@safehouse/contracts';

export const RANGE_TABLES: RangeTables = {
  holdout: [4, 8, 12, 16],
  light_pistol: [5, 15, 30, 50],
  heavy_pistol: [5, 20, 40, 60],
  machine_pistol: [8, 16, 24, 40],
  smg: [10, 40, 80, 150],
  shotgun: [10, 20, 40, 70],
};

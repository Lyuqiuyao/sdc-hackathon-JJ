import { seedState as seed } from "../src/lib/receivables/seed";

// Preserve the original regression suite against explicit historical scoring.
// New MVP tests exercise the production split_v2 default separately.
export const seedState = () => seed({ scoringVersion: "legacy_v1" });

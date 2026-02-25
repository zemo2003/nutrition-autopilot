# Scientific Risks — Kitchen Ops MVP

## Risk Register

### SR-1: Yield factor assumptions [MEDIUM]
**What:** Component default yield factors are generic estimates (e.g., protein shrinkage at 0.75). Actual cooking yields vary significantly with method, temperature, duration, and cut.
**Impact:** Nutrient-per-serving calculations could be off by 15-30% for cooked components.
**Mitigation:** The batch prep system tracks actual vs. expected yield. Over time, actual yield data can replace defaults. The `yieldVariance` field flags batches where actual differs from expected by >15%.
**Status:** Partially mitigated. UI shows variance badges; no automatic yield factor learning yet.

### SR-2: Enrichment confidence not weighted in labels [HIGH]
**What:** All enriched nutrient values are treated equally in label computation regardless of confidence score. A value from a USDA verified source and a 0.3-confidence inference from a similar product both contribute equally.
**Impact:** Low-confidence nutrient values could skew label accuracy, particularly for micronutrients.
**Mitigation:** Verification tasks are created for low-confidence values (CRITICAL severity for missing core macros, HIGH for outliers). The QA board surfaces these prominently.
**Status:** Known limitation displayed in QA board "Known Limitations" section.

### SR-3: Label staleness detection is query-heavy [LOW]
**What:** The stale label detection uses a multi-join raw SQL query across LabelSnapshot, LabelLineageEdge, ProductCatalog, and ProductNutrientValue tables. This could become slow as label count grows.
**Impact:** Performance degradation on QA board load.
**Mitigation:** Query is limited to 100 results. Consider materialized view or trigger-based staleness tracking at scale.
**Status:** Working correctly at current scale (~100 labels).

### SR-4: Synthetic lot tracking [MEDIUM]
**What:** Historical backfill creates synthetic lots (vendor=SYSTEM_SYNTHETIC) that may not reflect actual inventory. The QA board shows synthetic lot ratio but doesn't prevent them from being used in forward-looking operations.
**Impact:** Batch prep could reference synthetic lots for ingredient sourcing, giving false availability signals.
**Mitigation:** QA board shows synthetic lot warning when ratio > 10%. Inventory page shows real lots only (synthetic lots have zero available quantity after backfill).
**Status:** Display-only warning. No enforcement.

### SR-5: FDA rounding applied only at final label step [LOW — CORRECT]
**What:** FDA rounding rules (21 CFR 101.9) are applied at the final label computation step, not during intermediate calculations.
**Impact:** None — this is the correct approach. Rounding at intermediate steps would accumulate errors.
**Status:** Verified by 53 scientific QA tests including explicit rounding validation.

### SR-6: Component nutrients not independently verified [MEDIUM]
**What:** Component nutrient profiles are derived from their ingredient lines using the same enrichment pipeline as recipes. No separate verification path exists for component-level nutrient claims.
**Impact:** If a sauce component claims specific macro ratios, those claims are only as good as the underlying ingredient nutrient data.
**Mitigation:** Same verification task system applies. CRITICAL tasks are created for products missing core macros.
**Status:** Relies on existing verification pipeline.

### SR-7: No nutrient retention factors for cooking methods [HIGH]
**What:** The system does not model nutrient retention factors (e.g., vitamin C loss during boiling, mineral leaching). Only yield factors (mass change) are tracked.
**Impact:** Micronutrient values on labels may overstate actual content for cooked components.
**Mitigation:** Known limitation disclosed in QA board. FDA allows "as prepared" values to be used when actual retention data isn't available, but this is a scientific accuracy gap.
**Status:** Not addressed. Would require per-nutrient, per-cooking-method retention factor tables (USDA publishes these but they're not integrated).

## Test Coverage

- 167 tests pass across the nutrition engine
- 53 scientific QA tests covering:
  - Yield factor application correctness
  - Unit conversion accuracy
  - FDA rounding rules (calories, macros, micronutrients)
  - Calorie sanity checks (Atwater factor validation)
  - Duplicate counting prevention
  - Nutrient hierarchy consistency
- 175 total tests across all workspaces

# Scientific Risks — Sprint 2

## Risk Register

### SR-1: Yield factor assumptions [MEDIUM]
**What:** Component default yield factors are generic estimates (e.g., protein shrinkage at 0.75). Actual cooking yields vary by method, temperature, duration, and cut.
**Impact:** Nutrient-per-serving calculations could be off by 15-30% for cooked components.
**Mitigation:** Batch prep system tracks actual vs. expected yield with variance badges. Kitchen Mode adds checkpoint timestamps for more detailed tracking.
**Status:** Partially mitigated.

### SR-2: Enrichment confidence not weighted in labels [HIGH]
**What:** All enriched nutrient values are treated equally in label computation regardless of confidence score.
**Impact:** Low-confidence values could skew label accuracy.
**Mitigation:** Verification tasks created for low-confidence values. QA board surfaces these prominently.
**Status:** Known limitation.

### SR-3: Label staleness detection is query-heavy [LOW]
**What:** Multi-join raw SQL query. Could become slow at scale.
**Mitigation:** Limited to 100 results. Consider materialized view at scale.
**Status:** Working at current scale.

### SR-4: Synthetic lot tracking [MEDIUM]
**What:** Historical backfill creates synthetic lots that may not reflect actual inventory.
**Impact:** False availability signals.
**Mitigation:** QA board shows synthetic lot ratio warning. Label freeze now blocks synthetic lots in strict mode (Sprint 2 fix).
**Status:** Active enforcement — synthetic lots blocked from freeze, flagged in evidence.

### SR-5: FDA rounding at final step [LOW — CORRECT]
**What:** FDA rounding rules applied only at final label computation step.
**Impact:** None — this is correct. Verified by 76 tests (53 original + 23 sauce-specific).
**Status:** Validated.

### SR-6: Component nutrients not independently verified [MEDIUM]
**What:** Component nutrient profiles derived from ingredient lines. No separate verification for component-level claims.
**Impact:** Sauce variant macros (SR-8) especially vulnerable.
**Mitigation:** Same verification pipeline applies.
**Status:** Relies on existing verification.

### SR-7: No nutrient retention factors for cooking methods [HIGH]
**What:** No per-nutrient, per-method retention factors modeled. Only mass yield tracked.
**Impact:** Micronutrient values may overstate content for cooked components.
**Status:** Not addressed. Would require USDA retention factor tables.

### SR-8: Sauce variant macros are display-only [MEDIUM] ← NEW
**What:** SauceVariant model stores kcal/protein/carb/fat per 100g, but these values are entered manually by the chef and NOT verified against the ingredient-level nutrient data from ComponentLines.
**Impact:** If a sauce's ingredient data says 200 kcal/100g but the variant claims 150 kcal/100g, the variant display may be misleading. The label computation uses ingredient-level data (correct), but the variant display could confuse operators.
**Mitigation:** Variants are clearly labeled as operator-entered estimates. Label computation still uses the deterministic ingredient pipeline.
**ASSUMPTION:** Variant macros are used for operational convenience (portion planning), NOT for label computation. This is documented in ASSUMPTIONS.md.
**Status:** Known limitation. Tracked in OI-12.

### SR-9: Sauce portion scaling assumes linearity [LOW] ← NEW
**What:** Sauce nutrients are assumed to scale linearly with portion size (15g at 400kcal/100g = 60kcal, always).
**Impact:** This is scientifically correct for homogeneous liquids/pastes. Non-homogeneous sauces (chunky, separated) may have varying nutrient density per portion.
**Mitigation:** 23 sauce-specific scientific tests validate linear scaling behavior. Commercial sauce products are sufficiently homogeneous for this assumption.
**Status:** Validated by tests. Low risk for typical sauce products.

### SR-10: Incomplete core nutrients allowed in freeze [MEDIUM] ← NEW
**What:** Sprint 2 relaxed the quality gate to allow real imported lots with incomplete core nutrient data (previously blocked entirely). Labels from these lots are marked provisional with INCOMPLETE_CORE_NUTRIENTS reason code.
**Impact:** Provisional labels may understate or omit certain nutrient values.
**Mitigation:** Labels are flagged provisional. QA board surfaces these via evidence summary. Verification tasks exist for products missing core nutrients.
**ASSUMPTION:** Better to produce a provisional label than to block all meal service. Chef can still feed the client while nutrient data is being completed.
**Status:** Active — provisional flag visible in QA and label views.

## Test Coverage

- 198 total tests across all workspaces
- 190 nutrition engine tests:
  - 114 core engine tests
  - 53 scientific QA tests (yield, conversion, rounding, Atwater, hierarchy)
  - 23 sauce nutrient tests (scaling, variants, rounding, Atwater, allergens, integration)
- 8 other workspace tests (API, web, contracts, importers, mobile)

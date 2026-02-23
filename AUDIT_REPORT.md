# Nutrition Autopilot — Multi-Agent Scientific Audit Report

**Date:** 2026-02-23
**Auditor:** Master Auditor (6-agent coordinated audit)
**System:** Nutrition Autopilot v2 (post-Phase 3)

---

## SECTION 1 — Critical Failures

### CF-1: No Yield Factor Modeling (Agents 1, 4)

**Severity: CRITICAL**

The system has zero cooking yield modeling. The USDA fallback dataset contains both raw and cooked ingredient profiles mixed together, but the system has no mechanism to ensure the correct one is used.

**Evidence:**
- `RecipeLine.preparation` field exists in schema (schema.prisma line 259) but is **never read** during nutrient calculation
- `InventoryLot` has no `state` field (raw/cooked/dry)
- `fallbackByName()` in nutrient-autofill.ts inconsistently defaults: "ground turkey" → COOKED (line 174), "ground beef" → RAW (line 175), "chicken" → RAW (line 182), "turkey" → COOKED (line 183)

**Maximum Error:**
- 200g cooked chicken breast using RAW nutrient profile: 240 kcal computed vs 330 kcal actual = **-27% underreport**
- 200g raw chicken breast using COOKED nutrient profile: 330 kcal computed vs 240 kcal actual = **+37.5% overreport**
- Protein error: up to 17g per 200g serving (38%)

**Cooked/Raw pairs in fallback data:**

| Ingredient | Raw kcal/100g | Cooked kcal/100g | Max Error |
|---|---|---|---|
| Chicken Breast | 120 | 165 | 37.5% |
| Ground Beef 95% | 137 | 173 | 26% |
| Ground Turkey 93% | ~150 (est) | 182 | 21% |

### CF-2: Honey `added_sugars_g` = 82.12g (Agent 3, verified by Master)

**Severity: CRITICAL (regulatory)**

Natural honey has ALL sugars as intrinsic. Per FDA guidance (81 FR 33742), honey's sugars are NOT "added sugars" when sold as pure honey. The fallback JSON sets `added_sugars_g: 82.12` which would cause an FDA Nutrition Facts label to incorrectly display "Includes 82g Added Sugars" with 164% DV — a regulatory violation.

**File:** packages/data/usda-fallbacks.json, ING-HONEY
**Fix:** Set `added_sugars_g: 0`

### CF-3: Plausibility Protein Ceiling Too Low for Cooked Meat (Agent 3)

**Severity: HIGH**

plausibility.ts line 350: `checkRange("protein_g", 15, 35)` for MEAT_POULTRY. Cooked lean meats commonly reach 35-40g protein/100g. Dried/jerky can reach 45g+. This causes false positive plausibility warnings on legitimate data.

Similarly, FISH_SEAFOOD line 358: protein max 30g — too low for dried fish.

---

## SECTION 2 — Structural Risks

### SR-1: Category Field in JSON Never Used at Runtime (Agent 3 false alarm, corrected by Master)

Agent 3 flagged a "CRITICAL BUG" claiming JSON category names (FATS_OILS, SHELLFISH, BEEF, etc.) don't match plausibility.ts FoodCategory enum (OILS_FATS, FISH_SEAFOOD, MEAT_POULTRY).

**Master Auditor Verdict: FALSE ALARM.** The `.category` field in usda-fallbacks.json is metadata only — never read by any runtime code. The plausibility validator uses `detectFoodCategory()` which regex-matches on product **name**, not the JSON category field. Confirmed via grep: zero references to `.category` in nutrient-autofill.ts or plausibility.ts.

However, this is still a structural risk: if anyone adds code that reads the category field, the naming mismatch will bite.

### SR-2: No Unit Validation at Storage Layer (Agent 1)

`ProductNutrientValue.valuePer100g` is a bare Float with no constraint. If any data source provides per-serving or per-gram values, they'll be stored as-is and silently corrupt all downstream calculations. The OpenFoodFacts sodium path (nutrient-autofill.ts line 92-100) correctly handles g→mg conversion, but this is ad-hoc — no systematic unit validation exists.

### SR-3: Label Staleness After Source Update (Agent 6)

Once a LabelSnapshot is frozen, its `renderPayload` is immutable JSON. If `ProductNutrientValue` is later corrected, existing labels are NOT updated. No version reconciliation mechanism exists.

### SR-4: Verification Workflow Incomplete (Agent 6)

`verificationStatus` defaults to NEEDS_REVIEW but no code path ever sets it to VERIFIED. VerificationTasks are created but lack an approval workflow that propagates back to ProductNutrientValue.

### SR-5: Calorie Tolerance Discrepancy Between Engine and Plausibility (Agent 2)

engine.ts uses ±20% tolerance (FDA Class I). plausibility.ts uses ±15% tolerance. Both apply the same 35% exception for high-fiber foods. The 5% gap means the engine may PASS a label that plausibility would WARN on. This is not necessarily wrong (the engine check is for labels, the plausibility check is for data quality), but the discrepancy should be intentional and documented.

---

## SECTION 3 — Determinism Score

| Category | Score | Notes |
|---|---|---|
| Unit consistency | 82/100 | Core formula correct; yield factor gap |
| Macro↔Energy consistency | 90/100 | All deltas scientifically explained; tolerances justified |
| Scientific plausibility | 78/100 | Honey added_sugars wrong; protein ceilings too low |
| Yield factor symmetry | 40/100 | No yield modeling at all |
| Rounding & label logic | 98/100 | Full FDA 21 CFR 101.9 compliance |
| Traceability & evidence | 85/100 | Strong provenance; verification workflow incomplete |
| **OVERALL** | **79/100** | Yield factor gap is primary drag |

---

## SECTION 4 — Required Refactors (Ranked by Impact)

### Priority 1: Yield Factor Framework
- Add `preparedState` enum (RAW, COOKED, DRY) to RecipeLine
- Add `yieldFactor` Float to RecipeLine (e.g., 0.75 for chicken = 25% moisture loss)
- Apply yield correction in label-freeze.ts before nutrient scaling
- Standardize fallbackByName() to always document which state is returned
- **Impact: eliminates up to 37% calorie error**

### Priority 2: Fix Honey Added Sugars
- Set `added_sugars_g: 0` in usda-fallbacks.json for ING-HONEY
- Add plausibility rule: natural sweeteners (honey, maple syrup) should have `added_sugars_g ≈ 0`
- **Impact: prevents FDA regulatory violation**

### Priority 3: Widen Protein Plausibility Ranges
- MEAT_POULTRY: protein 15-40g (was 15-35g)
- FISH_SEAFOOD: protein 15-40g (was 15-30g)
- **Impact: eliminates false positive warnings on cooked lean meats**

### Priority 4: Standardize fallbackByName() Cooking State
- "ground turkey" and "ground beef" should both default to the same state (preferably COOKED, as recipes typically specify finished weights)
- Add explicit comment documenting the assumed state for each fallback
- **Impact: eliminates 10-26% inconsistency between ingredients in same recipe**

### Priority 5: Add Unit Validation Guardrails
- Add DB check constraint: `valuePer100g BETWEEN 0 AND 1000` (no nutrient can exceed 1000 per 100g)
- Add runtime validation in upsertNutrientsForProduct: reject values that fail basic sanity (protein_g > 100, fat_g > 100, kcal > 900)
- **Impact: prevents silent data corruption**

### Priority 6: Verification Status Workflow
- Add API endpoint to approve/reject VerificationTasks
- On approval: update ProductNutrientValue.verificationStatus to VERIFIED
- On rejection: flag for re-autofill
- **Impact: completes the evidence chain**

---

## SECTION 5 — Certification Verdict

### **CONDITIONAL**

**Passes:**
- ✅ FDA rounding rules: fully compliant (21 CFR 101.9)
- ✅ Macro↔Energy consistency: all 54 ingredients verified, all deltas scientifically explained
- ✅ Unit scaling formula: `(per100g × gramsConsumed) / 100` mathematically correct
- ✅ No premature truncation or precision loss
- ✅ Strong evidence lineage with full provenance tracking
- ✅ Daily Values match FDA 2020 regulations (all 40 nutrients verified)

**Blocks certification:**
- ❌ No yield factor modeling — maximum 37.5% calorie error on protein-heavy ingredients
- ❌ Honey added_sugars data error — FDA regulatory risk
- ❌ Protein plausibility ceilings too low — false positives on valid data

**Conditions for PASS:**
1. Implement yield factor framework (Priority 1)
2. Fix honey added_sugars to 0 (Priority 2)
3. Widen protein plausibility ranges (Priority 3)

Once these three conditions are met, the system achieves scientific certification for production use.

---

*Report generated by 6-agent parallel audit with Master Auditor cross-validation.*
*Agent claims verified against source code. Agent 3 category-mismatch false alarm identified and corrected.*

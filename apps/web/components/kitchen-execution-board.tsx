"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ── API Base ─────────────────────────────────────────────── */

function resolveApiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host.includes("onrender.com")) {
      return `${window.location.protocol}//${host.replace("-web", "-api")}`;
    }
    return `${window.location.protocol}//${host}:4000`;
  }
  return "http://localhost:4000";
}

/* ── Types ────────────────────────────────────────────────── */

type Checkpoint = {
  id: string;
  checkpointType: string;
  occurredAt: string;
  tempC: number | null;
  notes: string | null;
  timerDurationM: number | null;
  timerStartedAt: string | null;
};

type Batch = {
  id: string;
  componentName: string;
  componentType: string;
  status: string;
  plannedDate: string;
  batchCode: string | null;
  rawInputG: number;
  expectedYieldG: number;
  actualYieldG: number | null;
  yieldVariance: number | null;
  portionCount: number | null;
  portionSizeG: number | null;
  cookTempC: number | null;
  cookTimeMin: number | null;
  notes: string | null;
};

type BatchDetail = Batch & {
  componentId: string;
  chillStartedAt: string | null;
  chillCompletedAt: string | null;
  completedAt: string | null;
  component: {
    id: string;
    name: string;
    componentType: string;
    defaultYieldFactor: number;
    lines: Array<{
      id: string;
      ingredientName: string;
      lineOrder: number;
      targetGPer100g: number;
      preparation: string | null;
    }>;
  };
  checkpoints: Checkpoint[];
};

type PrepBatchSuggestion = {
  componentId: string;
  componentName: string;
  componentType: string;
  rawG: number;
  cookedG: number;
  yieldFactor: number;
  mealCount: number;
  priority: "high" | "medium" | "low";
  isShortage: boolean;
  sharingOpportunity: boolean;
  sharedMealCount: number;
};

type PrepPortionPlanEntry = {
  label: string;
  clientId: string;
  clientName: string;
  serviceDate: string;
  mealSlot: string;
  cookedG: number;
  mealScheduleId: string;
};

type PrepBatchPortionPlan = {
  componentId: string;
  componentName: string;
  totalCookedG: number;
  totalRawG: number;
  portionCount: number;
  portions: PrepPortionPlanEntry[];
};

type PrepShortage = {
  componentId: string;
  componentName: string;
  componentType: string;
  shortageG: number;
};

type PrepDraft = {
  id?: string;
  weekStart: string;
  weekEnd: string;
  batchSuggestions: PrepBatchSuggestion[];
  shortages: PrepShortage[];
  totalMeals: number;
  totalComponents: number;
  portionPlans?: PrepBatchPortionPlan[];
};

type BatchPortion = {
  id: string;
  label: string;
  portionG: number;
  serviceDate: string | null;
  mealSlot: string | null;
  clientName: string | null;
  sealed: boolean;
};

/* ── Constants ────────────────────────────────────────────── */

const STATUS_ORDER = ["PLANNED", "IN_PREP", "COOKING", "CHILLING", "PORTIONED", "READY"];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PLANNED: { label: "Planned", color: "var(--c-info)" },
  IN_PREP: { label: "In Prep", color: "var(--c-accent)" },
  COOKING: { label: "Cooking", color: "var(--c-danger)" },
  CHILLING: { label: "Chilling", color: "var(--c-info)" },
  PORTIONED: { label: "Portioned", color: "var(--c-warn)" },
  READY: { label: "Ready", color: "var(--c-success)" },
  CANCELLED: { label: "Cancelled", color: "var(--c-ink-muted)" },
};

const TYPE_LABELS: Record<string, string> = {
  PROTEIN: "Protein",
  CARB_BASE: "Carb / Base",
  VEGETABLE: "Vegetable",
  SAUCE: "Sauce",
  CONDIMENT: "Condiment",
  OTHER: "Other",
};

/** Minimum cooked grams to show in prep queue — filters out seasonings/condiments */
const PREP_MIN_COOKED_G = 50;

const NEXT_ACTION_LABELS: Record<string, string> = {
  PLANNED: "Start Prep",
  IN_PREP: "Start Cooking",
  COOKING: "Cooking Complete",
  CHILLING: "Chill Complete",
  PORTIONED: "Mark Ready",
};

const CHECKPOINT_MAP: Record<string, string> = {
  COOKING: "COOK_START",
  CHILLING: "CHILL_START",
};

type FilterKey = "due_now" | "active" | "all" | "completed";

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: "due_now", label: "Due Now" },
  { key: "active", label: "Active" },
  { key: "all", label: "All" },
  { key: "completed", label: "Completed Today" },
];

/* ── Helpers ──────────────────────────────────────────────── */

function formatG(grams: number): string {
  if (grams >= 1000) return `${(grams / 1000).toFixed(1)} kg`;
  return `${Math.round(grams)} g`;
}

function nextStatus(current: string): string | null {
  const idx = STATUS_ORDER.indexOf(current);
  if (idx < 0 || idx >= STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[idx + 1] ?? null;
}

function formatTimer(seconds: number): string {
  const absSeconds = Math.abs(seconds);
  const h = Math.floor(absSeconds / 3600);
  const m = Math.floor((absSeconds % 3600) / 60);
  const s = Math.floor(absSeconds % 60);
  const sign = seconds < 0 ? "-" : "";
  if (h > 0) {
    return `${sign}${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${sign}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + "T12:00:00Z");
  const e = new Date(end + "T12:00:00Z");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[s.getUTCMonth()]} ${s.getUTCDate()} \u2014 ${months[e.getUTCMonth()]} ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
}

/* ── Hold Button ─────────────────────────────────────────── */

function HoldButton({
  label,
  onComplete,
  disabled,
  color,
  style,
}: {
  label: string;
  onComplete: () => void;
  disabled?: boolean;
  color?: string;
  style?: React.CSSProperties;
}) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);
  const completedRef = useRef(false);

  const HOLD_MS = 1000;

  const startHold = useCallback(() => {
    if (disabled) return;
    completedRef.current = false;
    startRef.current = Date.now();
    setHolding(true);
    setProgress(0);

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const pct = Math.min(elapsed / HOLD_MS, 1);
      setProgress(pct);

      if (pct >= 1 && !completedRef.current) {
        completedRef.current = true;
        if (timerRef.current) clearInterval(timerRef.current);
        setHolding(false);
        setProgress(0);
        onComplete();
      }
    }, 30);
  }, [disabled, onComplete]);

  const cancelHold = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setHolding(false);
    setProgress(0);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const bg = color ?? "var(--c-primary)";

  return (
    <button
      onMouseDown={startHold}
      onMouseUp={cancelHold}
      onMouseLeave={cancelHold}
      onTouchStart={startHold}
      onTouchEnd={cancelHold}
      onTouchCancel={cancelHold}
      disabled={disabled}
      style={{
        position: "relative",
        overflow: "hidden",
        minHeight: 56,
        width: "100%",
        fontSize: 18,
        fontWeight: "var(--weight-semibold)" as string,
        background: bg,
        color: "#0a0a0b",
        border: "none",
        borderRadius: "var(--r-md)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        WebkitUserSelect: "none",
        userSelect: "none",
        ...style,
      }}
    >
      {/* Progress fill */}
      {holding && (
        <span
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.15)",
            transformOrigin: "left",
            transform: `scaleX(${progress})`,
            transition: "none",
            pointerEvents: "none",
          }}
        />
      )}
      <span style={{ position: "relative", zIndex: 1 }}>
        {holding ? `Hold... ${Math.round(progress * 100)}%` : label}
      </span>
    </button>
  );
}

/* ── Progress Stepper ────────────────────────────────────── */

function ProgressStepper({ currentStatus }: { currentStatus: string }) {
  const currentIdx = STATUS_ORDER.indexOf(currentStatus);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        width: "100%",
        marginTop: "var(--sp-3)",
        marginBottom: "var(--sp-3)",
      }}
    >
      {STATUS_ORDER.map((step, i) => {
        const info = STATUS_LABELS[step];
        const isDone = i < currentIdx;
        const isCurrent = i === currentIdx;
        const color = isDone || isCurrent ? (info?.color ?? "var(--c-ink-muted)") : "var(--c-border)";

        return (
          <div
            key={step}
            style={{
              display: "flex",
              alignItems: "center",
              flex: i < STATUS_ORDER.length - 1 ? 1 : "none",
            }}
          >
            {/* Circle */}
            <div
              style={{
                width: isCurrent ? 28 : 20,
                height: isCurrent ? 28 : 20,
                borderRadius: "var(--r-full)",
                background: isDone || isCurrent ? color : "transparent",
                border: isDone || isCurrent ? `2px solid ${color}` : "2px solid var(--c-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "all 0.2s ease",
              }}
            >
              {isDone && (
                <span style={{ color: "#0a0a0b", fontSize: 12, fontWeight: 700, lineHeight: 1 }}>
                  &#10003;
                </span>
              )}
              {isCurrent && (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "var(--r-full)",
                    background: "#0a0a0b",
                  }}
                />
              )}
            </div>

            {/* Connecting line */}
            {i < STATUS_ORDER.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  background: isDone ? color : "var(--c-border)",
                  marginLeft: 2,
                  marginRight: 2,
                  transition: "background 0.2s ease",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Stepper Labels (shown below stepper on wider screens) ── */

function StepperLabels({ currentStatus }: { currentStatus: string }) {
  const currentIdx = STATUS_ORDER.indexOf(currentStatus);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        width: "100%",
        marginBottom: "var(--sp-4)",
      }}
    >
      {STATUS_ORDER.map((step, i) => {
        const info = STATUS_LABELS[step];
        const isDone = i < currentIdx;
        const isCurrent = i === currentIdx;
        return (
          <span
            key={step}
            style={{
              fontSize: "var(--text-xs)",
              fontWeight: isCurrent ? "var(--weight-semibold)" : "var(--weight-normal)",
              color: isDone || isCurrent ? (info?.color ?? "var(--c-ink-muted)") : "var(--c-ink-muted)",
              textAlign: "center",
              flex: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            } as React.CSSProperties}
          >
            {info?.label ?? step}
          </span>
        );
      })}
    </div>
  );
}

/* ── Timer Display ───────────────────────────────────────── */

function TimerDisplay({
  batch,
  checkpoints,
}: {
  batch: Batch;
  checkpoints: Checkpoint[];
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (batch.status === "COOKING") {
    // Find last COOK_START checkpoint
    const cookStart = [...checkpoints]
      .reverse()
      .find((c) => c.checkpointType === "COOK_START");

    if (!cookStart) {
      return (
        <div style={{ textAlign: "center", marginBottom: "var(--sp-3)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)" }}>
            No cook start checkpoint recorded
          </div>
        </div>
      );
    }

    const startTime = new Date(cookStart.timerStartedAt ?? cookStart.occurredAt).getTime();
    const elapsedSec = (now - startTime) / 1000;

    if (batch.cookTimeMin) {
      const totalSec = batch.cookTimeMin * 60;
      const remaining = totalSec - elapsedSec;
      const isOvertime = remaining < 0;

      return (
        <div style={{ textAlign: "center", marginBottom: "var(--sp-3)" }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 36,
              fontWeight: "var(--weight-bold)" as string,
              color: isOvertime ? "var(--c-danger)" : "var(--c-accent)",
              letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
            }}
          >
            {formatTimer(remaining)}
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", marginTop: "var(--sp-1)" }}>
            {isOvertime ? "overtime" : "remaining"} ({batch.cookTimeMin} min cook time)
          </div>
        </div>
      );
    }

    // No cookTimeMin set: show elapsed
    return (
      <div style={{ textAlign: "center", marginBottom: "var(--sp-3)" }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 36,
            fontWeight: "var(--weight-bold)" as string,
            color: "var(--c-accent)",
            letterSpacing: "-0.02em",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {formatTimer(elapsedSec)}
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", marginTop: "var(--sp-1)" }}>
          elapsed (cooking)
        </div>
      </div>
    );
  }

  if (batch.status === "CHILLING") {
    // Find last CHILL_START checkpoint
    const chillStart = [...checkpoints]
      .reverse()
      .find((c) => c.checkpointType === "CHILL_START");

    if (!chillStart) {
      return (
        <div style={{ textAlign: "center", marginBottom: "var(--sp-3)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)" }}>
            No chill start checkpoint recorded
          </div>
        </div>
      );
    }

    const startTime = new Date(chillStart.timerStartedAt ?? chillStart.occurredAt).getTime();
    const elapsedSec = (now - startTime) / 1000;

    return (
      <div style={{ textAlign: "center", marginBottom: "var(--sp-3)" }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 36,
            fontWeight: "var(--weight-bold)" as string,
            color: "var(--c-info)",
            letterSpacing: "-0.02em",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {formatTimer(elapsedSec)}
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", marginTop: "var(--sp-1)" }}>
          elapsed (chilling)
        </div>
      </div>
    );
  }

  return null;
}

/* ── Batch Execution Card ────────────────────────────────── */

function BatchExecutionCard({
  batch,
  onAdvance,
  onPostCheckpoint,
  onFlagIssue,
  focused,
  onFocus,
  portionsExpanded,
  portionsList,
  portionsIsLoading,
  onTogglePortions,
  onToggleSeal,
}: {
  batch: Batch;
  onAdvance: (batchId: string, newStatus: string, actualYieldG?: number) => Promise<void>;
  onPostCheckpoint: (batchId: string, checkpointType: string, opts?: { notes?: string; timerDurationM?: number }) => Promise<void>;
  onFlagIssue: (batchId: string, note: string) => void;
  focused: boolean;
  onFocus: () => void;
  portionsExpanded: boolean;
  portionsList: BatchPortion[];
  portionsIsLoading: boolean;
  onTogglePortions: () => void;
  onToggleSeal: (portionId: string, sealed: boolean) => void;
}) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [advancing, setAdvancing] = useState(false);
  const [yieldInput, setYieldInput] = useState("");
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [issueText, setIssueText] = useState("");
  const [showIssueInput, setShowIssueInput] = useState(false);

  const apiBase = resolveApiBase();
  const next = nextStatus(batch.status);
  const statusInfo = STATUS_LABELS[batch.status] ?? { label: batch.status, color: "var(--c-ink-muted)" };
  const typeLabel = TYPE_LABELS[batch.componentType] ?? batch.componentType;

  // Fetch checkpoints for active batches
  useEffect(() => {
    if (batch.status === "COOKING" || batch.status === "CHILLING") {
      fetch(`${apiBase}/v1/batches/${batch.id}/checkpoints`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data: Checkpoint[]) => setCheckpoints(data))
        .catch(() => {});
    }
  }, [apiBase, batch.id, batch.status]);

  const handleAdvance = async () => {
    if (!next || advancing) return;
    setAdvancing(true);
    try {
      // Post checkpoint if advancing to COOKING or CHILLING
      const cpType = CHECKPOINT_MAP[next];
      if (cpType) {
        await onPostCheckpoint(batch.id, cpType, {
          timerDurationM: next === "COOKING" && batch.cookTimeMin ? batch.cookTimeMin : undefined,
        });
      }

      const yieldVal = batch.status === "PORTIONED" && yieldInput ? parseFloat(yieldInput) : undefined;
      await onAdvance(batch.id, next, yieldVal);
      setYieldInput("");
    } finally {
      setAdvancing(false);
    }
  };

  const handleFlagIssue = () => {
    if (!issueText.trim()) return;
    onFlagIssue(batch.id, issueText.trim());
    setIssueText("");
    setShowIssueInput(false);
  };

  const needsYield = batch.status === "PORTIONED";
  const isReady = batch.status === "READY";

  return (
    <div
      className="card"
      onClick={onFocus}
      style={{
        padding: "var(--sp-6)",
        minHeight: 200,
        borderRadius: "var(--r-lg)",
        borderColor: focused ? "var(--c-primary-muted)" : undefined,
        boxShadow: focused ? "var(--shadow-md), 0 0 0 1px var(--c-primary-muted)" : undefined,
        cursor: "pointer",
        transition: "box-shadow 0.2s ease, border-color 0.2s ease",
      }}
    >
      {/* Header: Component name + badges */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "var(--sp-3)",
          flexWrap: "wrap",
          marginBottom: "var(--sp-2)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--text-xl)",
              fontWeight: "var(--weight-bold)" as string,
              letterSpacing: "-0.01em",
              lineHeight: "var(--leading-tight)",
            }}
          >
            {batch.componentName}
          </div>
          <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap", marginTop: "var(--sp-2)" }}>
            {/* Type badge */}
            <span
              className="badge"
              style={{
                background: "var(--c-surface-alt)",
                color: "var(--c-ink-soft)",
                border: "1px solid var(--c-border-light)",
                fontSize: 12,
                fontWeight: "var(--weight-semibold)" as string,
              }}
            >
              {typeLabel}
            </span>
            {/* Status badge */}
            <span
              className="badge"
              style={{
                background: `${statusInfo.color}22`,
                color: statusInfo.color,
                border: `1px solid ${statusInfo.color}44`,
                fontSize: 12,
                fontWeight: "var(--weight-bold)" as string,
              }}
            >
              {statusInfo.label}
            </span>
            {batch.batchCode && (
              <span
                className="badge"
                style={{
                  background: "var(--c-surface-alt)",
                  color: "var(--c-ink-muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                }}
              >
                {batch.batchCode}
              </span>
            )}
          </div>
        </div>

        {/* Issue flag */}
        <button
          className="btn btn-ghost"
          onClick={(e) => {
            e.stopPropagation();
            setShowIssueInput((v) => !v);
          }}
          style={{ color: "var(--c-danger)", fontSize: "var(--text-lg)", padding: "var(--sp-2)" }}
          title="Flag issue"
        >
          &#9888;
        </button>
      </div>

      {/* Issue input */}
      {showIssueInput && (
        <div
          style={{
            display: "flex",
            gap: "var(--sp-2)",
            marginBottom: "var(--sp-3)",
            alignItems: "center",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            placeholder="Describe issue..."
            value={issueText}
            onChange={(e) => setIssueText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleFlagIssue()}
            style={{ flex: 1, fontSize: "var(--text-sm)" }}
          />
          <button
            className="btn btn-sm"
            style={{ background: "var(--c-danger)", color: "#fff", minHeight: 36 }}
            onClick={handleFlagIssue}
            disabled={!issueText.trim()}
          >
            Flag
          </button>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => setShowIssueInput(false)}
            style={{ minHeight: 36 }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Progress stepper */}
      <ProgressStepper currentStatus={batch.status} />
      <StepperLabels currentStatus={batch.status} />

      {/* Key metrics */}
      <div
        style={{
          display: "flex",
          gap: "var(--sp-4)",
          flexWrap: "wrap",
          marginBottom: "var(--sp-4)",
          padding: "var(--sp-3)",
          background: "var(--c-surface-alt)",
          borderRadius: "var(--r-md)",
          fontSize: "var(--text-sm)",
        }}
      >
        <div>
          <span style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-xs)" }}>Raw Input</span>
          <div style={{ fontWeight: "var(--weight-semibold)" as string, fontVariantNumeric: "tabular-nums" }}>
            {formatG(batch.rawInputG)}
          </div>
        </div>
        <div style={{ color: "var(--c-ink-muted)", display: "flex", alignItems: "center" }}>
          &#8594;
        </div>
        <div>
          <span style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-xs)" }}>
            {batch.actualYieldG !== null ? "Actual Yield" : "Expected Yield"}
          </span>
          <div style={{ fontWeight: "var(--weight-semibold)" as string, fontVariantNumeric: "tabular-nums" }}>
            {batch.actualYieldG !== null ? formatG(batch.actualYieldG) : formatG(batch.expectedYieldG)}
          </div>
        </div>
        {batch.portionCount !== null && (
          <>
            <div style={{ color: "var(--c-ink-muted)", display: "flex", alignItems: "center" }}>
              |
            </div>
            <div>
              <span style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-xs)" }}>Portions</span>
              <div style={{ fontWeight: "var(--weight-semibold)" as string, fontVariantNumeric: "tabular-nums" }}>
                {batch.portionCount}
                {batch.portionSizeG ? ` x ${formatG(batch.portionSizeG)}` : ""}
              </div>
            </div>
          </>
        )}
        {batch.cookTempC !== null && (
          <>
            <div style={{ color: "var(--c-ink-muted)", display: "flex", alignItems: "center" }}>
              |
            </div>
            <div>
              <span style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-xs)" }}>Cook</span>
              <div style={{ fontWeight: "var(--weight-semibold)" as string, fontVariantNumeric: "tabular-nums" }}>
                {batch.cookTempC}&deg;C / {batch.cookTimeMin ?? "--"} min
              </div>
            </div>
          </>
        )}
        {batch.yieldVariance !== null && (
          <>
            <div style={{ color: "var(--c-ink-muted)", display: "flex", alignItems: "center" }}>
              |
            </div>
            <div>
              <span style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-xs)" }}>Yield Var.</span>
              <div
                style={{
                  fontWeight: "var(--weight-semibold)" as string,
                  color:
                    Math.abs(batch.yieldVariance * 100) > 30
                      ? "var(--c-danger)"
                      : Math.abs(batch.yieldVariance * 100) > 15
                        ? "var(--c-warn)"
                        : "var(--c-success)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {batch.yieldVariance > 0 ? "+" : ""}
                {Math.round(batch.yieldVariance * 100)}%
              </div>
            </div>
          </>
        )}
      </div>

      {/* Portions panel */}
      {batch.portionCount !== null && batch.portionCount > 0 && (
        <div style={{ marginBottom: "var(--sp-3)" }}>
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePortions(); }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "var(--text-xs)",
              color: "var(--c-primary)",
              padding: 0,
              fontWeight: 500,
            }}
          >
            {portionsExpanded ? "\u25B2 Hide" : "\u25BC Show"} {batch.portionCount} portions
            {(() => {
              if (portionsList.length === 0) return null;
              const sealedCount = portionsList.filter((p) => p.sealed).length;
              if (sealedCount === 0) return null;
              return (
                <span style={{ marginLeft: 6, color: "var(--c-success)" }}>
                  {sealedCount}/{portionsList.length} sealed
                </span>
              );
            })()}
          </button>
          {portionsExpanded && (
            <div style={{
              borderTop: "1px solid var(--c-border)",
              marginTop: "var(--sp-2)",
              paddingTop: "var(--sp-2)",
            }}>
              {portionsIsLoading ? (
                <div style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-muted)" }}>Loading portions...</div>
              ) : portionsList.length === 0 ? (
                <div style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-muted)" }}>No individual portions.</div>
              ) : (
                <>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", marginBottom: "var(--sp-2)" }}>
                    <strong>{portionsList.filter((p) => p.sealed).length}/{portionsList.length}</strong> portions sealed
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {portionsList.map((p) => (
                      <label
                        key={p.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--sp-2)",
                          padding: "4px 8px",
                          borderRadius: "var(--r-sm, 4px)",
                          background: p.sealed ? "var(--c-success-soft, rgba(34,197,94,0.08))" : "transparent",
                          cursor: "pointer",
                          fontSize: "var(--text-sm)",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={p.sealed}
                          onChange={(e) => onToggleSeal(p.id, e.target.checked)}
                          style={{ flexShrink: 0 }}
                        />
                        <span style={{
                          flex: 1,
                          textDecoration: p.sealed ? "line-through" : "none",
                          color: p.sealed ? "var(--c-ink-muted)" : "var(--c-ink)",
                        }}>
                          {p.label}
                        </span>
                        {p.sealed && (
                          <span style={{ color: "var(--c-success)", fontSize: "var(--text-xs)", flexShrink: 0 }}>
                            &#10003;
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Timer for COOKING / CHILLING */}
      <TimerDisplay batch={batch} checkpoints={checkpoints} />

      {/* Notes */}
      {batch.notes && (
        <div
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--c-ink-soft)",
            marginBottom: "var(--sp-3)",
            fontStyle: "italic",
            padding: "var(--sp-2) var(--sp-3)",
            background: "var(--c-surface-alt)",
            borderRadius: "var(--r-sm)",
            borderLeft: batch.notes.startsWith("\u26A0")
              ? "3px solid var(--c-danger)"
              : "3px solid var(--c-border)",
          }}
        >
          {batch.notes}
        </div>
      )}

      {/* Notes input */}
      <div style={{ marginBottom: "var(--sp-3)" }} onClick={(e) => e.stopPropagation()}>
        <button
          className="btn btn-ghost"
          style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", padding: "var(--sp-1) 0" }}
          onClick={() => setNotesExpanded((v) => !v)}
        >
          {notesExpanded ? "Hide notes" : "+ Add note"}
        </button>
        {notesExpanded && (
          <div style={{ marginTop: "var(--sp-2)" }}>
            <textarea
              rows={2}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Enter notes for this batch..."
              style={{ fontSize: "var(--text-sm)", resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-2)" }}>
              <button
                className="btn btn-sm btn-outline"
                disabled={!noteText.trim()}
                onClick={() => {
                  if (noteText.trim()) {
                    onPostCheckpoint(batch.id, "READY_CHECK", { notes: noteText.trim() });
                    setNoteText("");
                    setNotesExpanded(false);
                  }
                }}
              >
                Save Note
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Next Action */}
      <div onClick={(e) => e.stopPropagation()}>
        {isReady && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--sp-2)",
              padding: "var(--sp-3)",
              background: "var(--c-success-soft)",
              borderRadius: "var(--r-md)",
              color: "var(--c-success)",
              fontWeight: "var(--weight-semibold)" as string,
              fontSize: "var(--text-lg)",
            }}
          >
            &#10003; Complete
          </div>
        )}

        {needsYield && (
          <div style={{ marginBottom: "var(--sp-3)" }}>
            <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)", marginBottom: "var(--sp-2)" }}>
              Actual yield (grams) — required before marking ready
            </label>
            <input
              type="number"
              placeholder="e.g., 1850"
              value={yieldInput}
              onChange={(e) => setYieldInput(e.target.value)}
              style={{
                fontSize: "var(--text-lg)",
                padding: "var(--sp-3)",
                fontVariantNumeric: "tabular-nums",
                fontFamily: "var(--font-mono)",
              }}
            />
          </div>
        )}

        {next && !isReady && (
          <HoldButton
            label={NEXT_ACTION_LABELS[batch.status] ?? `Advance to ${STATUS_LABELS[next]?.label ?? next}`}
            onComplete={handleAdvance}
            disabled={advancing || (needsYield && !yieldInput)}
            color={
              batch.status === "PLANNED"
                ? "var(--c-primary)"
                : batch.status === "IN_PREP"
                  ? "var(--c-accent)"
                  : batch.status === "COOKING"
                    ? "var(--c-danger)"
                    : batch.status === "CHILLING"
                      ? "var(--c-info)"
                      : "var(--c-primary)"
            }
          />
        )}
      </div>
    </div>
  );
}

/* ── Prep Queue Card ─────────────────────────────────────── */

function PrepQueueCard({
  suggestion,
  portionPlan,
  expanded,
  onToggleExpand,
  onQueueUp,
  queued,
  creating,
}: {
  suggestion: PrepBatchSuggestion;
  portionPlan?: PrepBatchPortionPlan;
  expanded: boolean;
  onToggleExpand: () => void;
  onQueueUp: () => void;
  queued: boolean;
  creating: boolean;
}) {
  const typeLabel = TYPE_LABELS[suggestion.componentType] ?? suggestion.componentType;
  const priorityColors: Record<string, string> = {
    high: "var(--c-danger)",
    medium: "var(--c-accent)",
    low: "var(--c-info)",
  };
  const priorityColor = priorityColors[suggestion.priority] ?? "var(--c-info)";
  const portionCount = portionPlan?.portionCount ?? suggestion.mealCount;

  return (
    <div
      className="card"
      style={{
        padding: "var(--sp-5)",
        borderRadius: "var(--r-lg)",
        borderLeft: `3px solid ${priorityColor}`,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "var(--sp-3)",
          flexWrap: "wrap",
          marginBottom: "var(--sp-3)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--text-lg)",
              fontWeight: "var(--weight-bold)" as string,
              letterSpacing: "-0.01em",
            }}
          >
            {suggestion.componentName}
          </div>
          <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap", marginTop: "var(--sp-2)" }}>
            <span
              className="badge"
              style={{
                background: "var(--c-surface-alt)",
                color: "var(--c-ink-soft)",
                border: "1px solid var(--c-border-light)",
                fontSize: 12,
                fontWeight: "var(--weight-semibold)" as string,
              }}
            >
              {typeLabel}
            </span>
            <span
              className="badge"
              style={{
                background: `${priorityColor}22`,
                color: priorityColor,
                border: `1px solid ${priorityColor}44`,
                fontSize: 12,
                fontWeight: "var(--weight-bold)" as string,
              }}
            >
              {suggestion.priority.charAt(0).toUpperCase() + suggestion.priority.slice(1)} Priority
            </span>
            {suggestion.isShortage && (
              <span
                className="badge"
                style={{
                  background: "rgba(239,68,68,0.1)",
                  color: "var(--c-danger)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  fontSize: 12,
                  fontWeight: "var(--weight-semibold)" as string,
                }}
              >
                Shortage
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div
        style={{
          display: "flex",
          gap: "var(--sp-4)",
          flexWrap: "wrap",
          marginBottom: "var(--sp-3)",
          padding: "var(--sp-3)",
          background: "var(--c-surface-alt)",
          borderRadius: "var(--r-md)",
          fontSize: "var(--text-sm)",
        }}
      >
        <div>
          <span style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-xs)" }}>Raw</span>
          <div style={{ fontWeight: "var(--weight-semibold)" as string, fontVariantNumeric: "tabular-nums" }}>
            {formatG(suggestion.rawG)}
          </div>
        </div>
        <div style={{ color: "var(--c-ink-muted)", display: "flex", alignItems: "center" }}>&#8594;</div>
        <div>
          <span style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-xs)" }}>Cooked</span>
          <div style={{ fontWeight: "var(--weight-semibold)" as string, fontVariantNumeric: "tabular-nums" }}>
            {formatG(suggestion.cookedG)}
          </div>
        </div>
        <div style={{ color: "var(--c-ink-muted)", display: "flex", alignItems: "center" }}>|</div>
        <div>
          <span style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-xs)" }}>Yield</span>
          <div style={{ fontWeight: "var(--weight-semibold)" as string, fontVariantNumeric: "tabular-nums" }}>
            {suggestion.yieldFactor.toFixed(2)}
          </div>
        </div>
        <div style={{ color: "var(--c-ink-muted)", display: "flex", alignItems: "center" }}>|</div>
        <div>
          <span style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-xs)" }}>Meals</span>
          <div style={{ fontWeight: "var(--weight-semibold)" as string, fontVariantNumeric: "tabular-nums" }}>
            {suggestion.mealCount}
          </div>
        </div>
        <div style={{ color: "var(--c-ink-muted)", display: "flex", alignItems: "center" }}>|</div>
        <div>
          <span style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-xs)" }}>Portions</span>
          <div style={{ fontWeight: "var(--weight-semibold)" as string, fontVariantNumeric: "tabular-nums" }}>
            {portionCount}
          </div>
        </div>
      </div>

      {/* Portions toggle */}
      {portionPlan && portionPlan.portionCount > 0 && (
        <div style={{ marginBottom: "var(--sp-3)" }}>
          <button
            onClick={onToggleExpand}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "var(--text-xs)",
              color: "var(--c-primary)",
              padding: 0,
              fontWeight: 500,
            }}
          >
            {expanded ? "\u25B2 Hide" : "\u25BC Show"} {portionPlan.portionCount} portions
          </button>
          {expanded && (
            <div
              style={{
                marginTop: "var(--sp-2)",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {portionPlan.portions.map((p, i) => (
                <div
                  key={i}
                  style={{
                    padding: "4px 8px",
                    borderRadius: "var(--r-sm, 4px)",
                    fontSize: "var(--text-sm)",
                    color: "var(--c-ink-soft)",
                  }}
                >
                  {p.label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Queue Up button */}
      <button
        className={`btn btn-sm ${queued ? "btn-outline" : "btn-primary"}`}
        disabled={queued || creating}
        onClick={onQueueUp}
        style={{
          width: "100%",
          minHeight: 40,
          ...(queued ? { color: "var(--c-success)", borderColor: "var(--c-success)" } : {}),
        }}
      >
        {creating ? "Creating..." : queued ? "\u2713 Queued" : "Queue Up"}
      </button>
    </div>
  );
}

/* ── Main Board ──────────────────────────────────────────── */

export function KitchenExecutionBoard() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("active");
  const [focusedBatchId, setFocusedBatchId] = useState<string | null>(null);

  // Prep Queue state — always starts from today, no looking back
  const [weekStart, setWeekStart] = useState(() => todayISO());
  const [weekEnd, setWeekEnd] = useState(() => addDays(todayISO(), 6));
  const [prepDraft, setPrepDraft] = useState<PrepDraft | null>(null);
  const [prepLoading, setPrepLoading] = useState(true);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [creatingBatchFor, setCreatingBatchFor] = useState<string | null>(null);
  const [queuedComponentIds, setQueuedComponentIds] = useState<Set<string>>(new Set());
  const [expandedSuggestions, setExpandedSuggestions] = useState<Set<string>>(new Set());

  // Portions state for execution batch cards
  const [portionsCache, setPortionsCache] = useState<Record<string, BatchPortion[]>>({});
  const [expandedPortions, setExpandedPortions] = useState<Set<string>>(new Set());
  const [portionsLoading, setPortionsLoading] = useState<Set<string>>(new Set());

  const apiBase = resolveApiBase();

  /* ── Fetch batches ─────────────────────────────────── */

  const fetchBatches = useCallback(async () => {
    try {
      let statusParam = "";
      const today = todayISO();

      switch (filter) {
        case "due_now":
          statusParam = "status=PLANNED";
          break;
        case "active":
          statusParam = "status=IN_PREP,COOKING,CHILLING";
          break;
        case "completed":
          statusParam = "status=READY,PORTIONED";
          break;
        case "all":
          statusParam = "status=PLANNED,IN_PREP,COOKING,CHILLING,PORTIONED,READY";
          break;
      }

      const res = await fetch(`${apiBase}/v1/batches${statusParam ? `?${statusParam}` : ""}`);
      if (!res.ok) return;

      let data: Batch[] = await res.json();

      // Additional client-side filtering
      if (filter === "due_now") {
        data = data.filter((b) => b.plannedDate <= today);
      }
      if (filter === "completed") {
        data = data.filter((b) => b.plannedDate === today);
      }

      setBatches(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [apiBase, filter]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(fetchBatches, 30_000);
    return () => clearInterval(id);
  }, [fetchBatches]);

  /* ── Prep Draft ────────────────────────────────────── */

  const fetchPrepDraft = useCallback(async () => {
    setPrepLoading(true);
    setPrepError(null);
    try {
      const [draftRes, batchesRes] = await Promise.all([
        fetch(`${apiBase}/v1/prep-drafts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weekStart, weekEnd, scheduleAware: true }),
        }),
        fetch(`${apiBase}/v1/batches?status=PLANNED,IN_PREP,COOKING,CHILLING,PORTIONED,READY`),
      ]);
      if (!draftRes.ok) {
        setPrepError("Failed to load prep draft");
        return;
      }
      const draftData = await draftRes.json();
      setPrepDraft(draftData.draft);

      // Dedup: mark suggestions whose component already has a batch
      if (batchesRes.ok) {
        const existingBatches: Batch[] = await batchesRes.json();
        const existingNames = new Set(existingBatches.map((b) => b.componentName));
        const suggestions: PrepBatchSuggestion[] = draftData.draft?.batchSuggestions ?? [];
        const queued = new Set<string>();
        for (const s of suggestions) {
          if (existingNames.has(s.componentName)) {
            queued.add(s.componentId);
          }
        }
        setQueuedComponentIds(queued);
      }
    } catch {
      setPrepError("Failed to load prep draft");
    } finally {
      setPrepLoading(false);
    }
  }, [apiBase, weekStart, weekEnd]);

  useEffect(() => {
    fetchPrepDraft();
  }, [fetchPrepDraft]);

  const shiftWeek = useCallback((days: number) => {
    setWeekStart((prev) => {
      const next = addDays(prev, days);
      setWeekEnd(addDays(next, 6));
      return next;
    });
  }, []);

  const handleCreateFromSchedule = useCallback(
    async (componentId: string) => {
      setCreatingBatchFor(componentId);
      try {
        const res = await fetch(`${apiBase}/v1/batches/from-schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ componentId, weekStart, weekEnd }),
        });
        if (res.ok) {
          setQueuedComponentIds((prev) => new Set(prev).add(componentId));
          await fetchBatches();
        }
      } catch {
        // silent
      } finally {
        setCreatingBatchFor(null);
      }
    },
    [apiBase, weekStart, weekEnd, fetchBatches],
  );

  const toggleSuggestionExpand = useCallback((componentId: string) => {
    setExpandedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(componentId)) {
        next.delete(componentId);
      } else {
        next.add(componentId);
      }
      return next;
    });
  }, []);

  /* ── Portions (execution cards) ────────────────────── */

  const togglePortions = useCallback(
    async (batchId: string) => {
      setExpandedPortions((prev) => {
        const next = new Set(prev);
        if (next.has(batchId)) {
          next.delete(batchId);
        } else {
          next.add(batchId);
        }
        return next;
      });

      if (!portionsCache[batchId]) {
        setPortionsLoading((prev) => new Set(prev).add(batchId));
        try {
          const res = await fetch(`${apiBase}/v1/batches/${batchId}/portions`);
          if (res.ok) {
            const data = await res.json();
            setPortionsCache((prev) => ({ ...prev, [batchId]: data.portions ?? [] }));
          }
        } catch {
          // silent
        } finally {
          setPortionsLoading((prev) => {
            const next = new Set(prev);
            next.delete(batchId);
            return next;
          });
        }
      }
    },
    [apiBase, portionsCache],
  );

  const handleToggleSeal = useCallback(
    async (batchId: string, portionId: string, sealed: boolean) => {
      try {
        const res = await fetch(`${apiBase}/v1/batches/${batchId}/portions/${portionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sealed }),
        });
        if (res.ok) {
          setPortionsCache((prev) => {
            const portions = prev[batchId] ?? [];
            return {
              ...prev,
              [batchId]: portions.map((p) => (p.id === portionId ? { ...p, sealed } : p)),
            };
          });
        }
      } catch {
        // silent
      }
    },
    [apiBase],
  );

  /* ── Actions ───────────────────────────────────────── */

  const handleAdvance = useCallback(
    async (batchId: string, newStatus: string, actualYieldG?: number) => {
      const body: Record<string, unknown> = { status: newStatus };
      if (typeof actualYieldG === "number") {
        body.actualYieldG = actualYieldG;
      }
      try {
        const res = await fetch(`${apiBase}/v1/batches/${batchId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          await fetchBatches();
        }
      } catch {
        // silent
      }
    },
    [apiBase, fetchBatches],
  );

  const handlePostCheckpoint = useCallback(
    async (
      batchId: string,
      checkpointType: string,
      opts?: { notes?: string; timerDurationM?: number },
    ) => {
      try {
        await fetch(`${apiBase}/v1/batches/${batchId}/checkpoints`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            checkpointType,
            notes: opts?.notes ?? null,
            timerDurationM: opts?.timerDurationM ?? null,
          }),
        });
      } catch {
        // silent
      }
    },
    [apiBase],
  );

  const handleFlagIssue = useCallback(
    (batchId: string, note: string) => {
      handlePostCheckpoint(batchId, "READY_CHECK", {
        notes: `\u26A0\uFE0F ${note}`,
      });
    },
    [handlePostCheckpoint],
  );

  const handlePrintSheet = useCallback(() => {
    if (!focusedBatchId) return;
    window.open(`${apiBase}/v1/print/batch-sheet/${focusedBatchId}`, "_blank");
  }, [apiBase, focusedBatchId]);

  const handleAdvanceFocused = useCallback(async () => {
    if (!focusedBatchId) return;
    const batch = batches.find((b) => b.id === focusedBatchId);
    if (!batch) return;
    const next = nextStatus(batch.status);
    if (!next) return;

    // Cannot auto-advance from PORTIONED without yield
    if (batch.status === "PORTIONED") return;

    const cpType = CHECKPOINT_MAP[next];
    if (cpType) {
      await handlePostCheckpoint(batch.id, cpType, {
        timerDurationM: next === "COOKING" && batch.cookTimeMin ? batch.cookTimeMin : undefined,
      });
    }
    await handleAdvance(batch.id, next);
  }, [focusedBatchId, batches, handleAdvance, handlePostCheckpoint]);

  /* ── Counts for sticky bar ─────────────────────────── */

  const activeCount = batches.filter((b) =>
    ["IN_PREP", "COOKING", "CHILLING"].includes(b.status),
  ).length;

  /* ── Render ────────────────────────────────────────── */

  if (loading) {
    return <div className="loading-shimmer" style={{ height: 200, borderRadius: 12 }} />;
  }

  // Prep draft — filter out trivial items (seasonings, condiments) by volume
  const suggestions = (prepDraft?.batchSuggestions ?? []).filter(
    (s) => s.cookedG >= PREP_MIN_COOKED_G,
  );
  const prepShortages = (prepDraft?.shortages ?? []).filter(
    (s) => s.shortageG >= PREP_MIN_COOKED_G,
  );
  const totalMeals = prepDraft?.totalMeals ?? 0;
  const totalComponents = suggestions.length;
  const shortageCount = prepShortages.length;
  const portionPlansMap = new Map(
    (prepDraft?.portionPlans ?? []).map((pp) => [pp.componentId, pp]),
  );

  return (
    <div style={{ paddingBottom: 100 }}>
      {/* ── Prep Queue Section ───────────────────── */}
      <div style={{ marginBottom: "var(--sp-8)" }}>
        <h2
          style={{
            fontSize: "var(--text-lg)",
            fontWeight: "var(--weight-bold)" as string,
            marginBottom: "var(--sp-4)",
            letterSpacing: "-0.01em",
          }}
        >
          Prep Queue
        </h2>

        {/* Week navigator */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            marginBottom: "var(--sp-4)",
          }}
        >
          <button
            className="btn btn-outline btn-sm"
            onClick={() => shiftWeek(-7)}
            disabled={weekStart <= todayISO()}
          >
            &larr; Prev Week
          </button>
          <div style={{ flex: 1, textAlign: "center", fontWeight: 600, fontSize: "var(--text-sm)" }}>
            {formatDateRange(weekStart, weekEnd)}
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => shiftWeek(7)}>
            Next Week &rarr;
          </button>
        </div>

        {prepLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            <div className="loading-shimmer" style={{ height: 60, borderRadius: "var(--r-md)" }} />
            <div className="loading-shimmer" style={{ height: 120, borderRadius: "var(--r-md)" }} />
          </div>
        ) : prepError ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--sp-3)",
              padding: "var(--sp-3) var(--sp-4)",
              background: "var(--c-danger-soft)",
              color: "var(--c-danger)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "var(--r-md)",
              fontSize: "var(--text-sm)",
            }}
          >
            <span>{prepError}</span>
            <button
              className="btn btn-sm"
              style={{ background: "var(--c-danger)", color: "#fff" }}
              onClick={fetchPrepDraft}
            >
              Retry
            </button>
          </div>
        ) : suggestions.length === 0 ? (
          <div className="state-box" style={{ textAlign: "center", padding: "var(--sp-6)" }}>
            <div className="state-title">No meals scheduled</div>
            <div className="state-desc">
              No meals are scheduled for this week. Use the meal planner to add meals first.
            </div>
          </div>
        ) : (
          <>
            {/* KPI row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "var(--sp-3)",
                marginBottom: "var(--sp-4)",
              }}
            >
              <div className="card" style={{ padding: "var(--sp-3)", textAlign: "center" }}>
                <div
                  style={{
                    fontSize: "var(--text-xl)",
                    fontWeight: "var(--weight-bold)" as string,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {totalMeals}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)" }}>meals</div>
              </div>
              <div className="card" style={{ padding: "var(--sp-3)", textAlign: "center" }}>
                <div
                  style={{
                    fontSize: "var(--text-xl)",
                    fontWeight: "var(--weight-bold)" as string,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {totalComponents}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)" }}>components</div>
              </div>
              <div className="card" style={{ padding: "var(--sp-3)", textAlign: "center" }}>
                <div
                  style={{
                    fontSize: "var(--text-xl)",
                    fontWeight: "var(--weight-bold)" as string,
                    fontVariantNumeric: "tabular-nums",
                    color: shortageCount > 0 ? "var(--c-danger)" : undefined,
                  }}
                >
                  {shortageCount}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)" }}>shortages</div>
              </div>
            </div>

            {/* Shortage warning banner */}
            {shortageCount > 0 && (
              <div
                style={{
                  padding: "var(--sp-3) var(--sp-4)",
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  borderRadius: "var(--r-md)",
                  marginBottom: "var(--sp-4)",
                  fontSize: "var(--text-sm)",
                  color: "var(--c-danger)",
                }}
              >
                <strong>Shortages:</strong>{" "}
                {prepShortages
                  .map((s) => `${s.componentName} (\u2212${formatG(s.shortageG)})`)
                  .join(", ")}
              </div>
            )}

            {/* Suggestion cards */}
            <div className="stack" style={{ gap: "var(--sp-4)" }}>
              {suggestions.map((s) => (
                <PrepQueueCard
                  key={s.componentId}
                  suggestion={s}
                  portionPlan={portionPlansMap.get(s.componentId)}
                  expanded={expandedSuggestions.has(s.componentId)}
                  onToggleExpand={() => toggleSuggestionExpand(s.componentId)}
                  onQueueUp={() => handleCreateFromSchedule(s.componentId)}
                  queued={queuedComponentIds.has(s.componentId)}
                  creating={creatingBatchFor === s.componentId}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Active Batches Section ───────────────────── */}
      <h2
        style={{
          fontSize: "var(--text-lg)",
          fontWeight: "var(--weight-bold)" as string,
          marginBottom: "var(--sp-4)",
          letterSpacing: "-0.01em",
        }}
      >
        Active Batches
      </h2>

      {/* Filter pills */}
      <div
        className="row"
        style={{
          gap: "var(--sp-2)",
          marginBottom: "var(--sp-6)",
          flexWrap: "wrap",
        }}
      >
        {FILTER_OPTIONS.map((f) => (
          <button
            key={f.key}
            className={`btn btn-sm ${filter === f.key ? "btn-primary" : "btn-outline"}`}
            onClick={() => {
              setFilter(f.key);
              setLoading(true);
            }}
          >
            {f.label}
            {f.key === "active" && activeCount > 0 && (
              <span
                style={{
                  background: "rgba(0,0,0,0.2)",
                  borderRadius: "var(--r-full)",
                  padding: "0 6px",
                  fontSize: "var(--text-xs)",
                  marginLeft: 4,
                }}
              >
                {activeCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Batch execution cards */}
      <div className="stack" style={{ gap: "var(--sp-4)" }}>
        {batches.map((batch) => (
          <BatchExecutionCard
            key={batch.id}
            batch={batch}
            onAdvance={handleAdvance}
            onPostCheckpoint={handlePostCheckpoint}
            onFlagIssue={handleFlagIssue}
            focused={focusedBatchId === batch.id}
            onFocus={() => setFocusedBatchId(batch.id)}
            portionsExpanded={expandedPortions.has(batch.id)}
            portionsList={portionsCache[batch.id] ?? []}
            portionsIsLoading={portionsLoading.has(batch.id)}
            onTogglePortions={() => togglePortions(batch.id)}
            onToggleSeal={(portionId, sealed) => handleToggleSeal(batch.id, portionId, sealed)}
          />
        ))}
      </div>

      {batches.length === 0 && (
        <div className="state-box" style={{ textAlign: "center", padding: "var(--sp-8)" }}>
          <div className="state-title">No batches found</div>
          <div className="state-desc">
            {filter === "due_now"
              ? "No batches are due for prep right now."
              : filter === "active"
                ? "No batches are currently being prepared."
                : filter === "completed"
                  ? "No batches completed today."
                  : "No batches in the system."}
          </div>
        </div>
      )}

      {/* Sticky action bar */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 90,
          background: "rgba(10,10,11,0.92)",
          backdropFilter: "blur(16px) saturate(1.6)",
          WebkitBackdropFilter: "blur(16px) saturate(1.6)",
          borderTop: "1px solid var(--c-border)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div
          style={{
            maxWidth: "var(--page-max)",
            margin: "0 auto",
            padding: "var(--sp-3) var(--sp-4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--sp-3)",
            flexWrap: "wrap",
          }}
        >
          {/* Left: Active count */}
          <div
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--c-ink-soft)",
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "var(--r-full)",
                background: activeCount > 0 ? "var(--c-accent)" : "var(--c-border)",
                display: "inline-block",
              }}
            />
            <span style={{ fontWeight: "var(--weight-medium)" as string }}>
              {activeCount} active
            </span>
            <span style={{ color: "var(--c-ink-muted)" }}>
              / {batches.length} total
            </span>
          </div>

          {/* Right: Action buttons */}
          <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={!focusedBatchId || (() => {
                const b = batches.find((b) => b.id === focusedBatchId);
                return !b || !nextStatus(b.status) || b.status === "PORTIONED";
              })()}
              onClick={handleAdvanceFocused}
              style={{ minHeight: 40 }}
            >
              Next Step
            </button>
            <button
              className="btn btn-outline btn-sm"
              disabled={!focusedBatchId}
              onClick={() => {
                if (focusedBatchId) {
                  const note = window.prompt("Describe the issue:");
                  if (note) handleFlagIssue(focusedBatchId, note);
                }
              }}
              style={{
                minHeight: 40,
                color: "var(--c-danger)",
                borderColor: "var(--c-danger)",
              }}
            >
              Flag Issue
            </button>
            <button
              className="btn btn-outline btn-sm"
              disabled={!focusedBatchId}
              onClick={handlePrintSheet}
              style={{ minHeight: 40 }}
            >
              Print Sheet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

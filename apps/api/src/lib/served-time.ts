const mealSlotUtcTime: Record<string, [hour: number, minute: number]> = {
  BREAKFAST: [12, 30],
  LUNCH: [17, 30],
  PRE_TRAINING: [19, 0],
  POST_TRAINING: [21, 0],
  DINNER: [23, 0],
  PRE_BED: [23, 30],
  SNACK: [15, 0]
};

const defaultUtcTime: [hour: number, minute: number] = [18, 0];

export function servedAtFromSchedule(serviceDate: Date, mealSlot: string): Date {
  const [hour, minute] = mealSlotUtcTime[mealSlot] ?? defaultUtcTime;
  return new Date(
    Date.UTC(
      serviceDate.getUTCFullYear(),
      serviceDate.getUTCMonth(),
      serviceDate.getUTCDate(),
      hour,
      minute,
      0,
      0
    )
  );
}

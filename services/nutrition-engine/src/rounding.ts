export function roundCalories(value: number): number {
  if (value < 5) return 0;
  if (value <= 50) return Math.round(value / 5) * 5;
  return Math.round(value / 10) * 10;
}

export function roundFatLike(value: number): number {
  if (value < 0.5) return 0;
  if (value < 5) return Math.round(value * 2) / 2;
  return Math.round(value);
}

export function roundGeneralG(value: number): number {
  if (value < 0.5) return 0;
  return Math.round(value);
}

export function roundSodiumMg(value: number): number {
  if (value < 5) return 0;
  if (value <= 140) return Math.round(value / 5) * 5;
  return Math.round(value / 10) * 10;
}

export function roundCholesterolMg(value: number): number {
  if (value < 2) return 0;
  return Math.round(value / 5) * 5;
}

export type LinePoint = { x: number; y: number; p?: number };

export type LineSpan = {
  start: LinePoint;
  end: LinePoint;
  length: number;
  unitX: number;
  unitY: number;
};

export type LineExtension = {
  joinedStart: LinePoint;
  joinedEnd: LinePoint;
  join: LinePoint;
  outer: LinePoint;
  side: "start" | "end";
  incomingNearAtStart: boolean;
  gap: number;
};

export type LineExtensionOptions = {
  maxGap: number;
  alignmentTolerance: number;
  minExtension: number;
  maxAngleDegrees?: number;
  minLength?: number;
};

/** Maximale Richtungsabweichung, bei der eine neue Linie als Verlängerung gilt. */
export const DEFAULT_JOIN_ANGLE_DEGREES = 2.5;

/** Winkel einer Linie in Grad, mathematisch (gegen den Uhrzeigersinn, y nach oben), 0–179. */
export const lineAngleDegrees = (a: LinePoint, b: LinePoint): number => {
  const deg = (-Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return Math.round(((deg % 180) + 180) % 180) % 180;
};

/** Rastet `free` um `fixed` auf ein Vielfaches von `stepDegrees` ein; die Länge bleibt erhalten. */
export const snapToAngle = (fixed: LinePoint, free: LinePoint, stepDegrees = 15): LinePoint => {
  const dx = free.x - fixed.x, dy = free.y - fixed.y, length = Math.hypot(dx, dy);
  if (length === 0) return { x: free.x, y: free.y };
  const step = (stepDegrees * Math.PI) / 180;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: fixed.x + Math.cos(angle) * length, y: fixed.y + Math.sin(angle) * length };
};

/** Rastet einen Drehwinkel (Bogenmaß) auf `stepDegrees` ein. */
export const snapRadians = (radians: number, stepDegrees = 15): number => {
  const step = (stepDegrees * Math.PI) / 180;
  return Math.round(radians / step) * step;
};

/** Return a straight span when the sampled path stays close to its endpoint chord. */
export const straightLineSpan = (points: LinePoint[], minLength = 12): LineSpan | null => {
  if (points.length < 2) return null;
  const start = points[0], end = points[points.length - 1];
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < minLength) return null;

  let pathLength = 0, maxDeviation = 0;
  for (let i = 1; i < points.length; i++) {
    pathLength += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  for (const point of points) {
    const deviation = Math.abs((point.x - start.x) * dy - (point.y - start.y) * dx) / length;
    maxDeviation = Math.max(maxDeviation, deviation);
  }
  if (length / pathLength < 0.94 || maxDeviation > Math.max(3, length * 0.025)) return null;

  return { start, end, length, unitX: dx / length, unitY: dy / length };
};

/**
 * Join a new near-straight segment to an existing line only when it continues
 * beyond one endpoint, points in the same direction, and stays near its axis.
 */
export const extendCollinearLine = (
  existingPoints: LinePoint[],
  incomingPoints: LinePoint[],
  options: LineExtensionOptions,
): LineExtension | null => {
  const minLength = options.minLength ?? 12;
  const existing = straightLineSpan(existingPoints, minLength);
  const incoming = straightLineSpan(incomingPoints, minLength);
  if (!existing || !incoming) return null;

  // Nur nahezu exakt fluchtende Linien verbinden. Früher reichten 12° Abweichung:
  // Eine neu gezeichnete Linie wurde dadurch unbemerkt auf den Winkel der alten gezwungen.
  const dot = existing.unitX * incoming.unitX + existing.unitY * incoming.unitY;
  const maxAngle = ((options.maxAngleDegrees ?? DEFAULT_JOIN_ANGLE_DEGREES) * Math.PI) / 180;
  if (Math.abs(dot) < Math.cos(maxAngle)) return null;

  const project = (point: LinePoint) => (point.x - existing.start.x) * existing.unitX + (point.y - existing.start.y) * existing.unitY;
  const distanceToAxis = (point: LinePoint) => Math.abs((point.x - existing.start.x) * existing.unitY - (point.y - existing.start.y) * existing.unitX);
  if (distanceToAxis(incoming.start) > options.alignmentTolerance || distanceToAxis(incoming.end) > options.alignmentTolerance) return null;

  const candidates: LineExtension[] = [];
  for (const side of ["start", "end"] as const) {
    const endpoint = side === "start" ? existing.start : existing.end;
    const endpointProjection = side === "start" ? 0 : existing.length;
    for (const incomingNearAtStart of [true, false]) {
      const near = incomingNearAtStart ? incoming.start : incoming.end;
      const outerPoint = incomingNearAtStart ? incoming.end : incoming.start;
      const gap = Math.hypot(near.x - endpoint.x, near.y - endpoint.y);
      if (gap > options.maxGap) continue;

      const outerProjection = project(outerPoint);
      const extendsPastEndpoint = side === "start"
        ? outerProjection < endpointProjection - options.minExtension
        : outerProjection > endpointProjection + options.minExtension;
      if (!extendsPastEndpoint) continue;

      const outer = {
        x: existing.start.x + existing.unitX * outerProjection,
        y: existing.start.y + existing.unitY * outerProjection,
      };
      const join = { x: endpoint.x, y: endpoint.y };
      candidates.push({
        joinedStart: side === "start" ? outer : existing.start,
        joinedEnd: side === "end" ? outer : existing.end,
        join,
        outer,
        side,
        incomingNearAtStart,
        gap,
      });
    }
  }
  return candidates.sort((a, b) => a.gap - b.gap)[0] ?? null;
};

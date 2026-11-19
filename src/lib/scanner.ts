export interface Point {
  x: number;
  y: number;
}

export interface CorrectedImage {
  blob: Blob;
  width: number;
  height: number;
}

export interface DocumentDetection {
  corners: Point[];
  confidence: number;
  method: 'contour' | 'hough';
}

interface HoughLine {
  theta: number;
  rho: number;
  votes: number;
}

interface ParallelPair {
  first: HoughLine;
  second: HoughLine;
  angle: number;
}

interface EdgeAnalysis {
  edges: Uint8Array;
  magnitude: Float32Array;
  angles: Uint8Array;
}

interface QuadCandidate {
  corners: Point[];
  confidence: number;
  method: 'contour' | 'hough';
}

const MAX_IMAGE_DIMENSION = 4200;
const DETECTION_MAX_DIMENSION = 960;
const MAX_SOURCE_DIMENSION = 5000;

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function signedPolygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function polygonArea(points: Point[]): number {
  return Math.abs(signedPolygonArea(points));
}

function orderCorners(points: Point[]): Point[] {
  const center = points.reduce(
    (result, point) => ({ x: result.x + point.x / points.length, y: result.y + point.y / points.length }),
    { x: 0, y: 0 },
  );
  const ordered = [...points].sort(
    (a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x),
  );
  if (signedPolygonArea(ordered) < 0) ordered.reverse();

  let start = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].x + ordered[i].y < ordered[start].x + ordered[start].y) start = i;
  }
  return [...ordered.slice(start), ...ordered.slice(0, start)];
}

function isConvex(points: Point[]): boolean {
  if (points.length < 4) return false;
  let sign = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = points[(i + 2) % points.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 0.00001) return false;
    const nextSign = Math.sign(cross);
    if (sign !== 0 && sign !== nextSign) return false;
    sign = nextSign;
  }
  return true;
}

function angleDifference(a: number, b: number): number {
  const difference = Math.abs(a - b) % 180;
  return Math.min(difference, 180 - difference);
}

function averageLineAngle(a: number, b: number): number {
  const first = (a * Math.PI) / 90;
  const second = (b * Math.PI) / 90;
  let angle = (Math.atan2(Math.sin(first) + Math.sin(second), Math.cos(first) + Math.cos(second)) * 90) / Math.PI;
  if (angle < 0) angle += 180;
  return angle;
}

function intersectLines(a: HoughLine, b: HoughLine): Point | null {
  const aCos = Math.cos((a.theta * Math.PI) / 180);
  const aSin = Math.sin((a.theta * Math.PI) / 180);
  const bCos = Math.cos((b.theta * Math.PI) / 180);
  const bSin = Math.sin((b.theta * Math.PI) / 180);
  const determinant = aCos * bSin - aSin * bCos;
  if (Math.abs(determinant) < 0.08) return null;

  return {
    x: (a.rho * bSin - aSin * b.rho) / determinant,
    y: (aCos * b.rho - a.rho * bCos) / determinant,
  };
}

function gaussianBlurGray(gray: Uint8Array, width: number, height: number): Float32Array {
  const kernel = [1, 4, 6, 4, 1];
  const horizontal = new Float32Array(width * height);
  const output = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      for (let offset = -2; offset <= 2; offset += 1) {
        const sampleX = clamp(x + offset, 0, width - 1);
        total += gray[y * width + sampleX] * kernel[offset + 2];
      }
      horizontal[y * width + x] = total / 16;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      for (let offset = -2; offset <= 2; offset += 1) {
        const sampleY = clamp(y + offset, 0, height - 1);
        total += horizontal[sampleY * width + x] * kernel[offset + 2];
      }
      output[y * width + x] = total / 16;
    }
  }
  return output;
}

/** A compact Canny-style edge detector: Gaussian smoothing, Sobel gradients,
 * non-maximum suppression, adaptive double thresholds, and hysteresis. */
function buildCannyEdges(image: ImageData): EdgeAnalysis {
  const { width, height, data } = image;
  const total = width * height;
  const gray = new Uint8Array(total);
  for (let pixel = 0, offset = 0; pixel < total; pixel += 1, offset += 4) {
    gray[pixel] = Math.round(data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114);
  }

  const blurred = gaussianBlurGray(gray, width, height);
  const magnitude = new Float32Array(total);
  const angles = new Uint8Array(total);
  const suppressed = new Float32Array(total);
  const histogram = new Uint32Array(1025);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const gx = -blurred[index - width - 1] + blurred[index - width + 1]
        - 2 * blurred[index - 1] + 2 * blurred[index + 1]
        - blurred[index + width - 1] + blurred[index + width + 1];
      const gy = -blurred[index - width - 1] - 2 * blurred[index - width] - blurred[index - width + 1]
        + blurred[index + width - 1] + 2 * blurred[index + width] + blurred[index + width + 1];
      magnitude[index] = Math.min(1024, Math.hypot(gx, gy));
      let angle = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (angle < 0) angle += 180;
      angles[index] = Math.round(angle) % 180;
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const angle = angles[index];
      let first: number;
      let second: number;
      if (angle < 22 || angle >= 158) {
        first = magnitude[index - 1];
        second = magnitude[index + 1];
      } else if (angle < 68) {
        first = magnitude[index - width + 1];
        second = magnitude[index + width - 1];
      } else if (angle < 113) {
        first = magnitude[index - width];
        second = magnitude[index + width];
      } else {
        first = magnitude[index - width - 1];
        second = magnitude[index + width + 1];
      }
      const strength = magnitude[index];
      if (strength >= first && strength >= second && strength > 0) {
        suppressed[index] = strength;
        histogram[Math.round(strength)] += 1;
      }
    }
  }

  let edgeCount = 0;
  for (const count of histogram) edgeCount += count;
  if (edgeCount < Math.max(80, total * 0.0007)) {
    return { edges: new Uint8Array(total), magnitude, angles };
  }

  const percentileTarget = Math.floor(edgeCount * 0.86);
  let cumulative = 0;
  let percentile = 0;
  for (let value = 1; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= percentileTarget) {
      percentile = value;
      break;
    }
  }
  const highThreshold = clamp(percentile * 0.34, 24, 105);
  const lowThreshold = highThreshold * 0.42;
  const states = new Uint8Array(total);
  const stack = new Int32Array(total);
  let stackLength = 0;

  for (let index = 0; index < total; index += 1) {
    if (suppressed[index] >= highThreshold) {
      states[index] = 2;
      stack[stackLength] = index;
      stackLength += 1;
    } else if (suppressed[index] >= lowThreshold) {
      states[index] = 1;
    }
  }

  while (stackLength > 0) {
    stackLength -= 1;
    const index = stack[stackLength];
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      const nextY = y + dy;
      if (nextY < 1 || nextY >= height - 1) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nextX = x + dx;
        if (nextX < 1 || nextX >= width - 1) continue;
        const nextIndex = nextY * width + nextX;
        if (states[nextIndex] === 1) {
          states[nextIndex] = 2;
          stack[stackLength] = nextIndex;
          stackLength += 1;
        }
      }
    }
  }

  const edges = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) edges[i] = states[i] === 2 ? 1 : 0;

  // A 3x3 morphological close bridges small breaks in paper edges.
  const dilated = new Uint8Array(total);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (edges[index] || edges[index - 1] || edges[index + 1]
        || edges[index - width] || edges[index + width]
        || edges[index - width - 1] || edges[index - width + 1]
        || edges[index + width - 1] || edges[index + width + 1]) dilated[index] = 1;
    }
  }
  const closed = new Uint8Array(total);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (dilated[index] && dilated[index - 1] && dilated[index + 1]
        && dilated[index - width] && dilated[index + width]
        && dilated[index - width - 1] && dilated[index - width + 1]
        && dilated[index + width - 1] && dilated[index + width + 1]) closed[index] = 1;
    }
  }

  return { edges: closed, magnitude, angles };
}

function pointLineDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-8) return distance(point, start);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function simplifyOpenPolygon(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop() as [number, number];
    let maxDistance = epsilon;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i += 1) {
      const candidate = pointLineDistance(points[i], points[start], points[end]);
      if (candidate > maxDistance) {
        maxDistance = candidate;
        maxIndex = i;
      }
    }
    if (maxIndex >= 0) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

function approximateClosedPolygon(hull: Point[]): Point[] | null {
  if (hull.length < 4) return null;
  const perimeter = hull.reduce((sum, point, index) => sum + distance(point, hull[(index + 1) % hull.length]), 0);
  let epsilon = Math.max(1.2, perimeter * 0.006);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const farthestIndex = hull.reduce(
      (best, point, index) => distance(point, hull[0]) > distance(hull[best], hull[0]) ? index : best,
      1,
    );
    const firstPath = hull.slice(0, farthestIndex + 1);
    const secondPath = [...hull.slice(farthestIndex), hull[0]];
    const simplifiedFirst = simplifyOpenPolygon(firstPath, epsilon);
    const simplifiedSecond = simplifyOpenPolygon(secondPath, epsilon);
    const combined = [...simplifiedFirst.slice(0, -1), ...simplifiedSecond.slice(0, -1)];
    if (combined.length === 4) return orderCorners(combined);
    if (combined.length < 4) return null;
    epsilon *= 1.55;
  }
  return null;
}

function convexHull(points: Point[]): Point[] {
  if (points.length < 4) return points;
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const unique: Point[] = [];
  for (const point of sorted) {
    const last = unique[unique.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y) unique.push(point);
  }
  if (unique.length < 4) return unique;

  const cross = (origin: Point, a: Point, b: Point) =>
    (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const lower: Point[] = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const point = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function findEdgeComponents(edges: Uint8Array, width: number, height: number): Point[][] {
  const total = width * height;
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  const components: Array<{ size: number; points: Point[] }> = [];
  const minimumSize = Math.max(90, Math.round(Math.min(width, height) * 0.28));

  for (let index = width + 1; index < total - width - 1; index += 1) {
    if (!edges[index] || visited[index]) continue;
    let stackLength = 1;
    stack[0] = index;
    visited[index] = 1;
    const points: Point[] = [];

    while (stackLength > 0) {
      stackLength -= 1;
      const current = stack[stackLength];
      const x = current % width;
      const y = Math.floor(current / width);
      if (points.length < 6500) points.push({ x, y });
      for (let dy = -1; dy <= 1; dy += 1) {
        const nextY = y + dy;
        if (nextY <= 0 || nextY >= height - 1) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          if (nextX <= 0 || nextX >= width - 1) continue;
          const nextIndex = nextY * width + nextX;
          if (edges[nextIndex] && !visited[nextIndex]) {
            visited[nextIndex] = 1;
            stack[stackLength] = nextIndex;
            stackLength += 1;
          }
        }
      }
    }

    if (points.length >= minimumSize) {
      components.push({ size: points.length, points });
      components.sort((a, b) => b.size - a.size);
      if (components.length > 18) components.pop();
    }
  }
  return components.map((component) => component.points);
}

function measureQuad(corners: Point[], edges: Uint8Array, width: number, height: number): number {
  if (corners.length !== 4 || !isConvex(corners)) return 0;
  const areaFraction = polygonArea(corners) / (width * height);
  if (areaFraction < 0.065 || areaFraction > 0.995) return 0;

  const sideLengths = corners.map((point, index) => distance(point, corners[(index + 1) % 4]));
  const minimumSide = Math.min(...sideLengths);
  if (minimumSide < Math.min(width, height) * 0.105) return 0;
  const averageWidth = (sideLengths[0] + sideLengths[2]) / 2;
  const averageHeight = (sideLengths[1] + sideLengths[3]) / 2;
  const aspectRatio = Math.max(averageWidth, averageHeight) / Math.max(1, Math.min(averageWidth, averageHeight));
  if (aspectRatio > 7.5) return 0;

  let supported = 0;
  let sampled = 0;
  for (let side = 0; side < 4; side += 1) {
    const start = corners[side];
    const end = corners[(side + 1) % 4];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const normalX = -dy / Math.max(1, length);
    const normalY = dx / Math.max(1, length);
    const samples = Math.max(18, Math.min(96, Math.round(length / 8)));
    for (let sample = 0; sample < samples; sample += 1) {
      const t = (sample + 0.5) / samples;
      const x = Math.round(start.x + dx * t);
      const y = Math.round(start.y + dy * t);
      let found = false;
      for (let offset = -4; offset <= 4 && !found; offset += 1) {
        const sx = Math.round(x + normalX * offset);
        const sy = Math.round(y + normalY * offset);
        if (sx >= 0 && sx < width && sy >= 0 && sy < height && edges[sy * width + sx]) found = true;
      }
      if (found) supported += 1;
      sampled += 1;
    }
  }
  const edgeCoverage = supported / Math.max(1, sampled);
  if (edgeCoverage < 0.28) return 0;

  let angleDeviation = 0;
  for (let i = 0; i < 4; i += 1) {
    const previous = corners[(i + 3) % 4];
    const current = corners[i];
    const next = corners[(i + 1) % 4];
    const ax = previous.x - current.x;
    const ay = previous.y - current.y;
    const bx = next.x - current.x;
    const by = next.y - current.y;
    const cosine = clamp((ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by)), -1, 1);
    const angle = (Math.acos(cosine) * 180) / Math.PI;
    angleDeviation += Math.abs(90 - angle);
  }
  const orthogonality = 1 - clamp((angleDeviation / 4) / 62, 0, 1);
  const areaScore = clamp((areaFraction - 0.065) / 0.55, 0, 1);
  const aspectScore = 1 - clamp(Math.abs(aspectRatio - 1.45) / 2.25, 0, 0.72);
  const centerX = corners.reduce((sum, point) => sum + point.x / 4, 0);
  const centerY = corners.reduce((sum, point) => sum + point.y / 4, 0);
  const borderDistance = Math.min(centerX, width - centerX, centerY, height - centerY);
  const centerScore = 0.78 + 0.22 * clamp(borderDistance / (Math.min(width, height) * 0.22), 0, 1);

  return clamp((edgeCoverage * 0.57 + areaScore * 0.15 + orthogonality * 0.13 + aspectScore * 0.09 + centerScore * 0.06), 0, 0.99);
}

function detectContourCandidates(analysis: EdgeAnalysis, width: number, height: number): QuadCandidate[] {
  const components = findEdgeComponents(analysis.edges, width, height);
  const candidates: QuadCandidate[] = [];
  for (const component of components) {
    // Sampling keeps hull construction bounded on high-texture photographs.
    const stride = Math.max(1, Math.ceil(component.length / 4200));
    const sampled = component.filter((_, index) => index % stride === 0);
    const hull = convexHull(sampled);
    const approximation = approximateClosedPolygon(hull);
    if (!approximation || approximation.length !== 4) continue;
    const corners = orderCorners(approximation);
    const confidence = measureQuad(corners, analysis.edges, width, height);
    if (confidence >= 0.42) candidates.push({ corners, confidence, method: 'contour' });
  }
  return candidates;
}

function detectHoughCandidate(analysis: EdgeAnalysis, width: number, height: number): QuadCandidate | null {
  const { edges, magnitude, angles } = analysis;
  const diagonal = Math.ceil(Math.hypot(width, height));
  const rhoOffset = diagonal;
  const rhoCount = diagonal * 2 + 1;
  const thetaCount = 180;
  const votes = new Uint32Array(thetaCount * rhoCount);
  const cosines = new Float32Array(thetaCount);
  const sines = new Float32Array(thetaCount);
  for (let theta = 0; theta < thetaCount; theta += 1) {
    const radians = (theta * Math.PI) / 180;
    cosines[theta] = Math.cos(radians);
    sines[theta] = Math.sin(radians);
  }

  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      const index = y * width + x;
      if (!edges[index] || magnitude[index] < 12) continue;
      const baseTheta = angles[index];
      for (let delta = -9; delta <= 9; delta += 1) {
        const theta = (baseTheta + delta + thetaCount) % thetaCount;
        const rho = Math.round(x * cosines[theta] + y * sines[theta]) + rhoOffset;
        if (rho >= 0 && rho < rhoCount) votes[theta * rhoCount + rho] += 1;
      }
    }
  }

  const minimumVotes = Math.max(15, Math.round(Math.min(width, height) * 0.115));
  const peaks: HoughLine[] = [];
  for (let theta = 0; theta < thetaCount; theta += 1) {
    const rowOffset = theta * rhoCount;
    for (let rho = 0; rho < rhoCount; rho += 1) {
      const count = votes[rowOffset + rho];
      if (count >= minimumVotes) peaks.push({ theta, rho: rho - rhoOffset, votes: count });
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);

  const lines: HoughLine[] = [];
  for (const candidate of peaks) {
    const duplicate = lines.some((line) => angleDifference(line.theta, candidate.theta) < 4
      && Math.abs(line.rho - candidate.rho) < Math.max(8, Math.min(width, height) * 0.025));
    if (!duplicate) lines.push(candidate);
    if (lines.length >= 38) break;
  }
  if (lines.length < 4) return null;

  const pairs: ParallelPair[] = [];
  const minimumSeparation = Math.min(width, height) * 0.17;
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const first = lines[i];
      const second = lines[j];
      if (angleDifference(first.theta, second.theta) > 15) continue;
      const angle = averageLineAngle(first.theta, second.theta);
      const firstRho = Math.cos(((first.theta - angle) * Math.PI) / 180) < 0 ? -first.rho : first.rho;
      const secondRho = Math.cos(((second.theta - angle) * Math.PI) / 180) < 0 ? -second.rho : second.rho;
      if (Math.abs(firstRho - secondRho) < minimumSeparation) continue;
      pairs.push({ first, second, angle });
    }
  }

  let best: QuadCandidate | null = null;
  for (let i = 0; i < pairs.length; i += 1) {
    for (let j = i + 1; j < pairs.length; j += 1) {
      const firstPair = pairs[i];
      const secondPair = pairs[j];
      const familyAngle = angleDifference(firstPair.angle, secondPair.angle);
      if (familyAngle < 61 || familyAngle > 119) continue;
      const rawCorners = [
        intersectLines(firstPair.first, secondPair.first),
        intersectLines(firstPair.first, secondPair.second),
        intersectLines(firstPair.second, secondPair.second),
        intersectLines(firstPair.second, secondPair.first),
      ];
      if (rawCorners.some((point) => point === null)) continue;
      const corners = orderCorners(rawCorners as Point[]);
      const marginX = width * 0.045;
      const marginY = height * 0.045;
      if (corners.some((point) => point.x < -marginX || point.x > width - 1 + marginX
        || point.y < -marginY || point.y > height - 1 + marginY)) continue;
      const bounded = corners.map((point) => ({ x: clamp(point.x, 0, width - 1), y: clamp(point.y, 0, height - 1) }));
      const confidence = measureQuad(bounded, edges, width, height);
      if (confidence > (best?.confidence ?? 0)) best = { corners: bounded, confidence, method: 'hough' };
    }
  }
  return best;
}

/** Detects a document with Canny-style edges, morphological closing, connected
 * contour components, polygon approximation, and a gradient-directed Hough fallback. */
export function detectDocumentQuadrilateral(image: ImageData): DocumentDetection | null {
  const { width, height } = image;
  if (width < 80 || height < 80) return null;
  const analysis = buildCannyEdges(image);
  const contourCandidates = detectContourCandidates(analysis, width, height);
  const houghCandidate = detectHoughCandidate(analysis, width, height);
  const candidates = [...contourCandidates, ...(houghCandidate ? [houghCandidate] : [])];
  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];
  if (!best || best.confidence < 0.48) return null;
  return {
    corners: best.corners.map((point) => ({
      x: point.x / Math.max(1, width - 1),
      y: point.y / Math.max(1, height - 1),
    })),
    confidence: best.confidence,
    method: best.method,
  };
}

/** Backwards-compatible corner-only detection API. */
export function detectQuadrilateral(image: ImageData): Point[] | null {
  return detectDocumentQuadrilateral(image)?.corners ?? null;
}

export async function detectDocument(source: Blob): Promise<DocumentDetection | null> {
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, DETECTION_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    return detectDocumentQuadrilateral(context.getImageData(0, 0, width, height));
  } finally {
    bitmap.close();
  }
}

export async function detectDocumentCorners(source: Blob): Promise<Point[] | null> {
  return (await detectDocument(source))?.corners ?? null;
}

export function validateCorners(corners: Point[]): string | null {
  if (corners.length !== 4) return 'Select all four document corners.';
  if (corners.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) {
    return 'Keep all four corners inside the image.';
  }
  if (!isConvex(corners)) return 'The corners must form a convex shape. Move the handles so the edges do not cross.';
  if (polygonArea(corners) < 0.025) return 'The selected area is too small. Enlarge the selection.';
  const edgeLengths = corners.map((point, index) => distance(point, corners[(index + 1) % 4]));
  if (edgeLengths.some((length) => length < 0.035)) return 'The selected edges are too short. Adjust the corners.';
  return null;
}

function solveLinearSystem(matrix: number[][], values: number[]): number[] {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) {
      throw new Error('The selected corners cannot be transformed. Adjust the corner positions.');
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let item = column; item <= size; item += 1) augmented[column][item] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let item = column; item <= size; item += 1) augmented[row][item] -= factor * augmented[column][item];
    }
  }
  return augmented.map((row) => row[size]);
}

function createInverseHomography(sourceCorners: Point[], outputWidth: number, outputHeight: number): number[] {
  const destinationCorners = [
    { x: 0, y: 0 },
    { x: outputWidth - 1, y: 0 },
    { x: outputWidth - 1, y: outputHeight - 1 },
    { x: 0, y: outputHeight - 1 },
  ];
  const matrix: number[][] = [];
  const values: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const destination = destinationCorners[i];
    const source = sourceCorners[i];
    matrix.push([destination.x, destination.y, 1, 0, 0, 0,
      -source.x * destination.x, -source.x * destination.y]);
    values.push(source.x);
    matrix.push([0, 0, 0, destination.x, destination.y, 1,
      -source.y * destination.x, -source.y * destination.y]);
    values.push(source.y);
  }
  return solveLinearSystem(matrix, values);
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Could not create the corrected image. Please try again.')),
      'image/jpeg',
      quality,
    );
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Could not create the corrected image. Please try again.')),
      'image/png',
    );
  });
}

/** Applies a true inverse homography and bilinear sampling to flatten a document. */
export async function rectifyPerspective(
  source: Blob,
  normalizedCorners: Point[],
  maxDimension = MAX_IMAGE_DIMENSION,
): Promise<CorrectedImage> {
  const validationError = validateCorners(normalizedCorners);
  if (validationError) throw new Error(validationError);
  const bitmap = await createImageBitmap(source);
  try {
    const sourceLimit = maxDimension <= 1800 ? Math.max(1800, Math.round(maxDimension * 1.6)) : MAX_SOURCE_DIMENSION;
    const sourceScale = Math.min(1, sourceLimit / Math.max(bitmap.width, bitmap.height));
    const sourceWidth = Math.max(1, Math.round(bitmap.width * sourceScale));
    const sourceHeight = Math.max(1, Math.round(bitmap.height * sourceScale));
    const sourceCorners = normalizedCorners.map((point) => ({
      x: point.x * (sourceWidth - 1),
      y: point.y * (sourceHeight - 1),
    }));
    const topWidth = distance(sourceCorners[0], sourceCorners[1]);
    const bottomWidth = distance(sourceCorners[3], sourceCorners[2]);
    const leftHeight = distance(sourceCorners[0], sourceCorners[3]);
    const rightHeight = distance(sourceCorners[1], sourceCorners[2]);
    const rawWidth = (topWidth + bottomWidth) / 2;
    const rawHeight = (leftHeight + rightHeight) / 2;
    const scale = Math.min(1, maxDimension / Math.max(rawWidth, rawHeight));
    const outputWidth = Math.max(2, Math.round(rawWidth * scale));
    const outputHeight = Math.max(2, Math.round(rawHeight * scale));

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = sourceWidth;
    sourceCanvas.height = sourceHeight;
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceContext) throw new Error('Your browser could not process this image.');
    sourceContext.imageSmoothingEnabled = true;
    sourceContext.imageSmoothingQuality = 'high';
    sourceContext.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight);
    let sourcePixels: ImageData | null = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight);

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;
    const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true });
    if (!outputContext) throw new Error('Your browser could not create the corrected image.');
    let outputPixels: ImageData | null = outputContext.createImageData(outputWidth, outputHeight);
    const homography = createInverseHomography(sourceCorners, outputWidth, outputHeight);
    const [h0, h1, h2, h3, h4, h5, h6, h7] = homography;
    let sourceData = sourcePixels.data;
    let outputData = outputPixels.data;

    for (let y = 0; y < outputHeight; y += 1) {
      if (y > 0 && y % 64 === 0) await yieldToBrowser();
      for (let x = 0; x < outputWidth; x += 1) {
        const denominator = h6 * x + h7 * y + 1;
        const sourceX = (h0 * x + h1 * y + h2) / denominator;
        const sourceY = (h3 * x + h4 * y + h5) / denominator;
        const outputIndex = (y * outputWidth + x) * 4;
        if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)
          || sourceX < 0 || sourceY < 0 || sourceX > sourceWidth - 1 || sourceY > sourceHeight - 1) {
          outputData[outputIndex] = 255;
          outputData[outputIndex + 1] = 255;
          outputData[outputIndex + 2] = 255;
          outputData[outputIndex + 3] = 255;
          continue;
        }
        const x0 = Math.floor(sourceX);
        const y0 = Math.floor(sourceY);
        const x1 = Math.min(sourceWidth - 1, x0 + 1);
        const y1 = Math.min(sourceHeight - 1, y0 + 1);
        const xWeight = sourceX - x0;
        const yWeight = sourceY - y0;
        const topLeft = (y0 * sourceWidth + x0) * 4;
        const topRight = (y0 * sourceWidth + x1) * 4;
        const bottomLeft = (y1 * sourceWidth + x0) * 4;
        const bottomRight = (y1 * sourceWidth + x1) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          const top = sourceData[topLeft + channel] * (1 - xWeight) + sourceData[topRight + channel] * xWeight;
          const bottom = sourceData[bottomLeft + channel] * (1 - xWeight) + sourceData[bottomRight + channel] * xWeight;
          outputData[outputIndex + channel] = Math.round(top * (1 - yWeight) + bottom * yWeight);
        }
        outputData[outputIndex + 3] = 255;
      }
    }
    outputContext.putImageData(outputPixels, 0, 0);
    sourceData = new Uint8ClampedArray(0);
    outputData = new Uint8ClampedArray(0);
    sourcePixels = null;
    outputPixels = null;
    sourceCanvas.width = 0;
    sourceCanvas.height = 0;
    bitmap.close();
    return { blob: await canvasToPng(outputCanvas), width: outputWidth, height: outputHeight };
  } finally {
    bitmap.close();
  }
}

export async function rotateImage(blob: Blob, rotation: number): Promise<CorrectedImage> {
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const bitmap = await createImageBitmap(blob);
  try {
    if (normalizedRotation === 0) return { blob, width: bitmap.width, height: bitmap.height };
    const swapsDimensions = normalizedRotation === 90 || normalizedRotation === 270;
    const width = swapsDimensions ? bitmap.height : bitmap.width;
    const height = swapsDimensions ? bitmap.width : bitmap.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not rotate this image.');
    context.translate(width / 2, height / 2);
    context.rotate((normalizedRotation * Math.PI) / 180);
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    const rotatedBlob = await canvasToJpeg(canvas, 0.96);
    return { blob: rotatedBlob, width, height };
  } finally {
    bitmap.close();
  }
}

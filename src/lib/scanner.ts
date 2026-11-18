export interface Point {
  x: number;
  y: number;
}

export interface CorrectedImage {
  blob: Blob;
  width: number;
  height: number;
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

const MAX_IMAGE_DIMENSION = 2000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
}

function orderCorners(points: Point[]): Point[] {
  const center = points.reduce(
    (result, point) => ({ x: result.x + point.x / points.length, y: result.y + point.y / points.length }),
    { x: 0, y: 0 },
  );
  const ordered = [...points].sort(
    (a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x),
  );

  // Start at the corner closest to the visual top-left. The cyclic order is preserved.
  let start = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].x + ordered[i].y < ordered[start].x + ordered[start].y) start = i;
  }
  return [...ordered.slice(start), ...ordered.slice(0, start)];
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

function isConvex(points: Point[]): boolean {
  const span = Math.max(
    Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)),
    Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)),
  );
  const epsilon = span <= 2 ? 1e-6 : 1;
  let sign = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = points[(i + 2) % points.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < epsilon) return false;
    const nextSign = Math.sign(cross);
    if (sign !== 0 && sign !== nextSign) return false;
    sign = nextSign;
  }
  return true;
}

/**
 * Detects a document-like quadrilateral from a downscaled image using Sobel
 * gradients and a gradient-directed Hough transform. Returns normalized
 * corners in cyclic order, or null when no confident quadrilateral is found.
 */
export function detectQuadrilateral(image: ImageData): Point[] | null {
  const { width, height, data } = image;
  if (width < 80 || height < 80) return null;

  const gray = new Uint8Array(width * height);
  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
    gray[pixel] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
  }

  const magnitude = new Uint16Array(width * height);
  const gradientAngle = new Uint8Array(width * height);
  const histogram = new Uint32Array(1441);
  let gradientCount = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const topLeft = gray[(y - 1) * width + x - 1];
      const top = gray[(y - 1) * width + x];
      const topRight = gray[(y - 1) * width + x + 1];
      const left = gray[y * width + x - 1];
      const right = gray[y * width + x + 1];
      const bottomLeft = gray[(y + 1) * width + x - 1];
      const bottom = gray[(y + 1) * width + x];
      const bottomRight = gray[(y + 1) * width + x + 1];

      const gx = -topLeft + topRight - 2 * left + 2 * right - bottomLeft + bottomRight;
      const gy = -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
      const strength = Math.min(1440, Math.round(Math.hypot(gx, gy)));
      const index = y * width + x;
      magnitude[index] = strength;
      if (strength > 0) {
        histogram[strength] += 1;
        gradientCount += 1;
      }

      let angle = Math.round((Math.atan2(gy, gx) * 180) / Math.PI);
      if (angle < 0) angle += 180;
      gradientAngle[index] = angle % 180;
    }
  }

  if (gradientCount < Math.max(200, width * height * 0.002)) return null;

  const targetCount = Math.floor(gradientCount * 0.88);
  let cumulative = 0;
  let percentile = 0;
  for (let i = 1; i < histogram.length; i += 1) {
    cumulative += histogram[i];
    if (cumulative >= targetCount) {
      percentile = i;
      break;
    }
  }
  const edgeThreshold = clamp(Math.round(percentile * 0.08), 18, 65);

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
      if (magnitude[index] < edgeThreshold) continue;
      const baseTheta = gradientAngle[index];
      for (let delta = -12; delta <= 12; delta += 1) {
        const theta = (baseTheta + delta + thetaCount) % thetaCount;
        const rho = Math.round(x * cosines[theta] + y * sines[theta]) + rhoOffset;
        if (rho >= 0 && rho < rhoCount) votes[theta * rhoCount + rho] += 1;
      }
    }
  }

  const minimumVotes = Math.max(16, Math.round(Math.min(width, height) * 0.14));
  const rawPeaks: HoughLine[] = [];
  for (let theta = 0; theta < thetaCount; theta += 1) {
    const rowOffset = theta * rhoCount;
    for (let rho = 0; rho < rhoCount; rho += 1) {
      const count = votes[rowOffset + rho];
      if (count >= minimumVotes) rawPeaks.push({ theta, rho: rho - rhoOffset, votes: count });
    }
  }
  rawPeaks.sort((a, b) => b.votes - a.votes);

  const lines: HoughLine[] = [];
  for (const candidate of rawPeaks) {
    const duplicate = lines.some(
      (line) => angleDifference(line.theta, candidate.theta) < 4 &&
        Math.abs(line.rho - candidate.rho) < Math.max(10, Math.min(width, height) * 0.035),
    );
    if (!duplicate) lines.push(candidate);
    if (lines.length >= 42) break;
  }
  if (lines.length < 4) return null;

  const pairs: ParallelPair[] = [];
  const minimumSeparation = Math.min(width, height) * 0.18;
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const first = lines[i];
      const second = lines[j];
      if (angleDifference(first.theta, second.theta) > 19) continue;
      const angle = averageLineAngle(first.theta, second.theta);
      const firstRho = Math.cos(((first.theta - angle) * Math.PI) / 180) < 0 ? -first.rho : first.rho;
      const secondRho = Math.cos(((second.theta - angle) * Math.PI) / 180) < 0 ? -second.rho : second.rho;
      if (Math.abs(firstRho - secondRho) < minimumSeparation) continue;
      pairs.push({ first, second, angle });
    }
  }

  let best: { points: Point[]; score: number } | null = null;
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
      const marginX = width * 0.06;
      const marginY = height * 0.06;
      if (corners.some((point) =>
        point.x < -marginX || point.x > width - 1 + marginX ||
        point.y < -marginY || point.y > height - 1 + marginY
      )) continue;

      const bounded = corners.map((point) => ({
        x: clamp(point.x, 0, width - 1),
        y: clamp(point.y, 0, height - 1),
      }));
      if (!isConvex(bounded)) continue;

      const areaFraction = polygonArea(bounded) / (width * height);
      if (areaFraction < 0.09 || areaFraction > 0.995) continue;

      const edgeLengths = bounded.map((point, index) => distance(point, bounded[(index + 1) % 4]));
      if (edgeLengths.some((length) => length < Math.min(width, height) * 0.12)) continue;

      const voteStrength = firstPair.first.votes + firstPair.second.votes +
        secondPair.first.votes + secondPair.second.votes;
      const center = bounded.reduce(
        (result, point) => ({ x: result.x + point.x / 4, y: result.y + point.y / 4 }),
        { x: 0, y: 0 },
      );
      const borderDistance = Math.min(center.x, width - center.x, center.y, height - center.y);
      const interiorBonus = 0.85 + 0.15 * clamp(borderDistance / (Math.min(width, height) * 0.2), 0, 1);
      const score = voteStrength * Math.sqrt(areaFraction) * interiorBonus;

      if (!best || score > best.score) best = { points: bounded, score };
    }
  }

  if (!best) return null;
  return best.points.map((point) => ({
    x: point.x / Math.max(1, width - 1),
    y: point.y / Math.max(1, height - 1),
  }));
}

export async function detectDocumentCorners(source: Blob): Promise<Point[] | null> {
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    return detectQuadrilateral(context.getImageData(0, 0, width, height));
  } finally {
    bitmap.close();
  }
}

export function validateCorners(corners: Point[]): string | null {
  if (corners.length !== 4) return 'Select all four document corners.';
  if (corners.some((point) =>
    !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
    point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1
  )) return 'Keep all four corners inside the image.';

  const ordered = corners.map((point) => ({ x: point.x, y: point.y }));
  if (!isConvex(ordered)) return 'The corners must form a convex shape. Move the handles so the edges do not cross.';
  const area = polygonArea(ordered);
  if (area < 0.025) return 'The selected area is too small. Enlarge the selection.';
  const edgeLengths = ordered.map((point, index) => distance(point, ordered[(index + 1) % 4]));
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
      for (let item = column; item <= size; item += 1) {
        augmented[row][item] -= factor * augmented[column][item];
      }
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
    matrix.push([
      destination.x, destination.y, 1, 0, 0, 0,
      -source.x * destination.x, -source.x * destination.y,
    ]);
    values.push(source.x);
    matrix.push([
      0, 0, 0, destination.x, destination.y, 1,
      -source.y * destination.x, -source.y * destination.y,
    ]);
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

/** Applies a true inverse homography and bilinear sampling to flatten a document. */
export async function rectifyPerspective(source: Blob, normalizedCorners: Point[]): Promise<CorrectedImage> {
  const validationError = validateCorners(normalizedCorners);
  if (validationError) throw new Error(validationError);

  const bitmap = await createImageBitmap(source);
  try {
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    const sourceCorners = normalizedCorners.map((point) => ({
      x: point.x * (sourceWidth - 1),
      y: point.y * (sourceHeight - 1),
    }));

    const topWidth = distance(sourceCorners[0], sourceCorners[1]);
    const bottomWidth = distance(sourceCorners[3], sourceCorners[2]);
    const leftHeight = distance(sourceCorners[0], sourceCorners[3]);
    const rightHeight = distance(sourceCorners[1], sourceCorners[2]);
    const scale = Math.min(
      1,
      MAX_IMAGE_DIMENSION / Math.max((topWidth + bottomWidth) / 2, (leftHeight + rightHeight) / 2),
    );
    const outputWidth = Math.max(2, Math.round(((topWidth + bottomWidth) / 2) * scale));
    const outputHeight = Math.max(2, Math.round(((leftHeight + rightHeight) / 2) * scale));

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = sourceWidth;
    sourceCanvas.height = sourceHeight;
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceContext) throw new Error('Your browser could not process this image.');
    sourceContext.drawImage(bitmap, 0, 0);
    const sourcePixels = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight);

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;
    const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true });
    if (!outputContext) throw new Error('Your browser could not create the corrected image.');
    const outputPixels = outputContext.createImageData(outputWidth, outputHeight);

    const homography = createInverseHomography(sourceCorners, outputWidth, outputHeight);
    const [h0, h1, h2, h3, h4, h5, h6, h7] = homography;
    const sourceData = sourcePixels.data;
    const outputData = outputPixels.data;

    for (let y = 0; y < outputHeight; y += 1) {
      for (let x = 0; x < outputWidth; x += 1) {
        const denominator = h6 * x + h7 * y + 1;
        const sourceX = (h0 * x + h1 * y + h2) / denominator;
        const sourceY = (h3 * x + h4 * y + h5) / denominator;
        const outputIndex = (y * outputWidth + x) * 4;

        if (
          !Number.isFinite(sourceX) || !Number.isFinite(sourceY) ||
          sourceX < 0 || sourceY < 0 ||
          sourceX > sourceWidth - 1 || sourceY > sourceHeight - 1
        ) {
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
          const top = sourceData[topLeft + channel] * (1 - xWeight) +
            sourceData[topRight + channel] * xWeight;
          const bottom = sourceData[bottomLeft + channel] * (1 - xWeight) +
            sourceData[bottomRight + channel] * xWeight;
          outputData[outputIndex + channel] = Math.round(top * (1 - yWeight) + bottom * yWeight);
        }
        outputData[outputIndex + 3] = 255;
      }
    }

    outputContext.putImageData(outputPixels, 0, 0);
    const blob = await canvasToJpeg(outputCanvas, 0.9);
    return { blob, width: outputWidth, height: outputHeight };
  } finally {
    bitmap.close();
  }
}

export async function rotateImage(blob: Blob, rotation: number): Promise<CorrectedImage> {
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const bitmap = await createImageBitmap(blob);
  try {
    if (normalizedRotation === 0) {
      return { blob, width: bitmap.width, height: bitmap.height };
    }

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
    const rotatedBlob = await canvasToJpeg(canvas, 0.9);
    return { blob: rotatedBlob, width, height };
  } finally {
    bitmap.close();
  }
}

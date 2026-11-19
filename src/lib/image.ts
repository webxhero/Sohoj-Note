export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

export type ScanMode = 'original' | 'auto' | 'document' | 'bw' | 'grayscale' | 'magic-color';

export interface ImageAdjustments {
  brightness: number;
  contrast: number;
  sharpness: number;
  saturation: number;
  whiteBalance: number;
  threshold: number;
  shadowReduction: number;
}

export const DEFAULT_IMAGE_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  sharpness: 0,
  saturation: 0,
  whiteBalance: 50,
  threshold: 18,
  shadowReduction: 55,
};

interface ModeProfile {
  denoise: number;
  illumination: number;
  whitening: number;
  clahe: number;
  whiteBalance: number;
  saturation: number;
  grayscale: boolean;
  threshold: boolean;
}

const MODE_PROFILES: Record<ScanMode, ModeProfile> = {
  original: {
    denoise: 0, illumination: 0, whitening: 0, clahe: 0,
    whiteBalance: 0, saturation: 1, grayscale: false, threshold: false,
  },
  auto: {
    denoise: 0.42, illumination: 0.48, whitening: 0.16, clahe: 0.32,
    whiteBalance: 0.24, saturation: 1.04, grayscale: false, threshold: false,
  },
  document: {
    denoise: 0.58, illumination: 0.78, whitening: 0.66, clahe: 0.42,
    whiteBalance: 0.52, saturation: 0.94, grayscale: false, threshold: false,
  },
  bw: {
    denoise: 0.68, illumination: 0.86, whitening: 0.82, clahe: 0.2,
    whiteBalance: 0, saturation: 0, grayscale: true, threshold: true,
  },
  grayscale: {
    denoise: 0.5, illumination: 0.48, whitening: 0.18, clahe: 0.5,
    whiteBalance: 0, saturation: 0, grayscale: true, threshold: false,
  },
  'magic-color': {
    denoise: 0.38, illumination: 0.45, whitening: 0.3, clahe: 0.42,
    whiteBalance: 0.36, saturation: 1.22, grayscale: false, threshold: false,
  },
};

function clamp(value: number, min = 0, max = 255): number {
  return Math.max(min, Math.min(max, value));
}

function luminance(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

/** Normalizes uploaded/captured images for the notebook's ordinary image-import path. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const maxDimension = 2000;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare this image. Please try another photo.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image conversion failed. Please try again.')), type, quality);
  });
}

function buildIlluminationMap(luma: Float32Array, width: number, height: number): {
  values: Float32Array;
  width: number;
  height: number;
} {
  const mapWidth = Math.max(16, Math.min(112, Math.ceil(width / 28)));
  const mapHeight = Math.max(16, Math.min(112, Math.ceil(height / 28)));
  const map = new Float32Array(mapWidth * mapHeight);
  for (let mapY = 0; mapY < mapHeight; mapY += 1) {
    const yStart = Math.floor((mapY * height) / mapHeight);
    const yEnd = Math.max(yStart + 1, Math.floor(((mapY + 1) * height) / mapHeight));
    for (let mapX = 0; mapX < mapWidth; mapX += 1) {
      const xStart = Math.floor((mapX * width) / mapWidth);
      const xEnd = Math.max(xStart + 1, Math.floor(((mapX + 1) * width) / mapWidth));
      let sum = 0;
      let count = 0;
      for (let y = yStart; y < Math.min(height, yEnd); y += 1) {
        for (let x = xStart; x < Math.min(width, xEnd); x += 1) {
          sum += luma[y * width + x];
          count += 1;
        }
      }
      map[mapY * mapWidth + mapX] = sum / Math.max(1, count);
    }
  }

  const horizontal = new Float32Array(map.length);
  const blurred = new Float32Array(map.length);
  const kernel = [1, 2, 3, 2, 1];
  for (let y = 0; y < mapHeight; y += 1) {
    for (let x = 0; x < mapWidth; x += 1) {
      let sum = 0;
      for (let offset = -2; offset <= 2; offset += 1) {
        const sx = Math.max(0, Math.min(mapWidth - 1, x + offset));
        sum += map[y * mapWidth + sx] * kernel[offset + 2];
      }
      horizontal[y * mapWidth + x] = sum / 9;
    }
  }
  for (let y = 0; y < mapHeight; y += 1) {
    for (let x = 0; x < mapWidth; x += 1) {
      let sum = 0;
      for (let offset = -2; offset <= 2; offset += 1) {
        const sy = Math.max(0, Math.min(mapHeight - 1, y + offset));
        sum += horizontal[sy * mapWidth + x] * kernel[offset + 2];
      }
      blurred[y * mapWidth + x] = sum / 9;
    }
  }
  return { values: blurred, width: mapWidth, height: mapHeight };
}

function sampleIllumination(
  map: { values: Float32Array; width: number; height: number },
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const mapX = (x / Math.max(1, width - 1)) * (map.width - 1);
  const mapY = (y / Math.max(1, height - 1)) * (map.height - 1);
  const x0 = Math.floor(mapX);
  const y0 = Math.floor(mapY);
  const x1 = Math.min(map.width - 1, x0 + 1);
  const y1 = Math.min(map.height - 1, y0 + 1);
  const fx = mapX - x0;
  const fy = mapY - y0;
  const top = map.values[y0 * map.width + x0] * (1 - fx) + map.values[y0 * map.width + x1] * fx;
  const bottom = map.values[y1 * map.width + x0] * (1 - fx) + map.values[y1 * map.width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

async function denoiseBilateral(data: Uint8ClampedArray, width: number, height: number, strength: number, signal?: AbortSignal): Promise<Uint8ClampedArray> {
  if (strength <= 0.01) return data;
  const output = new Uint8ClampedArray(data.length);
  const rangeSigma = 18 + strength * 22;
  const spatialWeights = [0.42, 0.68, 0.42, 0.68, 1, 0.68, 0.42, 0.68, 0.42];
  for (let y = 0; y < height; y += 1) {
    if (y > 0 && y % 40 === 0) {
      await yieldToBrowser();
      if (signal?.aborted) throw new Error('Image processing cancelled.');
    }
    for (let x = 0; x < width; x += 1) {
      const center = (y * width + x) * 4;
      const centerLuma = luminance(data[center], data[center + 1], data[center + 2]);
      let sumWeight = 0;
      let sumRed = 0;
      let sumGreen = 0;
      let sumBlue = 0;
      let neighbourIndex = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const sy = Math.max(0, Math.min(height - 1, y + dy));
        for (let dx = -1; dx <= 1; dx += 1) {
          const sx = Math.max(0, Math.min(width - 1, x + dx));
          const index = (sy * width + sx) * 4;
          const neighbourLuma = luminance(data[index], data[index + 1], data[index + 2]);
          const difference = neighbourLuma - centerLuma;
          const rangeWeight = Math.exp(-(difference * difference) / (2 * rangeSigma * rangeSigma));
          const weight = spatialWeights[neighbourIndex] * rangeWeight;
          sumWeight += weight;
          sumRed += data[index] * weight;
          sumGreen += data[index + 1] * weight;
          sumBlue += data[index + 2] * weight;
          neighbourIndex += 1;
        }
      }
      const blend = strength * 0.82;
      const inverseWeight = 1 / Math.max(0.001, sumWeight);
      output[center] = clamp(data[center] * (1 - blend) + sumRed * inverseWeight * blend);
      output[center + 1] = clamp(data[center + 1] * (1 - blend) + sumGreen * inverseWeight * blend);
      output[center + 2] = clamp(data[center + 2] * (1 - blend) + sumBlue * inverseWeight * blend);
      output[center + 3] = data[center + 3];
    }
  }
  return output;
}

function createClaheMaps(luma: Float32Array, width: number, height: number, gridX = 8, gridY = 8): Uint8Array[] {
  const maps: Uint8Array[] = [];
  for (let tileY = 0; tileY < gridY; tileY += 1) {
    const yStart = Math.floor((tileY * height) / gridY);
    const yEnd = Math.max(yStart + 1, Math.floor(((tileY + 1) * height) / gridY));
    for (let tileX = 0; tileX < gridX; tileX += 1) {
      const xStart = Math.floor((tileX * width) / gridX);
      const xEnd = Math.max(xStart + 1, Math.floor(((tileX + 1) * width) / gridX));
      const histogram = new Uint32Array(256);
      let pixels = 0;
      for (let y = yStart; y < Math.min(height, yEnd); y += 1) {
        for (let x = xStart; x < Math.min(width, xEnd); x += 1) {
          histogram[Math.round(clamp(luma[y * width + x]))] += 1;
          pixels += 1;
        }
      }
      const clipLimit = Math.max(2, Math.round((pixels / 256) * 2.1));
      let excess = 0;
      for (let i = 0; i < 256; i += 1) {
        if (histogram[i] > clipLimit) {
          excess += histogram[i] - clipLimit;
          histogram[i] = clipLimit;
        }
      }
      const redistribution = Math.floor(excess / 256);
      const remainder = excess - redistribution * 256;
      for (let i = 0; i < 256; i += 1) histogram[i] += redistribution + (i < remainder ? 1 : 0);
      const lookup = new Uint8Array(256);
      let cumulative = 0;
      for (let i = 0; i < 256; i += 1) {
        cumulative += histogram[i];
        lookup[i] = clamp((cumulative / Math.max(1, pixels)) * 255);
      }
      maps.push(lookup);
    }
  }
  return maps;
}

function applyClaheToLuma(
  luma: Float32Array,
  width: number,
  height: number,
  maps: Uint8Array[],
  strength: number,
): Float32Array {
  if (strength <= 0.001) return luma;
  const gridX = 8;
  const gridY = 8;
  const output = new Float32Array(luma.length);
  for (let y = 0; y < height; y += 1) {
    const tileY = (y / Math.max(1, height - 1)) * (gridY - 1);
    const y0 = Math.floor(tileY);
    const y1 = Math.min(gridY - 1, y0 + 1);
    const fy = tileY - y0;
    for (let x = 0; x < width; x += 1) {
      const tileX = (x / Math.max(1, width - 1)) * (gridX - 1);
      const x0 = Math.floor(tileX);
      const x1 = Math.min(gridX - 1, x0 + 1);
      const fx = tileX - x0;
      const value = Math.round(clamp(luma[y * width + x]));
      const top = maps[y0 * gridX + x0][value] * (1 - fx) + maps[y0 * gridX + x1][value] * fx;
      const bottom = maps[y1 * gridX + x0][value] * (1 - fx) + maps[y1 * gridX + x1][value] * fx;
      const equalized = top * (1 - fy) + bottom * fy;
      output[y * width + x] = luma[y * width + x] * (1 - strength) + equalized * strength;
    }
  }
  return output;
}

function gaussianBlurLuma(luma: Float32Array, width: number, height: number): Float32Array {
  const horizontal = new Float32Array(luma.length);
  const output = new Float32Array(luma.length);
  const kernel = [1, 2, 1];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = luma[y * width + Math.max(0, x - 1)];
      const center = luma[y * width + x];
      const right = luma[y * width + Math.min(width - 1, x + 1)];
      horizontal[y * width + x] = (left + center * 2 + right) / 4;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const top = horizontal[Math.max(0, y - 1) * width + x];
      const center = horizontal[y * width + x];
      const bottom = horizontal[Math.min(height - 1, y + 1) * width + x];
      output[y * width + x] = (top + center * 2 + bottom) / 4;
    }
  }
  return output;
}

function estimateWhiteBalance(data: Uint8ClampedArray): [number, number, number] {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  const step = Math.max(1, Math.floor(data.length / 4 / 160000));
  for (let pixel = 0; pixel < data.length / 4; pixel += step) {
    const index = pixel * 4;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const luma = luminance(r, g, b);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (luma > 168 && spread < 72) {
      red += r;
      green += g;
      blue += b;
      count += 1;
    }
  }
  if (count < 20) return [1, 1, 1];
  const averageRed = red / count;
  const averageGreen = green / count;
  const averageBlue = blue / count;
  const target = (averageRed + averageGreen + averageBlue) / 3;
  return [
    clamp(target / Math.max(1, averageRed), 0.86, 1.16),
    clamp(target / Math.max(1, averageGreen), 0.86, 1.16),
    clamp(target / Math.max(1, averageBlue), 0.86, 1.16),
  ];
}

async function applyManualAdjustmentsInPlace(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  adjustments: ImageAdjustments,
  grayscale: boolean,
  luma: Float32Array,
  signal?: AbortSignal,
): Promise<void> {
  const brightness = adjustments.brightness * 1.25;
  const contrast = adjustments.contrast * 1.65;
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const saturation = grayscale ? 0 : 1 + adjustments.saturation / 100;
  for (let y = 0; y < height; y += 1) {
    if (y > 0 && y % 80 === 0) {
      await yieldToBrowser();
      if (signal?.aborted) throw new Error('Image processing cancelled.');
    }
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const index = pixel * 4;
      luma[pixel] = luminance(data[index], data[index + 1], data[index + 2]);
    }
  }
  const blurred = adjustments.sharpness > 0 ? gaussianBlurLuma(luma, width, height) : luma;
  const sharpenAmount = (adjustments.sharpness / 100) * 1.1;

  for (let y = 0; y < height; y += 1) {
    if (y > 0 && y % 80 === 0) {
      await yieldToBrowser();
      if (signal?.aborted) throw new Error('Image processing cancelled.');
    }
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const index = pixel * 4;
      let red = data[index];
      let green = data[index + 1];
      let blue = data[index + 2];
      const originalLuma = luma[pixel];
      const targetLuma = originalLuma + (originalLuma - blurred[pixel]) * sharpenAmount;
      if (grayscale) {
        const value = clamp((targetLuma - 128) * contrastFactor + 128 + brightness);
        data[index] = value;
        data[index + 1] = value;
        data[index + 2] = value;
      } else {
        const ratio = targetLuma / Math.max(1, originalLuma);
        red *= ratio;
        green *= ratio;
        blue *= ratio;
        const gray = luminance(red, green, blue);
        red = gray + (red - gray) * saturation;
        green = gray + (green - gray) * saturation;
        blue = gray + (blue - gray) * saturation;
        data[index] = clamp((red - 128) * contrastFactor + 128 + brightness);
        data[index + 1] = clamp((green - 128) * contrastFactor + 128 + brightness);
        data[index + 2] = clamp((blue - 128) * contrastFactor + 128 + brightness);
      }
    }
  }
}

/** Runs the selected scanner filter from an untouched perspective-corrected source image. */
export async function processDocumentImage(
  source: Blob,
  mode: ScanMode,
  adjustments: ImageAdjustments,
  maxDimension = 1800,
  signal?: AbortSignal,
): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(source);
  try {
    if (signal?.aborted) throw new Error('Image processing cancelled.');
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Your browser could not prepare the scan preview.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    if (mode === 'original'
      && adjustments.brightness === 0 && adjustments.contrast === 0 && adjustments.sharpness === 0
      && adjustments.saturation === 0 && adjustments.whiteBalance === 50 && adjustments.shadowReduction === 55) {
      return { blob: await canvasToBlob(canvas, 'image/jpeg', 0.96), width, height };
    }

    const image = context.getImageData(0, 0, width, height);
    const profile = MODE_PROFILES[mode];
    let denoisedData = await denoiseBilateral(image.data, width, height, profile.denoise, signal);
    image.data.set(denoisedData);
    denoisedData = image.data;
    const total = width * height;
    const luma = new Float32Array(total);
    for (let y = 0; y < height; y += 1) {
      if (y > 0 && y % 100 === 0) {
        await yieldToBrowser();
        if (signal?.aborted) throw new Error('Image processing cancelled.');
      }
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        const index = pixel * 4;
        luma[pixel] = luminance(denoisedData[index], denoisedData[index + 1], denoisedData[index + 2]);
      }
    }

    const illuminationMap = buildIlluminationMap(luma, width, height);
    const illuminationStrength = clamp(profile.illumination * (adjustments.shadowReduction / 55), 0, 0.98);
    const targetPaperLuma = mode === 'document' || mode === 'bw' ? 239 : mode === 'grayscale' ? 232 : 226;
    const whiteBalance = estimateWhiteBalance(denoisedData);
    const whiteBalanceStrength = clamp(profile.whiteBalance * (adjustments.whiteBalance / 50), 0, 1);
    const whiteBalanceGains = whiteBalance.map((gain) => 1 + (gain - 1) * whiteBalanceStrength) as [number, number, number];

    for (let y = 0; y < height; y += 1) {
      if (y > 0 && y % 64 === 0) {
        await yieldToBrowser();
        if (signal?.aborted) throw new Error('Image processing cancelled.');
      }
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        const index = pixel * 4;
        const local = Math.max(40, sampleIllumination(illuminationMap, x, y, width, height));
        const sourceLuma = luma[pixel];
        const localContrast = sourceLuma - local;
        const normalizedLuma = clamp(local + localContrast * (1 + illuminationStrength * 0.68)
          + (targetPaperLuma - local) * illuminationStrength);
        const localWhitening = profile.whitening * clamp((normalizedLuma - 150) / 100, 0, 1);
        const whitenedLuma = clamp(normalizedLuma + (255 - normalizedLuma) * localWhitening * 0.72);
        const ratio = whitenedLuma / Math.max(1, sourceLuma);
        let red = denoisedData[index] * ratio * whiteBalanceGains[0];
        let green = denoisedData[index + 1] * ratio * whiteBalanceGains[1];
        let blue = denoisedData[index + 2] * ratio * whiteBalanceGains[2];
        if (profile.saturation !== 1 && !profile.grayscale) {
          const gray = luminance(red, green, blue);
          red = gray + (red - gray) * profile.saturation;
          green = gray + (green - gray) * profile.saturation;
          blue = gray + (blue - gray) * profile.saturation;
        }
        if (profile.grayscale) {
          const gray = clamp(luminance(red, green, blue));
          red = gray;
          green = gray;
          blue = gray;
        }
        image.data[index] = clamp(red);
        image.data[index + 1] = clamp(green);
        image.data[index + 2] = clamp(blue);
        luma[pixel] = luminance(image.data[index], image.data[index + 1], image.data[index + 2]);
      }
    }

    if (signal?.aborted) throw new Error('Image processing cancelled.');
    if (profile.clahe > 0) {
      const claheMaps = createClaheMaps(luma, width, height);
      const enhancedLuma = applyClaheToLuma(luma, width, height, claheMaps, profile.clahe);
      for (let pixel = 0, index = 0; pixel < total; pixel += 1, index += 4) {
        const ratio = enhancedLuma[pixel] / Math.max(1, luma[pixel]);
        image.data[index] = clamp(image.data[index] * ratio);
        image.data[index + 1] = clamp(image.data[index + 1] * ratio);
        image.data[index + 2] = clamp(image.data[index + 2] * ratio);
        luma[pixel] = enhancedLuma[pixel];
      }
    }

    if (profile.threshold) {
      const thresholdMap = buildIlluminationMap(luma, width, height);
      const thresholdOffset = clamp(adjustments.threshold, 0, 60);
      for (let y = 0; y < height; y += 1) {
        if (y > 0 && y % 64 === 0) {
          await yieldToBrowser();
          if (signal?.aborted) throw new Error('Image processing cancelled.');
        }
        for (let x = 0; x < width; x += 1) {
          const pixel = y * width + x;
          const index = pixel * 4;
          const local = sampleIllumination(thresholdMap, x, y, width, height);
          const threshold = local - thresholdOffset;
          const value = clamp(((luma[pixel] - (threshold - 10)) / 20) * 255);
          image.data[index] = value;
          image.data[index + 1] = value;
          image.data[index + 2] = value;
          image.data[index + 3] = 255;
        }
      }
    }

    await applyManualAdjustmentsInPlace(image.data, width, height, adjustments, profile.grayscale, luma, signal);
    context.putImageData(image, 0, 0);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.96);
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFileName(value: string): string {
  return value
    .trim()
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'sohoj-note';
}

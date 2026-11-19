import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowLeft,
  Check,
  Crop,
  Download,
  FileText,
  RotateCcw,
  RotateCw,
  Scan,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import {
  DEFAULT_IMAGE_ADJUSTMENTS,
  downloadBlob,
  processDocumentImage,
  safeFileName,
  type ImageAdjustments,
  type ScanMode,
} from '../lib/image';
import { exportImageAsPdf } from '../lib/pdf';
import {
  detectDocument,
  rectifyPerspective,
  rotateImage,
  validateCorners,
  type CorrectedImage,
  type Point,
} from '../lib/scanner';

interface DocumentScannerProps {
  source: Blob;
  sourceName: string;
  onCancel: () => void;
  onSave: (result: CorrectedImage) => Promise<void>;
}

const DEFAULT_CORNERS: Point[] = [
  { x: 0.045, y: 0.045 },
  { x: 0.955, y: 0.045 },
  { x: 0.955, y: 0.955 },
  { x: 0.045, y: 0.955 },
];

const PREVIEW_MAX_DIMENSION = 1500;
const FINAL_MAX_DIMENSION = 4200;

const SCAN_MODES: Array<{ value: ScanMode; label: string; description: string }> = [
  { value: 'original', label: 'Original', description: 'Natural photo colors' },
  { value: 'bw', label: 'Magic', description: 'Clean white paper and crisp text' },
  { value: 'auto', label: 'Auto', description: 'Balanced cleanup' },
  { value: 'document', label: 'Document', description: 'Clean paper and text' },
  { value: 'grayscale', label: 'Grayscale', description: 'Detailed gray tones' },
  { value: 'magic-color', label: 'Magic Color', description: 'Vivid, clean color' },
];

const ADJUSTMENT_CONTROLS: Array<{
  key: keyof ImageAdjustments;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'brightness', label: 'Brightness', min: -50, max: 50, step: 1 },
  { key: 'contrast', label: 'Contrast', min: -50, max: 50, step: 1 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 100, step: 1 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1 },
  { key: 'whiteBalance', label: 'White balance', min: 0, max: 100, step: 1 },
  { key: 'threshold', label: 'Magic threshold', min: 5, max: 45, step: 1 },
  { key: 'shadowReduction', label: 'Shadow reduction', min: 0, max: 100, step: 1 },
];

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not process this image. Please try again.';
}

function sourceBaseName(sourceName: string): string {
  const withoutExtension = sourceName.replace(/\.[^.]+$/, '');
  return safeFileName(withoutExtension || 'scanned-document');
}

export default function DocumentScanner({ source, sourceName, onCancel, onSave }: DocumentScannerProps) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [corners, setCorners] = useState<Point[]>(DEFAULT_CORNERS);
  const [automaticCorners, setAutomaticCorners] = useState<Point[] | null>(null);
  const [detectionConfidence, setDetectionConfidence] = useState<number | null>(null);
  const [basePreview, setBasePreview] = useState<CorrectedImage | null>(null);
  const [preview, setPreview] = useState<Blob | null>(null);
  const [rotation, setRotation] = useState(0);
  const [phase, setPhase] = useState<'adjust' | 'preview'>('adjust');
  const [mode, setMode] = useState<ScanMode>('auto');
  const [adjustments, setAdjustments] = useState<ImageAdjustments>(DEFAULT_IMAGE_ADJUSTMENTS);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPreviewProcessing, setIsPreviewProcessing] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [detectionMessage, setDetectionMessage] = useState('Looking for document edges…');
  const [error, setError] = useState('');
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const previewGenerationRef = useRef(0);
  const finalCacheRef = useRef<{ key: string; source: Blob; result: CorrectedImage } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(source);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);

  useEffect(() => {
    if (!preview) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(preview);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  useEffect(() => {
    let cancelled = false;
    setSourceSize(null);
    setAutomaticCorners(null);
    setDetectionConfidence(null);
    setCorners(DEFAULT_CORNERS);
    setIsDetecting(true);
    setDetectionMessage('Detecting paper boundaries…');
    detectDocument(source)
      .then((detected) => {
        if (cancelled) return;
        if (detected) {
          setCorners(detected.corners);
          setAutomaticCorners(detected.corners);
          setDetectionConfidence(detected.confidence);
          const percent = Math.round(detected.confidence * 100);
          setDetectionMessage(`Document boundary found · ${percent}% confidence · ${detected.method} analysis. Check the handles before continuing.`);
        } else {
          setAutomaticCorners(null);
          setDetectionConfidence(null);
          setCorners(DEFAULT_CORNERS);
          setDetectionMessage('No reliable document boundary found. Position the four handles manually.');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAutomaticCorners(null);
          setDetectionConfidence(null);
          setCorners(DEFAULT_CORNERS);
          setDetectionMessage('Automatic detection could not process this image. Select the four corners manually.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsDetecting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    if (phase !== 'preview' || !basePreview) return;
    const generation = previewGenerationRef.current + 1;
    previewGenerationRef.current = generation;
    const controller = new AbortController();
    let cancelled = false;
    setIsPreviewProcessing(true);
    setError('');
    const timer = window.setTimeout(() => {
      processDocumentImage(basePreview.blob, mode, adjustments, PREVIEW_MAX_DIMENSION, controller.signal)
        .then((result) => {
          if (!cancelled && previewGenerationRef.current === generation) setPreview(result.blob);
        })
        .catch((caught: unknown) => {
          if (!cancelled && previewGenerationRef.current === generation) setError(messageFromError(caught));
        })
        .finally(() => {
          if (!cancelled && previewGenerationRef.current === generation) setIsPreviewProcessing(false);
        });
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [phase, basePreview, mode, adjustments]);

  function updateCorner(index: number, event: ReactPointerEvent<SVGSVGElement>) {
    if (draggingIndex === null || draggingIndex !== index || !svgRef.current) return;
    const bounds = svgRef.current.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const nextPoint = {
      x: Math.max(0.002, Math.min(0.998, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0.002, Math.min(0.998, (event.clientY - bounds.top) / bounds.height)),
    };
    setCorners((current) => current.map((point, pointIndex) => pointIndex === index ? nextPoint : point));
  }

  function startDragging(index: number, event: ReactPointerEvent<SVGCircleElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDraggingIndex(index);
    svgRef.current?.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (draggingIndex !== null) updateCorner(draggingIndex, event);
  }

  function handleCornerKeyDown(index: number, event: ReactKeyboardEvent<SVGCircleElement>) {
    const movement = event.shiftKey ? 0.03 : 0.01;
    const offsets: Record<string, Point> = {
      ArrowUp: { x: 0, y: -movement },
      ArrowDown: { x: 0, y: movement },
      ArrowLeft: { x: -movement, y: 0 },
      ArrowRight: { x: movement, y: 0 },
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    setCorners((current) => current.map((point, pointIndex) => pointIndex === index
      ? { x: Math.max(0.002, Math.min(0.998, point.x + offset.x)), y: Math.max(0.002, Math.min(0.998, point.y + offset.y)) }
      : point));
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
    setDraggingIndex(null);
  }

  async function handleDetect() {
    setError('');
    setIsDetecting(true);
    try {
      const detected = await detectDocument(source);
      if (detected) {
        setCorners(detected.corners);
        setAutomaticCorners(detected.corners);
        setDetectionConfidence(detected.confidence);
        setDetectionMessage(`Document boundary found · ${Math.round(detected.confidence * 100)}% confidence. Check the handles before continuing.`);
      } else {
        setAutomaticCorners(null);
        setDetectionConfidence(null);
        setDetectionMessage('No reliable document boundary found. Adjust the four handles manually.');
      }
    } catch {
      setDetectionMessage('Automatic detection could not process this image. Use the manual corner handles.');
    } finally {
      setIsDetecting(false);
    }
  }

  function resetCorners() {
    setCorners(automaticCorners ?? DEFAULT_CORNERS);
  }

  async function handlePreview() {
    setError('');
    const validationError = validateCorners(corners);
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsProcessing(true);
    try {
      const result = await rectifyPerspective(source, corners, PREVIEW_MAX_DIMENSION);
      setBasePreview(result);
      setPreview(null);
      setRotation(0);
      setPhase('preview');
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setIsProcessing(false);
    }
  }

  function updateAdjustment(key: keyof ImageAdjustments, value: number) {
    setAdjustments((current) => ({ ...current, [key]: value }));
  }

  async function buildFinalResult(): Promise<CorrectedImage> {
    const key = JSON.stringify({ corners, mode, adjustments, rotation });
    if (finalCacheRef.current?.key === key && finalCacheRef.current.source === source) return finalCacheRef.current.result;
    const corrected = await rectifyPerspective(source, corners, FINAL_MAX_DIMENSION);
    const enhanced = await processDocumentImage(corrected.blob, mode, adjustments, FINAL_MAX_DIMENSION);
    const rotated = await rotateImage(enhanced.blob, rotation);
    const result = { blob: rotated.blob, width: rotated.width, height: rotated.height };
    finalCacheRef.current = { key, source, result };
    return result;
  }

  async function handleSave() {
    setError('');
    setIsFinalizing(true);
    setIsSaving(true);
    try {
      const result = await buildFinalResult();
      await onSave(result);
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setIsSaving(false);
      setIsFinalizing(false);
    }
  }

  async function handleDownloadImage() {
    setError('');
    setIsFinalizing(true);
    try {
      const result = await buildFinalResult();
      downloadBlob(result.blob, `${sourceBaseName(sourceName)}-scan.jpg`);
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setIsFinalizing(false);
    }
  }

  async function handleDownloadPdf() {
    setError('');
    setIsFinalizing(true);
    try {
      const result = await buildFinalResult();
      await exportImageAsPdf(result.blob, `${sourceBaseName(sourceName)}-scan`);
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setIsFinalizing(false);
    }
  }

  const validationError = validateCorners(corners);
  const cornerPoints = sourceSize
    ? corners.map((point) => `${point.x * sourceSize.width},${point.y * sourceSize.height}`).join(' ')
    : '';
  const isBusy = isSaving || isProcessing || isFinalizing;

  return (
    <main className="scanner-page" aria-labelledby="scanner-title">
      <section className="scanner-page-shell">
        <header className="scanner-header">
          <div>
            <span className="eyebrow">DOCUMENT SCANNER</span>
            <h2 id="scanner-title">{phase === 'adjust' ? 'Adjust document corners' : 'Enhance scanned page'}</h2>
            <p>{sourceName || 'Image'} · Processing stays on this device</p>
          </div>
          <button className="icon-button" aria-label="Back to previous page" title="Back" onClick={onCancel} disabled={isBusy}>
            <ArrowLeft size={18} />
          </button>
        </header>

        {phase === 'adjust' ? (
          <>
            <div className="scanner-workspace">
              {sourceUrl ? (
                <div
                  className="scanner-image-frame"
                  style={sourceSize ? {
                    width: `min(100%, calc(58vh * ${sourceSize.width / sourceSize.height}))`,
                    aspectRatio: `${sourceSize.width} / ${sourceSize.height}`,
                  } : undefined}
                >
                  <img
                    src={sourceUrl}
                    alt="Document to scan"
                    onLoad={(event) => setSourceSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })}
                    onError={() => setError('This image could not be decoded. Try a JPEG or PNG image instead.')}
                  />
                  {sourceSize && (
                    <svg
                      ref={svgRef}
                      className="scanner-overlay"
                      viewBox={`0 0 ${sourceSize.width} ${sourceSize.height}`}
                      preserveAspectRatio="none"
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerUp}
                    >
                      <polygon points={cornerPoints} className="scanner-selection" />
                      {corners.map((point, index) => (
                        <g key={index}>
                          <circle
                            cx={point.x * sourceSize.width}
                            cy={point.y * sourceSize.height}
                            r={Math.max(17, Math.min(sourceSize.width, sourceSize.height) * 0.028)}
                            className={`scanner-handle ${draggingIndex === index ? 'dragging' : ''}`}
                            role="button"
                            tabIndex={0}
                            aria-label={`Move document corner ${index + 1}`}
                            onPointerDown={(event) => startDragging(index, event)}
                            onKeyDown={(event) => handleCornerKeyDown(index, event)}
                          />
                          <text
                            x={point.x * sourceSize.width}
                            y={point.y * sourceSize.height + 5}
                            className="scanner-handle-label"
                            pointerEvents="none"
                            textAnchor="middle"
                          >
                            {index + 1}
                          </text>
                        </g>
                      ))}
                    </svg>
                  )}
                </div>
              ) : (
                <div className="scanner-loading">Preparing image…</div>
              )}
            </div>

            <div className="scanner-controls">
              <div className="scanner-detection">
                <Scan size={16} />
                <span>{isDetecting ? 'Analyzing edges and document contours locally…' : detectionMessage}</span>
              </div>
              <div className="scanner-button-row">
                <button className="secondary-button" onClick={() => void handleDetect()} disabled={isDetecting || isProcessing || !sourceSize}>
                  <Scan size={15} /> {isDetecting ? 'Detecting…' : 'Auto-detect'}
                </button>
                <button className="secondary-button" onClick={resetCorners} disabled={isDetecting || isProcessing}>
                  <RotateCcw size={15} /> Reset corners
                </button>
                {detectionConfidence !== null && (
                  <span className="scanner-confidence">{Math.round(detectionConfidence * 100)}% confidence</span>
                )}
              </div>
              <p className="scanner-help">Drag each numbered handle onto a paper corner. You can also focus a handle and use the arrow keys for precise adjustment.</p>
            </div>
          </>
        ) : (
          <>
            <div className="scanner-preview-area">
              {previewUrl ? (
                <img
                  className="scanner-preview-image"
                  src={previewUrl}
                  alt="Perspective-corrected and enhanced document preview"
                  style={{ transform: `rotate(${rotation}deg)` }}
                />
              ) : (
                <div className="scanner-loading">Preparing scan preview…</div>
              )}
              {(isPreviewProcessing || isFinalizing) && <div className="scanner-processing-indicator"><span className="scanner-spinner" /> {isFinalizing ? 'Rendering full-resolution scan…' : 'Updating preview…'}</div>}
            </div>
            <div className="scanner-controls scanner-enhance-controls">
              <div className="scanner-section-heading">
                <div><Sparkles size={15} /><strong>Scanning mode</strong></div>
                <span>Each mode uses a separate image-processing pipeline</span>
              </div>
              <div className="scanner-filter-list">
                {SCAN_MODES.map((item) => (
                  <button
                    key={item.value}
                    className={`scanner-filter-option ${mode === item.value ? 'active' : ''}`}
                    onClick={() => setMode(item.value)}
                    disabled={isFinalizing}
                    aria-pressed={mode === item.value}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.description}</span>
                  </button>
                ))}
              </div>

              <details className="scanner-adjustments" open>
                <summary><SlidersHorizontal size={15} /> Image adjustments</summary>
                <div className="scanner-adjustment-grid">
                  {ADJUSTMENT_CONTROLS.map((control) => (
                    <label className="scanner-adjustment" key={control.key}>
                      <span>{control.label}</span>
                      <input
                        type="range"
                        min={control.min}
                        max={control.max}
                        step={control.step}
                        value={adjustments[control.key]}
                        onChange={(event) => updateAdjustment(control.key, Number(event.currentTarget.value))}
                        disabled={isFinalizing
                          || (control.key === 'threshold' && mode !== 'bw')
                          || (control.key === 'shadowReduction' && mode === 'original')
                          || (control.key === 'saturation' && (mode === 'bw' || mode === 'grayscale'))
                          || (control.key === 'whiteBalance' && (mode === 'original' || mode === 'bw' || mode === 'grayscale'))}
                      />
                      <output>{adjustments[control.key]}</output>
                    </label>
                  ))}
                </div>
                <button className="text-button scanner-reset-adjustments" onClick={() => setAdjustments(DEFAULT_IMAGE_ADJUSTMENTS)} disabled={isFinalizing}>
                  Reset adjustments
                </button>
              </details>

              <div className="scanner-button-row scanner-rotation-row">
                <button className="secondary-button" onClick={() => setRotation((value) => (value + 270) % 360)} disabled={isFinalizing}>
                  <RotateCcw size={15} /> Rotate left
                </button>
                <button className="secondary-button" onClick={() => setRotation((value) => (value + 90) % 360)} disabled={isFinalizing}>
                  <RotateCw size={15} /> Rotate right
                </button>
                <span className="scanner-preview-note">Preview is reduced for speed; export is rendered from the full-resolution source.</span>
              </div>
            </div>
          </>
        )}

        {error && <div className="scanner-error" role="alert">{error}</div>}

        <footer className="scanner-footer">
          {phase === 'adjust' ? (
            <>
              <button className="secondary-button" onClick={onCancel} disabled={isBusy}>Cancel</button>
              <button className="primary-button" onClick={() => void handlePreview()} disabled={!sourceSize || isProcessing || Boolean(validationError)}>
                <Crop size={15} /> {isProcessing ? 'Correcting perspective…' : 'Correct & enhance'}
              </button>
            </>
          ) : (
            <>
              <button className="secondary-button" onClick={() => { setPhase('adjust'); setError(''); }} disabled={isBusy}>
                <ArrowLeft size={15} /> Adjust corners
              </button>
              <button className="secondary-button" onClick={() => void handleDownloadImage()} disabled={isBusy || isPreviewProcessing || !preview}>
                <Download size={15} /> {isFinalizing ? 'Rendering…' : 'Download image'}
              </button>
              <button className="secondary-button" onClick={() => void handleDownloadPdf()} disabled={isBusy || isPreviewProcessing || !preview}>
                <FileText size={15} /> PDF
              </button>
              <button className="primary-button" onClick={() => void handleSave()} disabled={isBusy || isPreviewProcessing || !preview}>
                <Check size={15} /> {isSaving ? 'Saving…' : 'Save page'}
              </button>
            </>
          )}
        </footer>
      </section>
    </main>
  );
}

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, Check, Crop, RotateCcw, RotateCw, Scan, X } from 'lucide-react';
import {
  detectDocumentCorners,
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
  { x: 0.055, y: 0.055 },
  { x: 0.945, y: 0.055 },
  { x: 0.945, y: 0.945 },
  { x: 0.055, y: 0.945 },
];

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not process this image. Please try again.';
}

export default function DocumentScanner({ source, sourceName, onCancel, onSave }: DocumentScannerProps) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [corners, setCorners] = useState<Point[]>(DEFAULT_CORNERS);
  const [preview, setPreview] = useState<Blob | null>(null);
  const [rotation, setRotation] = useState(0);
  const [phase, setPhase] = useState<'adjust' | 'preview'>('adjust');
  const [isDetecting, setIsDetecting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [detectionMessage, setDetectionMessage] = useState('Looking for document edges…');
  const [error, setError] = useState('');
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

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
    if (!sourceUrl) return;
    let cancelled = false;
    setIsDetecting(true);
    setDetectionMessage('Looking for document edges…');
    detectDocumentCorners(source)
      .then((detected) => {
        if (cancelled) return;
        if (detected) {
          setCorners(detected);
          setDetectionMessage('Document edges detected. Adjust any corner that needs correction.');
        } else {
          setDetectionMessage('No clear document boundary found. The manual corner handles are ready.');
        }
      })
      .catch(() => {
        if (!cancelled) setDetectionMessage('Automatic detection was unavailable. Select the four corners manually.');
      })
      .finally(() => {
        if (!cancelled) setIsDetecting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, sourceUrl]);

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
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId);
    }
    setDraggingIndex(null);
  }

  async function handleDetect() {
    setError('');
    setIsDetecting(true);
    try {
      const detected = await detectDocumentCorners(source);
      if (detected) {
        setCorners(detected);
        setDetectionMessage('Document edges detected. Adjust any corner that needs correction.');
      } else {
        setDetectionMessage('No clear document boundary found. Adjust the four corners manually.');
      }
    } catch {
      setDetectionMessage('Automatic detection could not process this image. Use the manual corner handles.');
    } finally {
      setIsDetecting(false);
    }
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
      const result = await rectifyPerspective(source, corners);
      setPreview(result.blob);
      setRotation(0);
      setPhase('preview');
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleSave() {
    if (!preview) return;
    setError('');
    setIsSaving(true);
    try {
      const result = await rotateImage(preview, rotation);
      await onSave(result);
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  const validationError = validateCorners(corners);
  const cornerPoints = sourceSize
    ? corners.map((point) => `${point.x * sourceSize.width},${point.y * sourceSize.height}`).join(' ')
    : '';

  return (
    <div className="scanner-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isSaving && !isProcessing) onCancel();
    }}>
      <section className="scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
        <header className="scanner-header">
          <div>
            <span className="eyebrow">DOCUMENT SCANNER</span>
            <h2 id="scanner-title">{phase === 'adjust' ? 'Adjust document corners' : 'Review scanned page'}</h2>
            <p>{sourceName || 'Image'} · Processing stays on this device</p>
          </div>
          <button className="icon-button" aria-label="Close scanner" onClick={onCancel} disabled={isSaving || isProcessing}>
            <X size={18} />
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
                <span>{isDetecting ? 'Checking image edges locally…' : detectionMessage}</span>
              </div>
              <div className="scanner-button-row">
                <button className="secondary-button" onClick={() => void handleDetect()} disabled={isDetecting || isProcessing || !sourceSize}>
                  <Scan size={15} /> {isDetecting ? 'Detecting…' : 'Auto-detect'}
                </button>
              </div>
              <p className="scanner-help">{validationError || 'Drag the four numbered handles to the document corners. Keep the handles in order and inside the image.'}</p>
            </div>
          </>
        ) : (
          <>
            <div className="scanner-preview-area">
              {previewUrl ? (
                <img
                  className="scanner-preview-image"
                  src={previewUrl}
                  alt="Perspective-corrected document preview"
                  style={{ transform: `rotate(${rotation}deg)` }}
                />
              ) : (
                <div className="scanner-loading">Preparing preview…</div>
              )}
            </div>
            <div className="scanner-controls scanner-preview-controls">
              <div className="scanner-button-row scanner-rotation-row">
                <button className="secondary-button" onClick={() => setRotation((value) => (value + 270) % 360)} disabled={isSaving}>
                  <RotateCcw size={15} /> Rotate left
                </button>
                <button className="secondary-button" onClick={() => setRotation((value) => (value + 90) % 360)} disabled={isSaving}>
                  <RotateCw size={15} /> Rotate right
                </button>
              </div>
              <p className="scanner-help">Review the corrected image. Saving replaces the existing page or adds one new page to this notebook.</p>
            </div>
          </>
        )}

        {error && <div className="scanner-error" role="alert">{error}</div>}

        <footer className="scanner-footer">
          {phase === 'adjust' ? (
            <>
              <button className="secondary-button" onClick={onCancel} disabled={isSaving || isProcessing}>Cancel</button>
              <button className="primary-button" onClick={() => void handlePreview()} disabled={!sourceSize || isProcessing || Boolean(validationError)}>
                <Crop size={15} /> {isProcessing ? 'Correcting…' : 'Preview crop'}
              </button>
            </>
          ) : (
            <>
              <button className="secondary-button" onClick={() => { setPhase('adjust'); setError(''); }} disabled={isSaving}>
                <ArrowLeft size={15} /> Adjust corners
              </button>
              <button className="primary-button" onClick={() => void handleSave()} disabled={isSaving}>
                <Check size={15} /> {isSaving ? 'Saving…' : 'Save page'}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}

'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';

interface Point {
  x: number;
  y: number;
}

interface DrawingPath {
  type: 'path';
  points: Point[];
  color: string;
  lineWidth: number;
}

interface DrawingShape {
  type: 'rectangle' | 'circle' | 'arrow';
  start: Point;
  end: Point;
  color: string;
  lineWidth: number;
}

interface DrawingText {
  type: 'text';
  position: Point;
  text: string;
  color: string;
  fontSize: number;
}

type DrawingElement = DrawingPath | DrawingShape | DrawingText;

interface AnnotationEditorProps {
  imageUrl: string;
  onSave: (annotatedImageBlob: Blob) => void;
  onCancel: () => void;
}

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ffffff', '#000000'];
const LINE_WIDTHS = [2, 4, 6, 8];

export default function AnnotationEditor({ imageUrl, onSave, onCancel }: AnnotationEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<'pen' | 'rectangle' | 'circle' | 'arrow' | 'text'>('pen');
  const [color, setColor] = useState('#ef4444');
  const [lineWidth, setLineWidth] = useState(4);
  const [elements, setElements] = useState<DrawingElement[]>([]);
  const [currentPath, setCurrentPath] = useState<Point[]>([]);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [textInput, setTextInput] = useState('');
  const [textPosition, setTextPosition] = useState<Point | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [scale, setScale] = useState(1);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImage(img);

      // Calculate canvas size to fit container while maintaining aspect ratio
      const container = containerRef.current;
      if (container) {
        const maxWidth = container.clientWidth - 32;
        const maxHeight = window.innerHeight - 300;

        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          const ratio = maxWidth / width;
          width = maxWidth;
          height = height * ratio;
        }

        if (height > maxHeight) {
          const ratio = maxHeight / height;
          height = maxHeight;
          width = width * ratio;
        }

        setCanvasSize({ width, height });
        setScale(width / img.width);
      }
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Redraw canvas
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !image) return;

    // Clear and draw image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Draw all elements
    elements.forEach((element) => {
      ctx.strokeStyle = element.color;
      ctx.fillStyle = element.color;
      ctx.lineWidth = element.type === 'text' ? 1 : element.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (element.type === 'path') {
        if (element.points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(element.points[0].x, element.points[0].y);
        element.points.forEach((point) => {
          ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
      } else if (element.type === 'rectangle') {
        const width = element.end.x - element.start.x;
        const height = element.end.y - element.start.y;
        ctx.strokeRect(element.start.x, element.start.y, width, height);
      } else if (element.type === 'circle') {
        const radius = Math.sqrt(
          Math.pow(element.end.x - element.start.x, 2) +
          Math.pow(element.end.y - element.start.y, 2)
        );
        ctx.beginPath();
        ctx.arc(element.start.x, element.start.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else if (element.type === 'arrow') {
        // Draw line
        ctx.beginPath();
        ctx.moveTo(element.start.x, element.start.y);
        ctx.lineTo(element.end.x, element.end.y);
        ctx.stroke();

        // Draw arrowhead
        const angle = Math.atan2(element.end.y - element.start.y, element.end.x - element.start.x);
        const headLength = 15;
        ctx.beginPath();
        ctx.moveTo(element.end.x, element.end.y);
        ctx.lineTo(
          element.end.x - headLength * Math.cos(angle - Math.PI / 6),
          element.end.y - headLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(element.end.x, element.end.y);
        ctx.lineTo(
          element.end.x - headLength * Math.cos(angle + Math.PI / 6),
          element.end.y - headLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.stroke();
      } else if (element.type === 'text') {
        ctx.font = `bold ${element.fontSize}px Arial`;
        ctx.fillText(element.text, element.position.x, element.position.y);
      }
    });

    // Draw current path while drawing
    if (currentPath.length > 1 && tool === 'pen') {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(currentPath[0].x, currentPath[0].y);
      currentPath.forEach((point) => {
        ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    }

    // Draw preview shape while drawing
    if (startPoint && isDrawing && tool !== 'pen' && tool !== 'text') {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash([5, 5]);

      const currentPoint = currentPath[currentPath.length - 1] || startPoint;

      if (tool === 'rectangle') {
        const width = currentPoint.x - startPoint.x;
        const height = currentPoint.y - startPoint.y;
        ctx.strokeRect(startPoint.x, startPoint.y, width, height);
      } else if (tool === 'circle') {
        const radius = Math.sqrt(
          Math.pow(currentPoint.x - startPoint.x, 2) +
          Math.pow(currentPoint.y - startPoint.y, 2)
        );
        ctx.beginPath();
        ctx.arc(startPoint.x, startPoint.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else if (tool === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(currentPoint.x, currentPoint.y);
        ctx.stroke();
      }

      ctx.setLineDash([]);
    }
  }, [image, elements, currentPath, startPoint, isDrawing, tool, color, lineWidth]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  const getCanvasPoint = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e);

    if (tool === 'text') {
      setTextPosition(point);
      return;
    }

    setIsDrawing(true);
    setStartPoint(point);

    if (tool === 'pen') {
      setCurrentPath([point]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const point = getCanvasPoint(e);

    if (tool === 'pen') {
      setCurrentPath((prev) => [...prev, point]);
    } else {
      setCurrentPath([point]);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint) {
      setIsDrawing(false);
      return;
    }

    const endPoint = getCanvasPoint(e);

    if (tool === 'pen') {
      if (currentPath.length > 1) {
        setElements((prev) => [
          ...prev,
          { type: 'path', points: currentPath, color, lineWidth },
        ]);
      }
    } else if (tool !== 'text') {
      setElements((prev) => [
        ...prev,
        { type: tool, start: startPoint, end: endPoint, color, lineWidth } as DrawingShape,
      ]);
    }

    setIsDrawing(false);
    setCurrentPath([]);
    setStartPoint(null);
  };

  const handleAddText = () => {
    if (!textPosition || !textInput.trim()) return;

    setElements((prev) => [
      ...prev,
      { type: 'text', position: textPosition, text: textInput, color, fontSize: 16 },
    ]);

    setTextInput('');
    setTextPosition(null);
  };

  const handleUndo = () => {
    setElements((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setElements([]);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    // Create a new canvas at original image size for high quality export
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = image.width;
    exportCanvas.height = image.height;
    const exportCtx = exportCanvas.getContext('2d');
    if (!exportCtx) return;

    // Draw image at full size
    exportCtx.drawImage(image, 0, 0);

    // Scale factor for drawing elements
    const exportScale = image.width / canvasSize.width;

    // Draw all elements at full scale
    elements.forEach((element) => {
      exportCtx.strokeStyle = element.color;
      exportCtx.fillStyle = element.color;
      exportCtx.lineWidth = (element.type === 'text' ? 1 : element.lineWidth) * exportScale;
      exportCtx.lineCap = 'round';
      exportCtx.lineJoin = 'round';

      if (element.type === 'path') {
        if (element.points.length < 2) return;
        exportCtx.beginPath();
        exportCtx.moveTo(element.points[0].x * exportScale, element.points[0].y * exportScale);
        element.points.forEach((point) => {
          exportCtx.lineTo(point.x * exportScale, point.y * exportScale);
        });
        exportCtx.stroke();
      } else if (element.type === 'rectangle') {
        const width = (element.end.x - element.start.x) * exportScale;
        const height = (element.end.y - element.start.y) * exportScale;
        exportCtx.strokeRect(
          element.start.x * exportScale,
          element.start.y * exportScale,
          width,
          height
        );
      } else if (element.type === 'circle') {
        const radius = Math.sqrt(
          Math.pow(element.end.x - element.start.x, 2) +
          Math.pow(element.end.y - element.start.y, 2)
        ) * exportScale;
        exportCtx.beginPath();
        exportCtx.arc(
          element.start.x * exportScale,
          element.start.y * exportScale,
          radius,
          0,
          Math.PI * 2
        );
        exportCtx.stroke();
      } else if (element.type === 'arrow') {
        exportCtx.beginPath();
        exportCtx.moveTo(element.start.x * exportScale, element.start.y * exportScale);
        exportCtx.lineTo(element.end.x * exportScale, element.end.y * exportScale);
        exportCtx.stroke();

        const angle = Math.atan2(
          element.end.y - element.start.y,
          element.end.x - element.start.x
        );
        const headLength = 15 * exportScale;
        exportCtx.beginPath();
        exportCtx.moveTo(element.end.x * exportScale, element.end.y * exportScale);
        exportCtx.lineTo(
          element.end.x * exportScale - headLength * Math.cos(angle - Math.PI / 6),
          element.end.y * exportScale - headLength * Math.sin(angle - Math.PI / 6)
        );
        exportCtx.moveTo(element.end.x * exportScale, element.end.y * exportScale);
        exportCtx.lineTo(
          element.end.x * exportScale - headLength * Math.cos(angle + Math.PI / 6),
          element.end.y * exportScale - headLength * Math.sin(angle + Math.PI / 6)
        );
        exportCtx.stroke();
      } else if (element.type === 'text') {
        exportCtx.font = `bold ${element.fontSize * exportScale}px Arial`;
        exportCtx.fillText(
          element.text,
          element.position.x * exportScale,
          element.position.y * exportScale
        );
      }
    });

    // Convert to blob and save
    exportCanvas.toBlob((blob) => {
      if (blob) {
        onSave(blob);
      }
    }, 'image/jpeg', 0.9);
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 p-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Annotate Image</h2>
        <div className="flex gap-2">
          <button
            onClick={handleUndo}
            disabled={elements.length === 0}
            className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded text-sm transition-colors"
          >
            ↩ Undo
          </button>
          <button
            onClick={handleClear}
            disabled={elements.length === 0}
            className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded text-sm transition-colors"
          >
            Clear All
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white rounded text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded text-sm font-medium transition-colors"
          >
            Save Annotation
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-gray-700 p-2 flex items-center gap-4 flex-wrap">
        {/* Tools */}
        <div className="flex gap-1">
          {[
            { value: 'pen', label: '✏️', title: 'Freehand' },
            { value: 'rectangle', label: '⬜', title: 'Rectangle' },
            { value: 'circle', label: '⭕', title: 'Circle' },
            { value: 'arrow', label: '➡️', title: 'Arrow' },
            { value: 'text', label: 'T', title: 'Text' },
          ].map((t) => (
            <button
              key={t.value}
              onClick={() => setTool(t.value as typeof tool)}
              title={t.title}
              className={`w-9 h-9 flex items-center justify-center rounded text-lg transition-colors ${
                tool === t.value
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-600 text-gray-200 hover:bg-gray-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-gray-500" />

        {/* Colors */}
        <div className="flex gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-7 h-7 rounded-full border-2 transition-transform ${
                color === c ? 'border-white scale-110' : 'border-transparent'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-gray-500" />

        {/* Line Width */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Size:</span>
          <div className="flex gap-1">
            {LINE_WIDTHS.map((w) => (
              <button
                key={w}
                onClick={() => setLineWidth(w)}
                className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                  lineWidth === w
                    ? 'bg-orange-600'
                    : 'bg-gray-600 hover:bg-gray-500'
                }`}
              >
                <div
                  className="rounded-full bg-white"
                  style={{ width: w + 4, height: w + 4 }}
                />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Canvas Area */}
      <div ref={containerRef} className="flex-1 flex items-center justify-center p-4 overflow-auto">
        {image ? (
          <canvas
            ref={canvasRef}
            width={canvasSize.width}
            height={canvasSize.height}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className="border border-gray-600 cursor-crosshair"
            style={{ maxWidth: '100%', maxHeight: '100%' }}
          />
        ) : (
          <div className="text-gray-400">Loading image...</div>
        )}
      </div>

      {/* Text Input Modal */}
      {textPosition && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="bg-gray-800 p-4 rounded-lg shadow-xl">
            <h3 className="text-white font-medium mb-2">Add Text</h3>
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Enter text..."
              autoFocus
              className="w-64 bg-gray-700 text-white px-3 py-2 rounded border-0 focus:ring-2 focus:ring-orange-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddText();
                if (e.key === 'Escape') setTextPosition(null);
              }}
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleAddText}
                className="flex-1 bg-green-600 hover:bg-green-500 text-white py-1.5 rounded text-sm transition-colors"
              >
                Add
              </button>
              <button
                onClick={() => setTextPosition(null)}
                className="flex-1 bg-gray-600 hover:bg-gray-500 text-white py-1.5 rounded text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

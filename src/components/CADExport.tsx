'use client';

import React, { useRef, useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';

// Unit conversion helpers
const METERS_TO_FEET = 3.28084;
const metersToInches = (meters: number): number => meters * METERS_TO_FEET * 12;

// Format dimension for CAD drawing
const formatDimension = (meters: number): string => {
  const totalInches = Math.round(meters * METERS_TO_FEET * 12);
  if (totalInches >= 48) {
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    if (inches === 0) {
      return `${feet}'-0"`;
    }
    return `${feet}'-${inches}"`;
  }
  return `${totalInches}"`;
};

// Format with both notations for large dimensions
const formatDimensionFull = (meters: number): string => {
  const totalInches = Math.round(meters * METERS_TO_FEET * 12);
  if (totalInches >= 48) {
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    if (inches === 0) {
      return `${feet}'-0" [${totalInches}"]`;
    }
    return `${feet}'-${inches}" [${totalInches}"]`;
  }
  return `${totalInches}"`;
};

interface Config {
  bays: number;
  levels: number;
  bayWidth: number;
  bayDepth: number;
  levelHeight: number;
  uprightHeight: number;
  floorPositions: number[];
  beamPositions: number[][];
  beamColor: string;
  frameColor: string;
}

interface Rack {
  id: string;
  name: string;
  position: { x: number; z: number };
  rotation: number;
  config: Config;
}

interface WarehouseConfig {
  name: string;
  width: number;
  depth: number;
}

interface CADExportProps {
  racks: Rack[];
  warehouseConfig: WarehouseConfig;
  onClose: () => void;
}

// CAD Colors (AutoCAD dark theme style)
const CAD_COLORS = {
  background: '#0a0a0a',
  grid: '#1a1a1a',
  frame: '#0066ff',      // Blue for uprights/frame
  beam: '#ff6600',       // Orange for beams
  dimension: '#ff0000',  // Red for dimensions
  text: '#ff0000',       // Red for text
  white: '#ffffff',
};

export default function CADExport({ racks, warehouseConfig, onClose }: CADExportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewType, setViewType] = useState<'floor' | 'front' | 'side'>('floor');
  const [selectedRackId, setSelectedRackId] = useState<string>(racks[0]?.id || '');
  const [scale, setScale] = useState(10); // pixels per inch

  const selectedRack = racks.find(r => r.id === selectedRackId) || racks[0];

  // Helper to draw dimension line with ticks and text
  const drawDimensionLine = (
    ctx: CanvasRenderingContext2D,
    x1: number, y1: number,
    x2: number, y2: number,
    text: string,
    offset: number = 0,
    side: 'top' | 'bottom' | 'left' | 'right' = 'top'
  ) => {
    ctx.strokeStyle = CAD_COLORS.dimension;
    ctx.fillStyle = CAD_COLORS.dimension;
    ctx.lineWidth = 1;
    ctx.font = '11px monospace';

    const tickSize = 6;
    let dimX1 = x1, dimY1 = y1, dimX2 = x2, dimY2 = y2;
    let textX = (x1 + x2) / 2;
    let textY = (y1 + y2) / 2;

    if (side === 'top') {
      dimY1 = y1 - offset;
      dimY2 = y2 - offset;
      textY = dimY1 - 8;
      // Extension lines
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1, dimY1);
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2, dimY2);
      ctx.stroke();
    } else if (side === 'bottom') {
      dimY1 = y1 + offset;
      dimY2 = y2 + offset;
      textY = dimY1 + 15;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1, dimY1);
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2, dimY2);
      ctx.stroke();
    } else if (side === 'left') {
      dimX1 = x1 - offset;
      dimX2 = x2 - offset;
      textX = dimX1 - 8;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(dimX1, y1);
      ctx.moveTo(x2, y2);
      ctx.lineTo(dimX2, y2);
      ctx.stroke();
    } else if (side === 'right') {
      dimX1 = x1 + offset;
      dimX2 = x2 + offset;
      textX = dimX1 + 8;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(dimX1, y1);
      ctx.moveTo(x2, y2);
      ctx.lineTo(dimX2, y2);
      ctx.stroke();
    }

    // Dimension line
    ctx.beginPath();
    ctx.moveTo(dimX1, dimY1);
    ctx.lineTo(dimX2, dimY2);
    ctx.stroke();

    // Tick marks
    const isHorizontal = Math.abs(dimY2 - dimY1) < Math.abs(dimX2 - dimX1);
    ctx.beginPath();
    if (isHorizontal) {
      ctx.moveTo(dimX1, dimY1 - tickSize / 2);
      ctx.lineTo(dimX1, dimY1 + tickSize / 2);
      ctx.moveTo(dimX2, dimY2 - tickSize / 2);
      ctx.lineTo(dimX2, dimY2 + tickSize / 2);
    } else {
      ctx.moveTo(dimX1 - tickSize / 2, dimY1);
      ctx.lineTo(dimX1 + tickSize / 2, dimY1);
      ctx.moveTo(dimX2 - tickSize / 2, dimY2);
      ctx.lineTo(dimX2 + tickSize / 2, dimY2);
    }
    ctx.stroke();

    // Text
    ctx.save();
    if (!isHorizontal && (side === 'left' || side === 'right')) {
      ctx.translate(textX, textY);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(text, 0, side === 'left' ? -3 : 12);
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(text, textX, textY);
    }
    ctx.restore();
  };

  // Draw floor plan (top view)
  const drawFloorPlan = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const padding = 100;
    const drawWidth = width - padding * 2;
    const drawHeight = height - padding * 2;

    // Calculate bounds for all racks
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

    // Store rack bounds for dimension drawing
    const rackBounds: Array<{
      rack: Rack;
      corners: Array<{x: number, z: number}>;
      worldMinX: number;
      worldMaxX: number;
      worldMinZ: number;
      worldMaxZ: number;
    }> = [];

    racks.forEach(rack => {
      const rackWidth = rack.config.bays * rack.config.bayWidth;
      const rackDepth = rack.config.bayDepth;
      const cos = Math.cos(rack.rotation);
      const sin = Math.sin(rack.rotation);

      const localCorners = [
        { x: 0, z: 0 },
        { x: rackWidth, z: 0 },
        { x: rackWidth, z: rackDepth },
        { x: 0, z: rackDepth },
      ];

      const worldCorners = localCorners.map(corner => ({
        x: corner.x * cos - corner.z * sin + rack.position.x,
        z: corner.x * sin + corner.z * cos + rack.position.z,
      }));

      let rMinX = Infinity, rMaxX = -Infinity, rMinZ = Infinity, rMaxZ = -Infinity;
      worldCorners.forEach(c => {
        minX = Math.min(minX, c.x);
        maxX = Math.max(maxX, c.x);
        minZ = Math.min(minZ, c.z);
        maxZ = Math.max(maxZ, c.z);
        rMinX = Math.min(rMinX, c.x);
        rMaxX = Math.max(rMaxX, c.x);
        rMinZ = Math.min(rMinZ, c.z);
        rMaxZ = Math.max(rMaxZ, c.z);
      });

      rackBounds.push({
        rack,
        corners: worldCorners,
        worldMinX: rMinX,
        worldMaxX: rMaxX,
        worldMinZ: rMinZ,
        worldMaxZ: rMaxZ,
      });
    });

    // Add margin for dimensions
    const margin = 3;
    minX -= margin;
    maxX += margin;
    minZ -= margin;
    maxZ += margin;

    const sceneWidth = maxX - minX;
    const sceneDepth = maxZ - minZ;
    const scaleX = drawWidth / sceneWidth;
    const scaleZ = drawHeight / sceneDepth;
    const drawScale = Math.min(scaleX, scaleZ);

    const offsetX = padding + (drawWidth - sceneWidth * drawScale) / 2;
    const offsetZ = padding + (drawHeight - sceneDepth * drawScale) / 2;

    const toCanvasX = (x: number) => offsetX + (x - minX) * drawScale;
    const toCanvasZ = (z: number) => offsetZ + (z - minZ) * drawScale;

    // Draw grid
    ctx.strokeStyle = CAD_COLORS.grid;
    ctx.lineWidth = 0.5;
    const gridSize = 1;
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(toCanvasX(x), toCanvasZ(minZ));
      ctx.lineTo(toCanvasX(x), toCanvasZ(maxZ));
      ctx.stroke();
    }
    for (let z = Math.floor(minZ); z <= Math.ceil(maxZ); z += gridSize) {
      ctx.beginPath();
      ctx.moveTo(toCanvasX(minX), toCanvasZ(z));
      ctx.lineTo(toCanvasX(maxX), toCanvasZ(z));
      ctx.stroke();
    }

    // Draw each rack
    racks.forEach(rack => {
      const { bays, bayWidth, bayDepth } = rack.config;
      const rackWidth = bays * bayWidth;

      ctx.save();
      ctx.translate(toCanvasX(rack.position.x), toCanvasZ(rack.position.z));
      ctx.rotate(rack.rotation);

      const rackScaleX = drawScale;
      const rackScaleZ = drawScale;

      // Draw frame outline (blue)
      ctx.strokeStyle = CAD_COLORS.frame;
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, rackWidth * rackScaleX, bayDepth * rackScaleZ);

      // Draw bay dividers (blue uprights)
      for (let i = 1; i < bays; i++) {
        const x = i * bayWidth * rackScaleX;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, bayDepth * rackScaleZ);
        ctx.stroke();
      }

      // Draw beams (orange)
      ctx.strokeStyle = CAD_COLORS.beam;
      ctx.lineWidth = 3;
      const beamOffset = bayDepth * 0.15 * rackScaleZ;

      ctx.beginPath();
      ctx.moveTo(0, beamOffset);
      ctx.lineTo(rackWidth * rackScaleX, beamOffset);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, bayDepth * rackScaleZ - beamOffset);
      ctx.lineTo(rackWidth * rackScaleX, bayDepth * rackScaleZ - beamOffset);
      ctx.stroke();

      // Draw rack name (white for visibility)
      ctx.fillStyle = CAD_COLORS.white;
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(rack.name, (rackWidth * rackScaleX) / 2, (bayDepth * rackScaleZ) / 2);

      ctx.restore();
    });

    // Draw dimensions for each rack
    rackBounds.forEach((rb, index) => {
      const { rack, worldMinX, worldMaxX, worldMinZ, worldMaxZ } = rb;
      const rackWidth = rack.config.bays * rack.config.bayWidth;
      const rackDepth = rack.config.bayDepth;

      // Determine if rack is mostly horizontal or vertical (based on rotation)
      const isHorizontal = Math.abs(Math.cos(rack.rotation)) > 0.7;

      // Width dimension (top of rack)
      const widthDimOffset = 25 + (index % 2) * 15; // Stagger dimensions
      drawDimensionLine(
        ctx,
        toCanvasX(worldMinX), toCanvasZ(worldMinZ),
        toCanvasX(worldMaxX), toCanvasZ(worldMinZ),
        formatDimension(rackWidth),
        widthDimOffset,
        'top'
      );

      // Depth dimension (right side of rack)
      const depthDimOffset = 25 + (index % 2) * 15;
      drawDimensionLine(
        ctx,
        toCanvasX(worldMaxX), toCanvasZ(worldMinZ),
        toCanvasX(worldMaxX), toCanvasZ(worldMaxZ),
        formatDimension(rackDepth),
        depthDimOffset,
        'right'
      );
    });

    // Draw overall scene dimensions
    const totalWidth = maxX - minX - margin * 2;
    const totalDepth = maxZ - minZ - margin * 2;

    // Bottom overall dimension
    drawDimensionLine(
      ctx,
      toCanvasX(minX + margin), toCanvasZ(maxZ - margin),
      toCanvasX(maxX - margin), toCanvasZ(maxZ - margin),
      formatDimensionFull(totalWidth),
      50,
      'bottom'
    );

    // Left overall dimension
    drawDimensionLine(
      ctx,
      toCanvasX(minX + margin), toCanvasZ(minZ + margin),
      toCanvasX(minX + margin), toCanvasZ(maxZ - margin),
      formatDimensionFull(totalDepth),
      50,
      'left'
    );

    // Title
    ctx.fillStyle = CAD_COLORS.white;
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(warehouseConfig.name.toUpperCase(), 20, 20);
    ctx.font = '12px monospace';
    ctx.fillText('FLOOR PLAN - TOP VIEW', 20, 42);
    ctx.fillText(`Scale: 1 grid = 1m (${formatDimension(1)})`, 20, 58);
  };

  // Draw front elevation view
  const drawFrontView = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    if (!selectedRack) return;

    const padding = 100;
    const drawWidth = width - padding * 2;
    const drawHeight = height - padding * 2;

    const { bays, bayWidth, bayDepth, uprightHeight, beamPositions, floorPositions } = selectedRack.config;
    const rackWidth = bays * bayWidth;
    const rackHeight = uprightHeight;

    // Calculate scale
    const scaleX = drawWidth / rackWidth;
    const scaleY = drawHeight / rackHeight;
    const drawScale = Math.min(scaleX, scaleY) * 0.8;

    const offsetX = padding + (drawWidth - rackWidth * drawScale) / 2;
    const offsetY = padding + drawHeight - 20; // Bottom aligned

    const toCanvasX = (x: number) => offsetX + x * drawScale;
    const toCanvasY = (y: number) => offsetY - y * drawScale;

    // Upright dimensions
    const uprightWidth = 0.1 * drawScale;
    const beamHeight = 0.08 * drawScale;

    // Draw uprights (blue)
    ctx.fillStyle = CAD_COLORS.frame;
    ctx.strokeStyle = CAD_COLORS.frame;
    ctx.lineWidth = 2;

    for (let i = 0; i <= bays; i++) {
      const x = toCanvasX(i * bayWidth);
      ctx.fillRect(x - uprightWidth / 2, toCanvasY(rackHeight), uprightWidth, rackHeight * drawScale);
    }

    // Draw beams (orange)
    ctx.fillStyle = CAD_COLORS.beam;
    const positions = beamPositions || [];

    // Draw beams for each level (use bay 0 positions as reference for front view)
    const bayPositions = positions[0] || [];
    bayPositions.forEach((beamY: number) => {
      for (let bay = 0; bay < bays; bay++) {
        const x1 = toCanvasX(bay * bayWidth) + uprightWidth / 2;
        const x2 = toCanvasX((bay + 1) * bayWidth) - uprightWidth / 2;
        const y = toCanvasY(beamY);
        ctx.fillRect(x1, y - beamHeight / 2, x2 - x1, beamHeight);
      }
    });

    // Draw pallet labels in each bay
    ctx.fillStyle = CAD_COLORS.white;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';

    const floorPos = floorPositions?.[0] || 0;
    const firstBeamY = bayPositions[0] || 1.5;
    const openingHeight = firstBeamY - floorPos;

    for (let bay = 0; bay < bays; bay++) {
      const centerX = toCanvasX(bay * bayWidth + bayWidth / 2);
      const centerY = toCanvasY(floorPos + openingHeight / 2);

      ctx.fillText('PALLET SIZE', centerX, centerY - 15);
      ctx.fillText(`${Math.round(metersToInches(bayWidth * 0.85))}" x 48" x 48"`, centerX, centerY);
      ctx.fillText('1000# MAX', centerX, centerY + 15);
    }

    // Draw dimensions (red)
    ctx.strokeStyle = CAD_COLORS.dimension;
    ctx.fillStyle = CAD_COLORS.dimension;
    ctx.lineWidth = 1;
    ctx.font = '12px monospace';

    // Total width dimension (top)
    const dimY = toCanvasY(rackHeight) - 30;
    ctx.beginPath();
    ctx.moveTo(toCanvasX(0), dimY);
    ctx.lineTo(toCanvasX(rackWidth), dimY);
    ctx.stroke();

    // Tick marks
    ctx.beginPath();
    ctx.moveTo(toCanvasX(0), dimY - 5);
    ctx.lineTo(toCanvasX(0), dimY + 5);
    ctx.moveTo(toCanvasX(rackWidth), dimY - 5);
    ctx.lineTo(toCanvasX(rackWidth), dimY + 5);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillText(formatDimension(rackWidth), toCanvasX(rackWidth / 2), dimY - 10);

    // Height dimensions (right side)
    const dimX = toCanvasX(rackWidth) + 40;

    // Draw opening heights
    let prevY = floorPos;
    bayPositions.forEach((beamY: number, i: number) => {
      const openingH = beamY - prevY;
      const midY = toCanvasY((prevY + beamY) / 2);

      // Dimension line
      ctx.beginPath();
      ctx.moveTo(dimX, toCanvasY(prevY));
      ctx.lineTo(dimX, toCanvasY(beamY));
      ctx.stroke();

      // Tick marks
      ctx.beginPath();
      ctx.moveTo(dimX - 5, toCanvasY(prevY));
      ctx.lineTo(dimX + 5, toCanvasY(prevY));
      ctx.moveTo(dimX - 5, toCanvasY(beamY));
      ctx.lineTo(dimX + 5, toCanvasY(beamY));
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillText(formatDimension(openingH), dimX + 10, midY + 4);

      prevY = beamY;
    });

    // Floor to first beam label
    if (bayPositions.length > 0) {
      const firstOpening = bayPositions[0] - floorPos;
      ctx.textAlign = 'center';
      ctx.fillText(formatDimension(firstOpening), toCanvasX(rackWidth / 2), toCanvasY(0) + 20);
    }

    // Total width in feet-inches notation
    ctx.textAlign = 'center';
    ctx.font = '14px monospace';
    ctx.fillText(formatDimensionFull(rackWidth), toCanvasX(rackWidth / 2), toCanvasY(0) + 40);

    // Title
    ctx.fillStyle = CAD_COLORS.white;
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(selectedRack.name.toUpperCase(), 20, 30);
    ctx.font = '12px monospace';
    ctx.fillText('FRONT ELEVATION VIEW', 20, 50);
  };

  // Draw side elevation view
  const drawSideView = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    if (!selectedRack) return;

    const padding = 100;
    const drawWidth = width - padding * 2;
    const drawHeight = height - padding * 2;

    const { bayDepth, uprightHeight, beamPositions, floorPositions } = selectedRack.config;
    const rackDepth = bayDepth;
    const rackHeight = uprightHeight;

    // Calculate scale
    const scaleX = drawWidth / rackDepth;
    const scaleY = drawHeight / rackHeight;
    const drawScale = Math.min(scaleX, scaleY) * 0.7;

    const offsetX = padding + (drawWidth - rackDepth * drawScale) / 2;
    const offsetY = padding + drawHeight - 20;

    const toCanvasX = (x: number) => offsetX + x * drawScale;
    const toCanvasY = (y: number) => offsetY - y * drawScale;

    const uprightWidth = 0.1 * drawScale;

    // Draw uprights (blue)
    ctx.fillStyle = CAD_COLORS.frame;
    ctx.fillRect(toCanvasX(0) - uprightWidth / 2, toCanvasY(rackHeight), uprightWidth, rackHeight * drawScale);
    ctx.fillRect(toCanvasX(rackDepth) - uprightWidth / 2, toCanvasY(rackHeight), uprightWidth, rackHeight * drawScale);

    // Draw X-bracing (blue)
    ctx.strokeStyle = CAD_COLORS.frame;
    ctx.lineWidth = 2;

    const positions = beamPositions?.[0] || [];
    let prevY = floorPositions?.[0] || 0;

    positions.forEach((beamY: number) => {
      // X-brace in each section
      ctx.beginPath();
      ctx.moveTo(toCanvasX(0), toCanvasY(prevY));
      ctx.lineTo(toCanvasX(rackDepth), toCanvasY(beamY));
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(toCanvasX(rackDepth), toCanvasY(prevY));
      ctx.lineTo(toCanvasX(0), toCanvasY(beamY));
      ctx.stroke();

      prevY = beamY;
    });

    // Draw beam connectors (orange squares at beam positions)
    ctx.fillStyle = CAD_COLORS.beam;
    const connectorSize = 8;
    positions.forEach((beamY: number) => {
      ctx.fillRect(toCanvasX(0) - connectorSize / 2, toCanvasY(beamY) - connectorSize / 2, connectorSize, connectorSize);
      ctx.fillRect(toCanvasX(rackDepth) - connectorSize / 2, toCanvasY(beamY) - connectorSize / 2, connectorSize, connectorSize);
    });

    // Draw dimensions (red)
    ctx.strokeStyle = CAD_COLORS.dimension;
    ctx.fillStyle = CAD_COLORS.dimension;
    ctx.lineWidth = 1;
    ctx.font = '12px monospace';

    // Depth dimension (top)
    const dimY = toCanvasY(rackHeight) - 30;
    ctx.beginPath();
    ctx.moveTo(toCanvasX(0), dimY);
    ctx.lineTo(toCanvasX(rackDepth), dimY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(toCanvasX(0), dimY - 5);
    ctx.lineTo(toCanvasX(0), dimY + 5);
    ctx.moveTo(toCanvasX(rackDepth), dimY - 5);
    ctx.lineTo(toCanvasX(rackDepth), dimY + 5);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillText(formatDimension(rackDepth), toCanvasX(rackDepth / 2), dimY - 10);

    // Height dimension (right)
    const dimX = toCanvasX(rackDepth) + 40;
    ctx.beginPath();
    ctx.moveTo(dimX, toCanvasY(0));
    ctx.lineTo(dimX, toCanvasY(rackHeight));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(dimX - 5, toCanvasY(0));
    ctx.lineTo(dimX + 5, toCanvasY(0));
    ctx.moveTo(dimX - 5, toCanvasY(rackHeight));
    ctx.lineTo(dimX + 5, toCanvasY(rackHeight));
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillText(formatDimension(rackHeight), dimX + 10, toCanvasY(rackHeight / 2) + 4);

    // Title
    ctx.fillStyle = CAD_COLORS.white;
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(selectedRack.name.toUpperCase(), 20, 30);
    ctx.font = '12px monospace';
    ctx.fillText('SIDE ELEVATION VIEW', 20, 50);
  };

  // Main drawing function
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = 1200;
    canvas.height = 800;

    // Clear and set background
    ctx.fillStyle = CAD_COLORS.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw based on view type
    if (viewType === 'floor') {
      drawFloorPlan(ctx, canvas.width, canvas.height);
    } else if (viewType === 'front') {
      drawFrontView(ctx, canvas.width, canvas.height);
    } else if (viewType === 'side') {
      drawSideView(ctx, canvas.width, canvas.height);
    }
  }, [racks, warehouseConfig, viewType, selectedRackId, selectedRack]);

  // Export functions
  const exportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `${warehouseConfig.name.replace(/\s+/g, '_')}_${viewType}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const exportSVG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create SVG from canvas content
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', canvas.width.toString());
    svg.setAttribute('height', canvas.height.toString());
    svg.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);

    // Add background
    const bg = document.createElementNS(svgNS, 'rect');
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
    bg.setAttribute('fill', CAD_COLORS.background);
    svg.appendChild(bg);

    // Embed canvas as image (simplified approach)
    const img = document.createElementNS(svgNS, 'image');
    img.setAttribute('href', canvas.toDataURL('image/png'));
    img.setAttribute('width', canvas.width.toString());
    img.setAttribute('height', canvas.height.toString());
    svg.appendChild(img);

    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const link = document.createElement('a');
    link.download = `${warehouseConfig.name.replace(/\s+/g, '_')}_${viewType}.svg`;
    link.href = URL.createObjectURL(blob);
    link.click();
  };

  const exportPDF = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'px',
      format: [canvas.width, canvas.height],
    });

    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
    pdf.save(`${warehouseConfig.name.replace(/\s+/g, '_')}_${viewType}.pdf`);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg shadow-2xl max-w-[1300px] w-full max-h-[95vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">CAD Export</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl"
          >
            &times;
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4 p-4 border-b border-gray-700">
          {/* View Type */}
          <div className="flex gap-2">
            <button
              onClick={() => setViewType('floor')}
              className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                viewType === 'floor'
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Floor Plan
            </button>
            <button
              onClick={() => setViewType('front')}
              className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                viewType === 'front'
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Front View
            </button>
            <button
              onClick={() => setViewType('side')}
              className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                viewType === 'side'
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Side View
            </button>
          </div>

          {/* Rack Selector (for front/side views) */}
          {(viewType === 'front' || viewType === 'side') && (
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-sm">Rack:</span>
              <select
                value={selectedRackId}
                onChange={(e) => setSelectedRackId(e.target.value)}
                className="bg-gray-700 text-white px-3 py-2 rounded text-sm"
              >
                {racks.map(rack => (
                  <option key={rack.id} value={rack.id}>{rack.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Export Buttons */}
          <div className="flex gap-2 ml-auto">
            <button
              onClick={exportPNG}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors"
            >
              Export PNG
            </button>
            <button
              onClick={exportSVG}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded text-sm font-medium transition-colors"
            >
              Export SVG
            </button>
            <button
              onClick={exportPDF}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm font-medium transition-colors"
            >
              Export PDF
            </button>
          </div>
        </div>

        {/* Canvas Preview */}
        <div className="p-4 overflow-auto" style={{ maxHeight: 'calc(95vh - 140px)' }}>
          <canvas
            ref={canvasRef}
            className="border border-gray-700 rounded"
            style={{ maxWidth: '100%', height: 'auto' }}
          />
        </div>
      </div>
    </div>
  );
}

import { distanceAtRow, rowAtDistance, ppfAtDistance, distanceAtPpf, PPF_ZONES, fovBounds, vFovBounds } from './perspective.js';

function fmtDist(ft, unit) {
    if (unit === 'm') {
        const m = ft / 3.281;
        return m < 10 ? `${m.toFixed(1)} m` : `${Math.round(m)} m`;
    }
    return `${ft} ft`;
}

/**
 * Draw the photo on the background canvas, scaled to fit.
 * If cameras have wider FOV than the phone, expand the canvas to show the full FOV.
 */
export function drawPhoto(bgCanvas, image, containerW, containerH, cameras, phoneHFov, renderScale) {
    renderScale = renderScale || 1;

    // Base scale: fit photo in container
    const baseScale = Math.min(containerW / image.naturalWidth, containerH / image.naturalHeight, 1);

    const photoW = Math.round(image.naturalWidth * baseScale);
    const photoH = Math.round(image.naturalHeight * baseScale);

    // Always provide 360° horizontal space and generous vertical space.
    // The photo covers phoneHFov degrees horizontally; 360° needs (360/phoneHFov) × photoW.
    // Vertically, add equal padding above and below for tilted camera views.
    const hExpand = (phoneHFov && phoneHFov > 0) ? 360 / phoneHFov : 3;
    const vExpand = 3; // 3x vertical — 1x above, 1x photo, 1x below

    const canvasW = Math.round(photoW * hExpand);
    const canvasH = Math.round(photoH * vExpand);
    const photoOffsetX = Math.round((canvasW - photoW) / 2);
    const photoOffsetY = Math.round((canvasH - photoH) / 2);

    // High-res backing store: multiply by renderScale for crisp rendering when zoomed
    bgCanvas.width = Math.round(canvasW * renderScale);
    bgCanvas.height = Math.round(canvasH * renderScale);
    bgCanvas.style.width = canvasW + 'px';
    bgCanvas.style.height = canvasH + 'px';
    const ctx = bgCanvas.getContext('2d');
    ctx.scale(renderScale, renderScale);

    // Fill entire canvas with dark background
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Draw subtle hatching in the expanded area (outside the photo)
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const spacing = 16;
    for (let i = -canvasH; i < canvasW + canvasH; i += spacing) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + canvasH, canvasH);
        ctx.stroke();
    }
    // Clear hatching from the photo area
    ctx.clearRect(photoOffsetX, photoOffsetY, photoW, photoH);
    ctx.restore();

    // Border around photo area
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(photoOffsetX, photoOffsetY, photoW, photoH);
    ctx.setLineDash([]);

    // Draw the photo
    ctx.drawImage(image, photoOffsetX, photoOffsetY, photoW, photoH);

    return { scale: baseScale, width: canvasW, height: canvasH, photoW, photoH, photoOffsetX, photoOffsetY, expandRatio: hExpand, renderScale };
}

/**
 * Main overlay render function.
 */
export function renderOverlay(overlayCanvas, state) {
    const { photoLayout, calibration, cameras, phoneHFov, displayOptions, photoRotation, cameraHeightUnit } = state;
    const unit = cameraHeightUnit || 'ft';
    if (!photoLayout) return;

    const { scale, width, height, photoW, photoH, photoOffsetX, photoOffsetY, renderScale: rs } = photoLayout;
    const renderScale = rs || 1;
    const oY = photoOffsetY || 0; // vertical offset for the photo in the canvas
    overlayCanvas.width = Math.round(width * renderScale);
    overlayCanvas.height = Math.round(height * renderScale);
    overlayCanvas.style.width = width + 'px';
    overlayCanvas.style.height = height + 'px';
    const ctx = overlayCanvas.getContext('2d');
    ctx.scale(renderScale, renderScale);
    ctx.clearRect(0, 0, width, height);

    // Counter-rotation angle: negate the CSS rotation so drawn lines appear level
    const rotRad = -(photoRotation || 0) * Math.PI / 180;

    const activeCameras = cameras.filter(c => c.visible);

    // Draw calibration markers
    drawCalibrationMarkers(ctx, state.markers, scale, width, height, calibration, photoOffsetX, photoW, rotRad, phoneHFov, oY, unit);

    // Draw pending between-marker first point
    if (state.pendingMarker && state.pendingMarker.y1 !== undefined && state.mode === 'placing-between-2') {
        const px = state.pendingMarker.x1 * scale + photoOffsetX;
        const py = state.pendingMarker.y1 * scale + oY;
        drawRotatedHLine(ctx, photoOffsetX, photoOffsetX + photoW, py, width, height, rotRad, 'rgba(59, 130, 246, 0.5)', 1.5, [3, 3]);

        const cx2 = width / 2, cy2 = height / 2;
        ctx.save();
        ctx.translate(cx2, cy2);
        ctx.rotate(rotRad);
        ctx.translate(-cx2, -cy2);
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '12px -apple-system, sans-serif';
        ctx.fillStyle = '#3b82f6';
        ctx.fillText('Click second point...', px + 10, py - 10);
        ctx.restore();
    }

    // Draw line between both pending between-points while modal is open
    if (state.pendingMarker && state.pendingMarker.x2 !== undefined) {
        const x1c = state.pendingMarker.x1 * scale + photoOffsetX;
        const y1c = state.pendingMarker.y1 * scale + oY;
        const x2c = state.pendingMarker.x2 * scale + photoOffsetX;
        const y2c = state.pendingMarker.y2 * scale + oY;
        const cx2 = width / 2, cy2 = height / 2;

        ctx.save();
        ctx.translate(cx2, cy2);
        ctx.rotate(rotRad);
        ctx.translate(-cx2, -cy2);

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.moveTo(x1c, y1c);
        ctx.lineTo(x2c, y2c);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#3b82f6';
        for (const [px, py] of [[x1c, y1c], [x2c, y2c]]) {
            ctx.beginPath();
            ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // Draw pending horizon point
    if (state.pendingHorizon && state.mode === 'picking-horizon-2') {
        const p = state.pendingHorizon;
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(p.x1 * scale + photoOffsetX, p.y1 * scale + oY, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '11px -apple-system, sans-serif';
        ctx.fillText('Click second horizon point...', p.x1 * scale + photoOffsetX + 10, p.y1 * scale + oY - 8);
    }

    if (calibration && activeCameras.length > 0) {
        if (displayOptions.showPpf) {
            drawPpfZones(ctx, activeCameras, calibration, scale, width, height, phoneHFov, photoOffsetX, photoW, rotRad, oY, displayOptions.showPpfLabels ?? true, unit);
        }
        if (displayOptions.showFov) {
            drawFovBounds(ctx, activeCameras, phoneHFov, width, height, photoOffsetX, photoW, photoH || height, rotRad, oY);
        }
        if (displayOptions.showRuler) {
            drawDistanceRuler(ctx, calibration, scale, width, height, photoOffsetX, photoW, rotRad, phoneHFov, oY, unit);
        }
    }

    // Draw drag hint
    if (activeCameras.length > 0) {
        ctx.font = '10px -apple-system, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.textAlign = 'center';
        ctx.fillText('Drag to aim camera (left/right = pan, up/down = tilt)', width / 2, height - 6);
        ctx.textAlign = 'left';
    }
}

function drawCalibrationMarkers(ctx, markers, scale, canvasW, canvasH, calibration, photoOffsetX, photoW, rotRad, phoneHFov, oY, unit = 'ft') {
    const lineLeft = photoOffsetX;
    const lineRight = photoOffsetX + photoW;
    const cx = canvasW / 2;
    const cy = canvasH / 2;

    for (const marker of markers) {
        if (marker.type === 'single') {
            const y = marker.y * scale + oY;
            const curveDist = marker.effectiveDistFt || marker.groundDistFt;

            if (calibration && phoneHFov) {
                const pts = distanceCurvePoints(curveDist, lineLeft, lineRight, calibration, phoneHFov, photoW, photoOffsetX, scale, oY);
                strokeDistanceCurve(ctx, pts, canvasW, canvasH, rotRad, 'rgba(255,255,255,0.6)', 1.5, [6, 4]);

                const edgePt = curveEdgePoint(curveDist, calibration, phoneHFov, photoW, photoOffsetX, scale, canvasH, oY);
                let label = fmtDist(marker.groundDistFt, unit);
                if (marker.elevChangeFt) label += ` (${marker.elevChangeFt > 0 ? '↓' : '↑'}${fmtDist(Math.abs(marker.elevChangeFt), unit)})`;
                if (edgePt.y >= canvasH - 1) {
                    drawRotatedLabel(ctx, label, edgePt.x + 4, edgePt.y - 18, cx, cy, rotRad);
                } else {
                    drawRotatedLabel(ctx, label, edgePt.x + 4, edgePt.y - 5, cx, cy, rotRad);
                }
            } else {
                drawRotatedHLine(ctx, lineLeft, lineRight, y, canvasW, canvasH, rotRad, 'rgba(255,255,255,0.6)', 1.5, [6, 4]);
                let label = fmtDist(marker.groundDistFt, unit);
                if (marker.elevChangeFt) label += ` (${marker.elevChangeFt > 0 ? '↓' : '↑'}${fmtDist(Math.abs(marker.elevChangeFt), unit)})`;
                drawRotatedLabel(ctx, label, lineLeft + 12, y - 5, cx, cy, rotRad);
            }
        } else if (marker.type === 'between') {
            const y1 = marker.y1 * scale + oY;
            const y2 = marker.y2 * scale + oY;

            // Compute distances at each point from the calibration to draw curves
            if (calibration && phoneHFov) {
                const d1 = distanceAtRow(marker.y1, calibration);
                const d2 = distanceAtRow(marker.y2, calibration);
                let edge1 = null, edge2 = null;

                if (isFinite(d1) && d1 > 0) {
                    const pts1 = distanceCurvePoints(d1, lineLeft, lineRight, calibration, phoneHFov, photoW, photoOffsetX, scale, oY);
                    strokeDistanceCurve(ctx, pts1, canvasW, canvasH, rotRad, 'rgba(255,255,255,0.5)', 1.5, [6, 4]);
                    edge1 = curveEdgePoint(d1, calibration, phoneHFov, photoW, photoOffsetX, scale, canvasH, oY);
                }
                if (isFinite(d2) && d2 > 0) {
                    const pts2 = distanceCurvePoints(d2, lineLeft, lineRight, calibration, phoneHFov, photoW, photoOffsetX, scale, oY);
                    strokeDistanceCurve(ctx, pts2, canvasW, canvasH, rotRad, 'rgba(255,255,255,0.5)', 1.5, [6, 4]);
                    edge2 = curveEdgePoint(d2, calibration, phoneHFov, photoW, photoOffsetX, scale, canvasH, oY);
                }

                // Bracket and label positioned at curve edge points
                if (edge1 && edge2) {
                    ctx.save();
                    ctx.translate(cx, cy);
                    ctx.rotate(rotRad);
                    ctx.translate(-cx, -cy);
                    ctx.beginPath();
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                    ctx.lineWidth = 1;
                    ctx.moveTo(edge1.x + 16, edge1.y);
                    ctx.lineTo(edge1.x + 8, edge1.y);
                    ctx.lineTo(edge2.x + 8, edge2.y);
                    ctx.lineTo(edge2.x + 16, edge2.y);
                    ctx.stroke();
                    ctx.restore();

                    const midX = (edge1.x + edge2.x) / 2 + 20;
                    const midY = (edge1.y + edge2.y) / 2;
                    drawRotatedLabel(ctx, `↕ ${fmtDist(marker.distBetween, unit)}`, midX, midY + 5, cx, cy, rotRad);
                }
            } else {
                for (const y of [y1, y2]) {
                    drawRotatedHLine(ctx, lineLeft, lineRight, y, canvasW, canvasH, rotRad, 'rgba(255,255,255,0.5)', 1.5, [6, 4]);
                }

                // Bracket and label at raw positions
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(rotRad);
                ctx.translate(-cx, -cy);
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.lineWidth = 1;
                ctx.moveTo(lineLeft + 20, y1);
                ctx.lineTo(lineLeft + 12, y1);
                ctx.lineTo(lineLeft + 12, y2);
                ctx.lineTo(lineLeft + 20, y2);
                ctx.stroke();
                ctx.restore();

                const midY = (y1 + y2) / 2;
                drawRotatedLabel(ctx, `↕ ${fmtDist(marker.distBetween, unit)}`, lineLeft + 28, midY + 5, cx, cy, rotRad);
            }
        }
    }

    // Draw horizon line if calibrated
    if (calibration) {
        const yH = calibration.yHorizon * scale + oY;
        if (yH > 0 && yH < canvasH) {
            drawRotatedHLine(ctx, 0, canvasW, yH, canvasW, canvasH, rotRad, 'rgba(255,255,255,0.3)', 1, [2, 4]);
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(rotRad);
            ctx.translate(-cx, -cy);
            ctx.font = '10px -apple-system, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.fillText('horizon', canvasW - 50, yH - 4);
            ctx.restore();
        }
    }
}

/**
 * Draw a horizontal line that appears level to the user
 * by counter-rotating against the CSS rotation.
 */
function drawRotatedHLine(ctx, x1, x2, y, canvasW, canvasH, rotRad, color, lineWidth, dash) {
    const cx = canvasW / 2;
    const cy = canvasH / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotRad);
    ctx.translate(-cx, -cy);
    ctx.beginPath();
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

/**
 * Build a curved path representing equal ground distance from the camera.
 * In perspective, points at equal radial distance form a curve that bows
 * downward at the edges: at horizontal angle θ, y = yH + k/(d·cos(θ)).
 *
 * @param {number} distance - ground distance in feet
 * @param {number} xLeft - left pixel boundary
 * @param {number} xRight - right pixel boundary
 * @param {object} calibration - {yHorizon, k}
 * @param {number} phoneHFov - phone horizontal FOV in degrees
 * @param {number} photoW - photo width in pixels (canvas coords)
 * @param {number} photoOffsetX - photo X offset in canvas
 * @param {number} scale - image-to-canvas scale factor
 * @returns {Array<{x,y}>} array of points forming the curve
 */
function distanceCurvePoints(distance, xLeft, xRight, calibration, phoneHFov, photoW, photoOffsetX, scale, oY) {
    const phoneHalfRad = Math.min(phoneHFov, 179) * Math.PI / 360;
    const phoneHalfTan = Math.tan(phoneHalfRad);
    const yH = calibration.yHorizon;
    const k = calibration.k;
    const yOff = oY || 0;
    const steps = 50;
    const points = [];

    for (let i = 0; i <= steps; i++) {
        const x = xLeft + (i / steps) * (xRight - xLeft);
        // Convert x to horizontal angle from photo center
        const xFrac = (x - photoOffsetX) / photoW; // 0..1 across photo
        const xCentered = (xFrac - 0.5) * 2; // -1..1
        const theta = Math.atan(xCentered * phoneHalfTan);
        // y at this angle for the given distance
        const imgY = yH + k / (distance * Math.cos(theta));
        points.push({ x, y: imgY * scale + yOff });
    }
    return points;
}

/**
 * Stroke a distance curve on the canvas.
 */
function strokeDistanceCurve(ctx, points, canvasW, canvasH, rotRad, color, lineWidth, dash) {
    if (points.length < 2) return;
    const cx = canvasW / 2, cy = canvasH / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotRad);
    ctx.translate(-cx, -cy);
    ctx.beginPath();
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

/**
 * Fill between two distance curves (for PPF zone bands).
 */
function fillBetweenCurves(ctx, topPoints, bottomPoints, canvasW, canvasH, rotRad, fillStyle) {
    if (topPoints.length < 2 || bottomPoints.length < 2) return;
    const cx = canvasW / 2, cy = canvasH / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotRad);
    ctx.translate(-cx, -cy);
    ctx.beginPath();
    // Top curve left to right
    ctx.moveTo(topPoints[0].x, topPoints[0].y);
    for (let i = 1; i < topPoints.length; i++) {
        ctx.lineTo(topPoints[i].x, topPoints[i].y);
    }
    // Bottom curve right to left
    for (let i = bottomPoints.length - 1; i >= 0; i--) {
        ctx.lineTo(bottomPoints[i].x, bottomPoints[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.restore();
}

/**
 * Find where a distance curve meets the left edge or bottom edge of the photo.
 * Returns {x, y} in canvas coordinates for label placement.
 */
function curveEdgePoint(distance, calibration, phoneHFov, photoW, photoOffsetX, scale, canvasH, oY) {
    const phoneHalfRad = Math.min(phoneHFov, 179) * Math.PI / 360;
    const phoneHalfTan = Math.tan(phoneHalfRad);
    const yH = calibration.yHorizon;
    const k = calibration.k;
    const yOff = oY || 0;

    // y at the left edge of the photo (θ = -phoneHFov/2)
    const thetaLeft = -phoneHalfRad;
    const yLeft = (yH + k / (distance * Math.cos(thetaLeft))) * scale + yOff;

    if (yLeft <= canvasH) {
        // Curve reaches the left edge within the canvas
        return { x: photoOffsetX, y: yLeft };
    }

    // Curve exits through the bottom — find the x where y = canvasH
    // canvasH = (yH + k / (d * cos(θ))) * scale + yOff
    // (canvasH - yOff)/scale = yH + k / (d * cos(θ))
    const targetImgY = (canvasH - yOff) / scale;
    const cosTheta = k / (distance * (targetImgY - yH));
    if (cosTheta >= -1 && cosTheta <= 1) {
        const theta = -Math.acos(cosTheta); // negative = left side
        const xFrac = 0.5 + Math.tan(theta) / (2 * phoneHalfTan);
        const x = photoOffsetX + xFrac * photoW;
        return { x: Math.max(photoOffsetX, x), y: canvasH };
    }

    // Fallback
    return { x: photoOffsetX, y: Math.min(yLeft, canvasH) };
}

/**
 * Draw a label that appears level to the user.
 */
function drawRotatedLabel(ctx, text, x, y, cx, cy, rotRad) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotRad);
    ctx.translate(-cx, -cy);
    ctx.font = '12px -apple-system, sans-serif';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - 4, y - 13, tw + 8, 18);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y);
    ctx.restore();
}

function drawPpfZones(ctx, cameras, calibration, scale, canvasW, canvasH, phoneHFov, photoOffsetX, photoW, rotRad, oY, showLabels, unit = 'ft') {
    const numCameras = cameras.length;

    for (let ci = 0; ci < cameras.length; ci++) {
        const cam = cameras[ci];
        const color = cam.color;
        const bounds = fovBounds(cam.hFov, phoneHFov, photoW, cam.panOffset || 0);

        // Determine the horizontal extent of this camera's PPF zones
        let zoneLeft = photoOffsetX + Math.max(0, bounds.left);
        let zoneRight = photoOffsetX + Math.min(photoW, bounds.right);

        // If canvas is expanded, use full bounds
        if (bounds.type === 'wider') {
            zoneLeft = photoOffsetX + bounds.left;
            zoneRight = photoOffsetX + bounds.right;
        }

        // Compute pixel rows for each PPF threshold
        const zones = PPF_ZONES.map(z => ({
            ...z,
            distance: distanceAtPpf(cam, z.ppf),
            row: rowAtDistance(distanceAtPpf(cam, z.ppf), calibration)
        }));

        zones.sort((a, b) => a.distance - b.distance);

        // Build curve points for each zone boundary + bottom edge
        const bottomPts = [];
        for (let s = 0; s <= 50; s++) {
            bottomPts.push({ x: zoneLeft + (s / 50) * (zoneRight - zoneLeft), y: canvasH });
        }

        let prevCurve = bottomPts;
        let prevCenterY = canvasH;

        for (let i = 0; i < zones.length; i++) {
            const zone = zones[i];
            if (zone.row === null) continue;
            const centerY = zone.row * scale + oY;
            if (centerY < 0) continue;

            // Build curved points for this zone boundary
            const curve = distanceCurvePoints(zone.distance, zoneLeft, zoneRight, calibration, phoneHFov, photoW, photoOffsetX, scale, oY);

            // Clamp curve points to canvas
            const clampedCurve = curve.map(p => ({ x: p.x, y: Math.max(0, Math.min(canvasH, p.y)) }));
            const clampedPrev = prevCurve.map(p => ({ x: p.x, y: Math.max(0, Math.min(canvasH, p.y)) }));

            // Fill between previous curve and this one
            const alpha = numCameras > 1 ? 0.15 : 0.2;
            fillBetweenCurves(ctx, clampedCurve, clampedPrev, canvasW, canvasH, rotRad, hexToRgba(color, alpha));

            // Zone boundary curve
            strokeDistanceCurve(ctx, clampedCurve, canvasW, canvasH, rotRad, hexToRgba(color, 0.6), 2, []);

            // Label — position where curve meets left/bottom edge
            if (showLabels) {
                const labelText = `${cam.name}: ${zone.label} (${zone.ppf} PPF) — ${fmtDist(Math.round(zone.distance), unit)}`;
                const edgePt = curveEdgePoint(zone.distance, calibration, phoneHFov, photoW, photoOffsetX, scale, canvasH, oY);
                let labelX, labelY;
                if (edgePt.y >= canvasH - 1) {
                    // Curve exits bottom edge
                    labelX = edgePt.x + 4 + (numCameras > 1 ? ci * 6 : 0);
                    labelY = edgePt.y - 18;
                } else {
                    // Curve reaches left edge
                    labelX = edgePt.x + 4 + (numCameras > 1 ? ci * 6 : 0);
                    labelY = edgePt.y - 5;
                }
                ctx.save();
                ctx.translate(canvasW / 2, canvasH / 2);
                ctx.rotate(rotRad);
                ctx.translate(-canvasW / 2, -canvasH / 2);
                ctx.font = 'bold 11px -apple-system, sans-serif';
                const tw = ctx.measureText(labelText).width;
                ctx.fillStyle = 'rgba(0,0,0,0.75)';
                ctx.fillRect(labelX - 2, labelY - 12, tw + 6, 15);
                ctx.fillStyle = color;
                ctx.fillText(labelText, labelX + 1, labelY);
                ctx.restore();
            }

            prevCurve = curve;
            prevCenterY = centerY;
        }
    }
}

function drawFovBounds(ctx, cameras, phoneHFov, canvasW, canvasH, photoOffsetX, photoW, photoH, rotRad, oY) {
    const cx = canvasW / 2, cy = canvasH / 2;
    const photoOffsetY = oY || 0;

    for (const cam of cameras) {
        const hBounds = fovBounds(cam.hFov, phoneHFov, photoW, cam.panOffset || 0);
        const vBounds = vFovBounds(cam.vFov, phoneHFov, photoW, photoH, cam.tiltOffset || 0);

        const absLeft = photoOffsetX + hBounds.left;
        const absRight = photoOffsetX + hBounds.right;

        // Build aim label
        const parts = [];
        if (cam.panOffset) parts.push(`${cam.panOffset > 0 ? '+' : ''}${cam.panOffset.toFixed(0)}°H`);
        if (cam.tiltOffset) parts.push(`${cam.tiltOffset > 0 ? '+' : ''}${cam.tiltOffset.toFixed(0)}°V`);
        const aimLabel = parts.length ? ` (${parts.join(', ')})` : '';

        // Draw everything counter-rotated
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotRad);
        ctx.translate(-cx, -cy);

        // --- Horizontal FOV bounds ---
        if (hBounds.type === 'narrower') {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.fillRect(photoOffsetX, 0, hBounds.left, canvasH);
            ctx.fillRect(absRight, 0, photoW - hBounds.right, canvasH);

            ctx.beginPath();
            ctx.strokeStyle = hexToRgba(cam.color, 0.8);
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 4]);
            ctx.moveTo(absLeft, 0);
            ctx.lineTo(absLeft, canvasH);
            ctx.moveTo(absRight, 0);
            ctx.lineTo(absRight, canvasH);
            ctx.stroke();
            ctx.setLineDash([]);
        } else if (hBounds.type === 'wider') {
            ctx.beginPath();
            ctx.strokeStyle = hexToRgba(cam.color, 0.6);
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 4]);
            ctx.moveTo(absLeft, 0);
            ctx.lineTo(absLeft, canvasH);
            ctx.moveTo(absRight, 0);
            ctx.lineTo(absRight, canvasH);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // --- Vertical FOV bounds ---
        // vBounds returns values in photo-local coords; add photoOffsetY for canvas coords
        const vTop = vBounds.top + photoOffsetY;
        const vBottom = vBounds.bottom + photoOffsetY;

        // Dim above/below camera's vertical view
        if (vTop > 0) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.fillRect(0, 0, canvasW, vTop);
        }
        if (vBottom < canvasH) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.fillRect(0, vBottom, canvasW, canvasH - vBottom);
        }

        // Top/bottom boundary lines
        ctx.beginPath();
        ctx.strokeStyle = hexToRgba(cam.color, 0.7);
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.moveTo(0, vTop);
        ctx.lineTo(canvasW, vTop);
        ctx.moveTo(0, vBottom);
        ctx.lineTo(canvasW, vBottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Center crosshair (intersection of H and V center lines)
        const centerX = (absLeft + absRight) / 2;
        const centerY = (vTop + vBottom) / 2;
        ctx.beginPath();
        ctx.strokeStyle = hexToRgba(cam.color, 0.3);
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 6]);
        ctx.moveTo(centerX, vTop);
        ctx.lineTo(centerX, vBottom);
        ctx.moveTo(absLeft < 0 ? 0 : absLeft, centerY);
        ctx.lineTo(absRight > canvasW ? canvasW : absRight, centerY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.font = '12px -apple-system, sans-serif';
        ctx.fillStyle = cam.color;
        const labelX = Math.max(4, absLeft + 6);
        const labelY = Math.max(20, vTop + 16);
        ctx.fillText(`${cam.name} — ${cam.hFov}°×${cam.vFov}°${aimLabel}`, labelX, labelY);

        ctx.restore();
    }
}

function drawDistanceRuler(ctx, calibration, scale, canvasW, canvasH, photoOffsetX, photoW, rotRad, phoneHFov, oY, unit = 'ft') {
    // Compute visible distance range based on the photo area (not full canvas)
    const photoTopImgY = 0; // top of photo in image coords
    const photoBottomImgY = (canvasH - oY) / scale; // could extend beyond photo
    const topDist = distanceAtRow(photoTopImgY, calibration);
    const bottomDist = distanceAtRow(photoBottomImgY, calibration);

    if (!isFinite(topDist) && !isFinite(bottomDist)) return;

    const lineLeft = photoOffsetX;
    const lineRight = photoOffsetX + photoW;
    const cx = canvasW / 2, cy = canvasH / 2;

    // Build list of tick distances (in feet for row calculations) and display labels
    const ticks = []; // { distFt, label }

    if (unit === 'm') {
        const minM = isFinite(bottomDist) && bottomDist > 0 ? Math.max(1, Math.floor((bottomDist / 3.281) / 1) * 1) : 1;
        const maxM = isFinite(topDist) ? Math.min(150, topDist / 3.281) : 150;
        const rangeM = maxM - minM;
        let intervalM = 5;
        if (rangeM > 60) intervalM = 20;
        else if (rangeM > 30) intervalM = 10;
        else if (rangeM < 10) intervalM = 2;
        for (let dm = Math.ceil(minM / intervalM) * intervalM; dm <= maxM; dm += intervalM) {
            ticks.push({ distFt: dm * 3.281, label: `${dm} m` });
        }
    } else {
        const minDist = isFinite(bottomDist) && bottomDist > 0 ? Math.max(2, Math.floor(bottomDist / 5) * 5) : 2;
        const maxDist = isFinite(topDist) ? Math.min(500, topDist) : 500;
        const range = maxDist - minDist;
        let interval = 10;
        if (range > 200) interval = 50;
        else if (range > 100) interval = 25;
        else if (range < 30) interval = 5;
        for (let d = Math.ceil(minDist / interval) * interval; d <= maxDist; d += interval) {
            ticks.push({ distFt: d, label: `${d}'` });
        }
    }

    for (const { distFt, label } of ticks) {
        const row = rowAtDistance(distFt, calibration);
        if (row === null) continue;
        const y = row * scale + oY;
        if (y < 10 || y > canvasH - 5) continue;

        // Draw faint distance curve across the full photo width
        if (phoneHFov) {
            const pts = distanceCurvePoints(distFt, lineLeft, lineRight, calibration, phoneHFov, photoW, photoOffsetX, scale, oY);
            strokeDistanceCurve(ctx, pts, canvasW, canvasH, rotRad, 'rgba(255,255,255,0.12)', 0.5, [4, 8]);
        }

        // Label on the right edge
        const labelW = label.length * 6 + 4;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotRad);
        ctx.translate(-cx, -cy);
        ctx.font = '10px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(lineRight + 4, y - 7, labelW, 15);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillText(label, lineRight + 6, y + 4);
        ctx.restore();
    }
}

/**
 * Render the top-down mini-map.
 */
export function renderMiniMap(canvas, state) {
    const { calibration, cameras, phoneHFov, displayOptions, cameraHeightUnit } = state;
    if (!displayOptions.showMiniMap) return;
    const unit = cameraHeightUnit || 'ft';

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H - 20;
    const maxRadius = H - 30;

    const activeCameras = cameras.filter(c => c.visible);
    if (activeCameras.length === 0 && !phoneHFov) return;

    let maxDist = 100;
    for (const cam of activeCameras) {
        const d = distanceAtPpf(cam, 10);
        if (d > maxDist) maxDist = d;
    }
    const pxPerFt = maxRadius / maxDist;

    // Grid rings — use nice intervals in the display unit
    const ringIntervalsFt = unit === 'm'
        ? [8, 15, 30, 60].map(m => m * 3.281)   // ~25/50/100/200 ft equivalents
        : [25, 50, 100, 200];
    const ringLabelsFt = unit === 'm'
        ? [8, 15, 30, 60]
        : [25, 50, 100, 200];
    ctx.font = '9px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < ringIntervalsFt.length; i++) {
        const distFt = ringIntervalsFt[i];
        const displayVal = ringLabelsFt[i];
        if (distFt > maxDist) continue;
        const r = distFt * pxPerFt;
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillText(unit === 'm' ? `${displayVal} m` : `${displayVal}'`, cx, cy - r - 2);
    }

    // Phone FOV wedge
    if (phoneHFov) {
        const phoneHalfRad = (phoneHFov / 2) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, maxRadius, -Math.PI / 2 - phoneHalfRad, -Math.PI / 2 + phoneHalfRad);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '9px -apple-system, sans-serif';
        ctx.fillText('Photo', cx, cy - maxRadius + 12);
    }

    // Each camera's FOV
    for (const cam of activeCameras) {
        const panRad = ((cam.panOffset || 0)) * Math.PI / 180;
        const halfRad = Math.min(cam.hFov, 179.5) / 2 * Math.PI / 180;
        const aimAngle = -Math.PI / 2 + panRad; // -PI/2 = straight up, + panRad rotates

        // PPF zone arcs
        for (const zone of PPF_ZONES) {
            const dist = distanceAtPpf(cam, zone.ppf);
            const r = Math.min(dist * pxPerFt, maxRadius);

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            if (cam.hFov >= 179) {
                ctx.arc(cx, cy, r, aimAngle - Math.PI / 2, aimAngle + Math.PI / 2);
            } else {
                ctx.arc(cx, cy, r, aimAngle - halfRad, aimAngle + halfRad);
            }
            ctx.closePath();
            ctx.fillStyle = hexToRgba(cam.color, 0.12);
            ctx.fill();
        }

        // Outer edge
        const outerDist = distanceAtPpf(cam, 10);
        const outerR = Math.min(outerDist * pxPerFt, maxRadius);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        if (cam.hFov >= 179) {
            ctx.arc(cx, cy, outerR, aimAngle - Math.PI / 2, aimAngle + Math.PI / 2);
        } else {
            ctx.arc(cx, cy, outerR, aimAngle - halfRad, aimAngle + halfRad);
        }
        ctx.closePath();
        ctx.strokeStyle = hexToRgba(cam.color, 0.6);
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Aim direction line
        ctx.beginPath();
        ctx.strokeStyle = hexToRgba(cam.color, 0.4);
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(aimAngle) * outerR, cy + Math.sin(aimAngle) * outerR);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Camera dot
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    // Legend
    ctx.textAlign = 'left';
    ctx.font = '9px -apple-system, sans-serif';
    let ly = H - 4;
    for (const cam of activeCameras) {
        ctx.fillStyle = cam.color;
        ctx.fillRect(4, ly - 8, 8, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText(cam.name, 16, ly);
        ly -= 12;
    }
}

/**
 * Render a camera preview — shows what the camera would actually output.
 * Maps the phone photo into the camera's resolution, FOV, and projection.
 *
 * For single-lens cameras: rectilinear crop/scale from the phone image.
 * For dual-lens panoramic cameras: simulates cylindrical equirectangular
 * output by remapping from the phone's rectilinear projection.
 */
export function renderCameraPreview(canvas, state, camera) {
    if (!state.photo || !camera) {
        const ctx = canvas.getContext('2d');
        canvas.width = 400;
        canvas.height = 80;
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, 400, 80);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '12px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Upload a photo and add a camera', 200, 44);
        return null;
    }

    const img = state.photo;
    const phoneHFov = state.phoneHFov;
    const panOffset = camera.panOffset || 0;
    const tiltOffset = camera.tiltOffset || 0;

    // Output dimensions — use the container's available width
    const containerW = canvas.parentElement ? canvas.parentElement.clientWidth : 800;
    const camAspect = camera.hRes / camera.vRes;
    const outW = Math.min(containerW, camera.hRes); // don't exceed native res
    const outH = Math.round(outW / camAspect);

    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, outW, outH);

    // Phone's angular coverage
    const phoneHHalfRad = Math.min(phoneHFov, 179) * Math.PI / 360;
    const phoneHHalfTan = Math.tan(phoneHHalfRad);
    const phoneVHalfRad = Math.atan(phoneHHalfTan * img.naturalHeight / img.naturalWidth);

    // Camera angular coverage
    const camHHalfDeg = camera.hFov / 2;
    const camVHalfDeg = camera.vFov / 2;

    const isDualLens = camera.numLenses && camera.numLenses > 1;

    // For each output pixel, compute the viewing angle, then map back to the phone image
    const imgData = getPhoneImageData(img);
    const outData = ctx.createImageData(outW, outH);
    const srcW = imgData.width;
    const srcH = imgData.height;
    const src = imgData.data;
    const dst = outData.data;

    for (let oy = 0; oy < outH; oy++) {
        // Vertical angle: map output row to angle from camera center
        // oy=0 → top of camera view, oy=outH-1 → bottom
        const vFrac = (oy + 0.5) / outH;  // 0..1
        const vAngleDeg = camVHalfDeg - vFrac * camera.vFov + tiltOffset;
        const vAngleRad = vAngleDeg * Math.PI / 180;

        // Map to phone image Y
        // Phone vertical: center = img.naturalHeight/2, angle maps via tan
        const phoneVFrac = 0.5 - Math.tan(vAngleRad) / (2 * Math.tan(phoneVHalfRad));
        const srcY = phoneVFrac * srcH;

        if (srcY < 0 || srcY >= srcH - 1) {
            // Outside phone image — leave black
            continue;
        }

        for (let ox = 0; ox < outW; ox++) {
            // Horizontal angle: depends on projection type
            let hAngleDeg;

            if (isDualLens) {
                // Cylindrical equirectangular: linear mapping from pixel to angle
                const hFrac = (ox + 0.5) / outW;  // 0..1
                hAngleDeg = -camHHalfDeg + hFrac * camera.hFov + panOffset;
            } else {
                // Rectilinear: pixel position maps via tangent
                const camHHalfRad = Math.min(camHHalfDeg, 89) * Math.PI / 180;
                const camHHalfTan = Math.tan(camHHalfRad);
                const hFrac = (ox + 0.5) / outW;  // 0..1
                const hTan = -camHHalfTan + hFrac * 2 * camHHalfTan;
                hAngleDeg = Math.atan(hTan) * 180 / Math.PI + panOffset;
            }

            // Map horizontal angle to phone image X
            // Phone is rectilinear: angle → tan → pixel
            const hAngleRad = hAngleDeg * Math.PI / 180;
            if (Math.abs(hAngleDeg) >= 89) continue;

            const phoneHFrac = 0.5 + Math.tan(hAngleRad) / (2 * phoneHHalfTan);
            const srcX = phoneHFrac * srcW;

            if (srcX < 0 || srcX >= srcW - 1) {
                // Outside phone image — leave black
                continue;
            }

            // Bilinear sample from source
            const sx = Math.floor(srcX);
            const sy = Math.floor(srcY);
            const fx = srcX - sx;
            const fy = srcY - sy;

            const i00 = (sy * srcW + sx) * 4;
            const i10 = i00 + 4;
            const i01 = i00 + srcW * 4;
            const i11 = i01 + 4;

            const dstIdx = (oy * outW + ox) * 4;
            for (let c = 0; c < 3; c++) {
                dst[dstIdx + c] = Math.round(
                    src[i00 + c] * (1 - fx) * (1 - fy) +
                    src[i10 + c] * fx * (1 - fy) +
                    src[i01 + c] * (1 - fx) * fy +
                    src[i11 + c] * fx * fy
                );
            }
            dst[dstIdx + 3] = 255;
        }
    }

    ctx.putImageData(outData, 0, 0);

    // Draw stitch line for dual-lens cameras
    if (isDualLens) {
        // Stitch at the center of the panorama (adjusted for pan)
        const stitchFrac = 0.5 - panOffset / camera.hFov;
        const stitchX = Math.round(stitchFrac * outW);
        if (stitchX > 0 && stitchX < outW) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 4]);
            ctx.moveTo(stitchX, 0);
            ctx.lineTo(stitchX, outH);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    // Label: resolution and projection
    ctx.font = '10px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.textAlign = 'left';
    const projLabel = isDualLens ? 'cylindrical' : 'rectilinear';
    ctx.fillText(`${camera.hRes}×${camera.vRes}  ${projLabel}`, 4, outH - 4);

    // Return info for the info panel
    return {
        outputRes: `${camera.hRes}×${camera.vRes}`,
        aspect: `${camAspect.toFixed(2)}:1`,
        projection: isDualLens ? 'Cylindrical (dual-lens stitched)' : 'Rectilinear',
        lenses: isDualLens ? `${camera.numLenses} × ${camera.perLensHRes}×${camera.vRes}` : 'Single lens'
    };
}

// Cache the phone image pixel data to avoid re-reading on every preview render
let _cachedImgSrc = null;
let _cachedImgData = null;

function getPhoneImageData(img) {
    if (_cachedImgSrc === img.src && _cachedImgData) return _cachedImgData;

    // Downscale for performance while maintaining reasonable quality
    const maxDim = 1600;
    const scale = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight, 1);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);

    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    _cachedImgData = ctx.getImageData(0, 0, w, h);
    _cachedImgSrc = img.src;
    return _cachedImgData;
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

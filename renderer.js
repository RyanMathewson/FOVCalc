import { distanceAtRow, rowAtDistance, ppfAtDistance, distanceAtPpf, PPF_ZONES, fovBounds, vFovBounds } from './perspective.js';

/**
 * Draw the photo on the background canvas, scaled to fit.
 * If cameras have wider FOV than the phone, expand the canvas to show the full FOV.
 */
export function drawPhoto(bgCanvas, image, containerW, containerH, cameras, phoneHFov) {
    // Base scale: fit photo in container
    const baseScale = Math.min(containerW / image.naturalWidth, containerH / image.naturalHeight, 1);

    // Determine if we need to expand for wider cameras
    let expandRatio = 1; // ratio of total canvas width to photo width
    if (cameras && cameras.length > 0) {
        for (const cam of cameras) {
            if (!cam.visible) continue;
            const bounds = fovBounds(cam.hFov, phoneHFov, 100, cam.panOffset || 0);
            if (bounds.type === 'wider') {
                // How wide does the canvas need to be relative to the photo?
                const totalWidth = bounds.right - bounds.left;
                const ratio = totalWidth / 100; // 100 is our reference photoWidth
                if (ratio > expandRatio) expandRatio = ratio;
            }
        }
    }

    const photoW = Math.round(image.naturalWidth * baseScale);
    const photoH = Math.round(image.naturalHeight * baseScale);
    const canvasW = Math.round(photoW * expandRatio);
    const canvasH = photoH;
    const photoOffsetX = Math.round((canvasW - photoW) / 2);

    bgCanvas.width = canvasW;
    bgCanvas.height = canvasH;
    const ctx = bgCanvas.getContext('2d');

    // Fill expanded areas with dark pattern
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Draw hatching in expanded areas
    if (expandRatio > 1) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        const spacing = 12;
        // Left expanded area
        for (let i = -canvasH; i < photoOffsetX; i += spacing) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i + canvasH, canvasH);
            ctx.stroke();
        }
        // Right expanded area
        for (let i = photoOffsetX + photoW - canvasH; i < canvasW; i += spacing) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i + canvasH, canvasH);
            ctx.stroke();
        }
        ctx.restore();

        // Border around photo area
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(photoOffsetX, 0, photoW, photoH);
        ctx.setLineDash([]);

        // Label
        ctx.font = '11px -apple-system, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.textAlign = 'center';
        ctx.fillText('Beyond photo', photoOffsetX / 2, canvasH / 2);
        ctx.fillText('Beyond photo', photoOffsetX + photoW + (canvasW - photoOffsetX - photoW) / 2, canvasH / 2);
        ctx.textAlign = 'left';
    }

    // Draw the photo
    ctx.drawImage(image, photoOffsetX, 0, photoW, photoH);

    return { scale: baseScale, width: canvasW, height: canvasH, photoW, photoH, photoOffsetX, expandRatio };
}

/**
 * Main overlay render function.
 */
export function renderOverlay(overlayCanvas, state) {
    const { photoLayout, calibration, cameras, phoneHFov, displayOptions, photoRotation } = state;
    if (!photoLayout) return;

    const { scale, width, height, photoW, photoOffsetX } = photoLayout;
    overlayCanvas.width = width;
    overlayCanvas.height = height;
    const ctx = overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    // Counter-rotation angle: negate the CSS rotation so drawn lines appear level
    const rotRad = -(photoRotation || 0) * Math.PI / 180;

    const activeCameras = cameras.filter(c => c.visible);

    // Draw calibration markers
    drawCalibrationMarkers(ctx, state.markers, scale, width, height, calibration, photoOffsetX, photoW, rotRad);

    // Draw pending between-marker first point
    if (state.pendingMarker && state.pendingMarker.y1 !== undefined && state.mode === 'placing-between-2') {
        const y = state.pendingMarker.y1 * scale;
        drawRotatedHLine(ctx, photoOffsetX, photoOffsetX + photoW, y, width, height, rotRad, 'rgba(59, 130, 246, 0.8)', 2, [3, 3]);

        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(photoOffsetX + photoW / 2, y, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '12px -apple-system, sans-serif';
        ctx.fillStyle = '#3b82f6';
        ctx.fillText('Click second point...', photoOffsetX + 10, y - 10);
    }

    // Draw pending horizon point
    if (state.pendingHorizon && state.mode === 'picking-horizon-2') {
        const p = state.pendingHorizon;
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(p.x1 * scale + photoOffsetX, p.y1 * scale, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '11px -apple-system, sans-serif';
        ctx.fillText('Click second horizon point...', p.x1 * scale + photoOffsetX + 10, p.y1 * scale - 8);
    }

    if (calibration && activeCameras.length > 0) {
        if (displayOptions.showPpf) {
            drawPpfZones(ctx, activeCameras, calibration, scale, width, height, phoneHFov, photoOffsetX, photoW, rotRad);
        }
        if (displayOptions.showFov) {
            drawFovBounds(ctx, activeCameras, phoneHFov, width, height, photoOffsetX, photoW, photoLayout.photoH || height, rotRad);
        }
        if (displayOptions.showRuler) {
            drawDistanceRuler(ctx, calibration, scale, width, height, photoOffsetX, photoW, rotRad);
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

function drawCalibrationMarkers(ctx, markers, scale, canvasW, canvasH, calibration, photoOffsetX, photoW, rotRad) {
    const lineLeft = photoOffsetX;
    const lineRight = photoOffsetX + photoW;
    const cx = canvasW / 2;
    const cy = canvasH / 2;

    for (const marker of markers) {
        if (marker.type === 'single') {
            const y = marker.y * scale;
            drawRotatedHLine(ctx, lineLeft, lineRight, y, canvasW, canvasH, rotRad, 'rgba(255,255,255,0.6)', 1.5, [6, 4]);

            let label = `${marker.groundDistFt} ft`;
            if (marker.elevChangeFt) label += ` (${marker.elevChangeFt > 0 ? '↓' : '↑'}${Math.abs(marker.elevChangeFt)}')`;
            drawRotatedLabel(ctx, label, lineLeft + 12, y - 5, cx, cy, rotRad);
        } else if (marker.type === 'between') {
            const y1 = marker.y1 * scale;
            const y2 = marker.y2 * scale;

            // Bracket (drawn in canvas space — small enough that rotation doesn't matter much)
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 1;
            ctx.moveTo(lineLeft + 20, y1);
            ctx.lineTo(lineLeft + 12, y1);
            ctx.lineTo(lineLeft + 12, y2);
            ctx.lineTo(lineLeft + 20, y2);
            ctx.stroke();

            for (const y of [y1, y2]) {
                drawRotatedHLine(ctx, lineLeft, lineRight, y, canvasW, canvasH, rotRad, 'rgba(255,255,255,0.5)', 1.5, [6, 4]);
            }

            const midY = (y1 + y2) / 2;
            drawRotatedLabel(ctx, `↕ ${marker.distBetween} ft`, lineLeft + 28, midY + 5, cx, cy, rotRad);
        }
    }

    // Draw horizon line if calibrated
    if (calibration) {
        const yH = calibration.yHorizon * scale;
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

function drawPpfZones(ctx, cameras, calibration, scale, canvasW, canvasH, phoneHFov, photoOffsetX, photoW, rotRad) {
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

        let prevY = canvasH;

        for (let i = 0; i < zones.length; i++) {
            const zone = zones[i];
            if (zone.row === null) continue;
            const yPx = zone.row * scale;

            if (yPx < 0) continue;
            const bandTop = Math.max(0, yPx);
            const bandBottom = Math.min(canvasH, prevY);

            if (bandBottom > bandTop) {
                // Zone fill band (drawn in rotated space so it aligns with the scene)
                const cx = canvasW / 2, cy = canvasH / 2;
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(rotRad);
                ctx.translate(-cx, -cy);

                const alpha = numCameras > 1 ? 0.15 : 0.2;
                ctx.fillStyle = hexToRgba(color, alpha);
                ctx.fillRect(zoneLeft, bandTop, zoneRight - zoneLeft, bandBottom - bandTop);

                ctx.restore();

                // Zone boundary line
                drawRotatedHLine(ctx, zoneLeft, zoneRight, bandTop, canvasW, canvasH, rotRad, hexToRgba(color, 0.6), 2, []);

                // Label
                const labelText = `${cam.name}: ${zone.label} (${zone.ppf} PPF) — ${Math.round(zone.distance)} ft`;
                const labelX = zoneLeft + 10 + (numCameras > 1 ? ci * 6 : 0);
                const labelY = bandTop + 14;
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
            prevY = yPx;
        }
    }
}

function drawFovBounds(ctx, cameras, phoneHFov, canvasW, canvasH, photoOffsetX, photoW, photoH, rotRad) {
    const cx = canvasW / 2, cy = canvasH / 2;

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
        const vTop = vBounds.top;
        const vBottom = vBounds.bottom;

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
        if (vTop > 0) {
            ctx.moveTo(0, vTop);
            ctx.lineTo(canvasW, vTop);
        }
        if (vBottom < canvasH) {
            ctx.moveTo(0, vBottom);
            ctx.lineTo(canvasW, vBottom);
        }
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

function drawDistanceRuler(ctx, calibration, scale, canvasW, canvasH, photoOffsetX, photoW, rotRad) {
    const rulerX = photoOffsetX + photoW + 6;

    const topDist = distanceAtRow(0, { yHorizon: calibration.yHorizon, k: calibration.k });
    const bottomDist = distanceAtRow(canvasH / scale, { yHorizon: calibration.yHorizon, k: calibration.k });

    if (!isFinite(topDist) && !isFinite(bottomDist)) return;

    const minDist = isFinite(bottomDist) ? Math.max(5, Math.floor(bottomDist / 5) * 5) : 5;
    const maxDist = isFinite(topDist) ? Math.min(500, topDist) : 500;

    const range = maxDist - minDist;
    let interval = 10;
    if (range > 200) interval = 50;
    else if (range > 100) interval = 25;
    else if (range < 30) interval = 5;

    // Draw entire ruler in rotated space
    const cx = canvasW / 2, cy = canvasH / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotRad);
    ctx.translate(-cx, -cy);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(rulerX, 0, 40, canvasH);

    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'left';

    for (let d = Math.ceil(minDist / interval) * interval; d <= maxDist; d += interval) {
        const row = rowAtDistance(d, calibration);
        if (row === null) continue;
        const y = row * scale;
        if (y < 10 || y > canvasH - 5) continue;

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.moveTo(rulerX, y);
        ctx.lineTo(rulerX + 8, y);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillText(`${d}'`, rulerX + 10, y + 3);
    }

    ctx.restore();
}

/**
 * Render the top-down mini-map.
 */
export function renderMiniMap(canvas, state) {
    const { calibration, cameras, phoneHFov, displayOptions } = state;
    if (!displayOptions.showMiniMap) return;

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

    // Grid rings
    const ringIntervals = [25, 50, 100, 200];
    ctx.font = '9px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    for (const dist of ringIntervals) {
        if (dist > maxDist) continue;
        const r = dist * pxPerFt;
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillText(`${dist}'`, cx, cy - r - 2);
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

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

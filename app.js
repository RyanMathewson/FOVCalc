import { CAMERA_PRESETS, PHONE_PRESETS } from './cameras.js';
import { calibrate, ppfAtDistance, ppfRangeAtDistance, distanceAtPpf, fovBounds, PPF_ZONES } from './perspective.js';
import { drawPhoto, renderOverlay, renderMiniMap, renderCameraPreview } from './renderer.js';

// ── State ──
const state = {
    photo: null,
    photoRotation: 0, // degrees
    phoneModel: 'iphone-14',
    phoneZoom: '0.5x',
    phoneHFov: 120,
    markers: [],
    calibration: null,
    cameras: [],
    displayOptions: { showPpf: true, showFov: true, showRuler: true, showMiniMap: true },
    photoLayout: null,
    cameraHeight: 9, // feet, from ground to camera
    cameraHeightUnit: 'ft',
    mode: 'idle', // idle | placing-single | placing-between-1 | placing-between-2 | dragging-cam | picking-horizon-1 | picking-horizon-2
    pendingMarker: null, // { y1, y2 } for two-click calibration
    pendingHorizon: null, // { x1, y1 } for horizon pick
    nextCameraId: 1,
    draggingCamera: null, // camera being dragged
    dragStartX: 0,
    dragStartPan: 0
};

// ── DOM refs ──
const $ = id => document.getElementById(id);
const bgCanvas = $('bg-canvas');
const overlayCanvas = $('overlay-canvas');
const canvasContainer = $('canvas-container');
const uploadZone = $('upload-zone');
const fileInput = $('file-input');
const selPhone = $('sel-phone');
const selLens = $('sel-lens');
const customFovRow = $('custom-fov-row');
const inputCustomFov = $('input-custom-fov');
const phoneFovDisplay = $('phone-fov-display');
const markerList = $('marker-list');
const btnClearMarkers = $('btn-clear-markers');
const calibrationStatus = $('calibration-status');
const cameraListEl = $('camera-list');
const minimapCanvas = $('minimap-canvas');
const previewCanvas = $('preview-canvas');
const selPreviewCam = $('sel-preview-cam');
const previewInfo = $('preview-info');
const inputRotation = $('input-rotation');
const rotationValue = $('rotation-value');

// ── Init phone selectors ──
PHONE_PRESETS.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === state.phoneModel) opt.selected = true;
    selPhone.appendChild(opt);
});

function updateLensOptions() {
    selLens.innerHTML = '';
    const phone = PHONE_PRESETS.find(p => p.id === selPhone.value);
    if (!phone) return;

    phone.lenses.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.zoom;
        opt.textContent = l.label;
        if (l.zoom === state.phoneZoom) opt.selected = true;
        selLens.appendChild(opt);
    });

    updatePhoneFov();
}

function updatePhoneFov() {
    const phone = PHONE_PRESETS.find(p => p.id === selPhone.value);
    if (!phone) return;

    state.phoneModel = selPhone.value;
    state.phoneZoom = selLens.value;

    const isCustom = selPhone.value === 'custom';
    customFovRow.style.display = isCustom ? '' : 'none';

    if (isCustom) {
        state.phoneHFov = parseFloat(inputCustomFov.value) || 75;
    } else {
        const lens = phone.lenses.find(l => l.zoom === selLens.value);
        state.phoneHFov = lens ? lens.hFov : 75;
    }
    phoneFovDisplay.textContent = `HFOV: ${state.phoneHFov}°`;
    render();
}

selPhone.addEventListener('change', () => { updateLensOptions(); });
selLens.addEventListener('change', updatePhoneFov);
inputCustomFov.addEventListener('input', updatePhoneFov);
updateLensOptions();

// ── Camera height ──
$('input-cam-height').addEventListener('input', () => {
    const val = parseFloat($('input-cam-height').value);
    const unit = $('sel-height-unit').value;
    if (val > 0) {
        state.cameraHeight = unit === 'm' ? val * 3.281 : val;
        state.cameraHeightUnit = unit;
        recalibrate();
        render();
    }
});
$('sel-height-unit').addEventListener('change', () => {
    const val = parseFloat($('input-cam-height').value);
    const unit = $('sel-height-unit').value;
    if (val > 0) {
        state.cameraHeight = unit === 'm' ? val * 3.281 : val;
        state.cameraHeightUnit = unit;
        recalibrate();
        render();
    }
});

// ── Photo rotation ──
inputRotation.addEventListener('input', () => {
    state.photoRotation = parseFloat(inputRotation.value) || 0;
    rotationValue.textContent = `${state.photoRotation}°`;
    applyRotation();
});

$('btn-reset-rotation').addEventListener('click', () => {
    inputRotation.value = 0;
    state.photoRotation = 0;
    rotationValue.textContent = '0°';
    applyRotation();
});

function applyRotation() {
    canvasContainer.style.transform = state.photoRotation ? `rotate(${state.photoRotation}deg)` : '';
}

// ── Photo upload ──
function loadPhoto(file) {
    const reader = new FileReader();
    reader.onload = e => {
        const img = new Image();
        img.onload = () => {
            state.photo = img;
            uploadZone.classList.add('hidden');
            canvasContainer.style.display = '';
            fitCanvas();
            detectPhoneFromExif(file);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function detectPhoneFromExif(file) {
    const reader = new FileReader();
    reader.onload = e => {
        const view = new DataView(e.target.result);
        const model = readExifModel(view);
        if (model) {
            const lower = model.toLowerCase();
            if (lower.includes('iphone 14')) selPhone.value = 'iphone-14';
            else if (lower.includes('iphone 15')) selPhone.value = 'iphone-15-pro';
            else if (lower.includes('iphone 16')) selPhone.value = 'iphone-16';
            else if (lower.includes('pixel 8')) selPhone.value = 'pixel-8';
            else if (lower.includes('galaxy') || lower.includes('sm-s92')) selPhone.value = 'galaxy-s24';
            updateLensOptions();
        }
    };
    reader.readAsArrayBuffer(file.slice(0, 65536));
}

function readExifModel(view) {
    if (view.byteLength < 4) return null;
    if (view.getUint16(0) !== 0xFFD8) return null;
    let offset = 2;
    while (offset < view.byteLength - 4) {
        const marker = view.getUint16(offset);
        if (marker === 0xFFE1) {
            const length = view.getUint16(offset + 2);
            const exifOffset = offset + 4;
            if (view.getUint32(exifOffset) === 0x45786966 && view.getUint16(exifOffset + 4) === 0x0000) {
                return parseExifForModel(view, exifOffset + 6, exifOffset + 6 + length - 8);
            }
            offset += 2 + length;
        } else if ((marker & 0xFF00) === 0xFF00) {
            if (marker === 0xFFDA) break;
            offset += 2 + view.getUint16(offset + 2);
        } else {
            break;
        }
    }
    return null;
}

function parseExifForModel(view, tiffStart, end) {
    if (tiffStart + 8 > view.byteLength) return null;
    const byteOrder = view.getUint16(tiffStart);
    const le = byteOrder === 0x4949;
    function getU16(off) { return view.getUint16(off, le); }
    function getU32(off) { return view.getUint32(off, le); }
    const ifdOffset = getU32(tiffStart + 4);
    const ifdStart = tiffStart + ifdOffset;
    if (ifdStart + 2 > end) return null;
    const numEntries = getU16(ifdStart);
    for (let i = 0; i < numEntries; i++) {
        const entryOff = ifdStart + 2 + i * 12;
        if (entryOff + 12 > end) break;
        const tag = getU16(entryOff);
        if (tag === 0x0110) {
            const count = getU32(entryOff + 4);
            let strOffset = count <= 4 ? entryOff + 8 : tiffStart + getU32(entryOff + 8);
            if (strOffset + count > view.byteLength) return null;
            let str = '';
            for (let j = 0; j < count - 1; j++) str += String.fromCharCode(view.getUint8(strOffset + j));
            return str;
        }
    }
    return null;
}

$('btn-upload').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => { if (e.target.files[0]) loadPhoto(e.target.files[0]); });

uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) loadPhoto(e.dataTransfer.files[0]);
});

// ── Canvas sizing ──
function fitCanvas() {
    if (!state.photo) return;
    const area = document.querySelector('.canvas-area');
    const pad = 16;
    const availW = area.clientWidth - pad * 2;
    const availH = area.clientHeight - pad * 2;
    state.photoLayout = drawPhoto(bgCanvas, state.photo, availW, availH, state.cameras, state.phoneHFov);
    overlayCanvas.width = state.photoLayout.width;
    overlayCanvas.height = state.photoLayout.height;
    applyRotation();
    render();
}

window.addEventListener('resize', fitCanvas);

// ── Calibration ──
// "From Camera" mode: single click → prompt for distance from camera
// "Between Points" mode: two clicks → prompt for distance between them

// -- From Camera: single click --
$('btn-add-marker').addEventListener('click', () => {
    if (!state.photo) return;
    state.mode = 'placing-single';
    state.pendingMarker = {};
    overlayCanvas.style.cursor = 'crosshair';
    $('btn-add-marker').textContent = 'Click on ground...';
});

// -- Between Points: two clicks --
$('btn-add-between').addEventListener('click', () => {
    if (!state.photo) return;
    state.mode = 'placing-between-1';
    state.pendingMarker = {};
    overlayCanvas.style.cursor = 'crosshair';
    $('btn-add-between').textContent = 'Click 1st point...';
});

/**
 * Convert screen (mouse) coordinates to canvas coordinates,
 * accounting for the CSS rotation applied to the canvas container.
 */
function screenToCanvas(screenX, screenY) {
    const rect = canvasContainer.getBoundingClientRect();
    // Center of the container in screen space
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Mouse position relative to center
    const dx = screenX - cx;
    const dy = screenY - cy;

    // Reverse the CSS rotation
    const angle = -(state.photoRotation || 0) * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;

    // Convert back to canvas coordinates (relative to top-left of the unrotated canvas)
    const canvasW = overlayCanvas.width;
    const canvasH = overlayCanvas.height;
    const canvasX = rx + canvasW / 2;
    const canvasY = ry + canvasH / 2;

    return { canvasX, canvasY };
}

overlayCanvas.addEventListener('click', e => {
    const { canvasX, canvasY } = screenToCanvas(e.clientX, e.clientY);
    const imgX = (canvasX - (state.photoLayout.photoOffsetX || 0)) / state.photoLayout.scale;
    const imgY = canvasY / state.photoLayout.scale;

    // Single-point (from camera)
    if (state.mode === 'placing-single') {
        state.pendingMarker.y = imgY;
        state.mode = 'idle';
        overlayCanvas.style.cursor = 'default';
        $('btn-add-marker').textContent = '+ Ground Distance';

        $('modal-marker-single').classList.remove('hidden');
        $('marker-dist-single').value = '';
        $('marker-dist-single').focus();
        return;
    }

    // Between-points: first click
    if (state.mode === 'placing-between-1') {
        state.pendingMarker.y1 = imgY;
        state.mode = 'placing-between-2';
        $('btn-add-between').textContent = 'Click 2nd point...';
        render();
        return;
    }

    // Between-points: second click
    if (state.mode === 'placing-between-2') {
        state.pendingMarker.y2 = imgY;

        // Ensure y1 < y2 (y1 = higher in image = farther)
        if (state.pendingMarker.y1 > state.pendingMarker.y2) {
            const tmp = state.pendingMarker.y1;
            state.pendingMarker.y1 = state.pendingMarker.y2;
            state.pendingMarker.y2 = tmp;
        }

        state.mode = 'idle';
        overlayCanvas.style.cursor = 'default';
        $('btn-add-between').textContent = '+ Between Points';

        // Check if points are at similar Y (horizontal measurement — won't help calibration)
        const yDiff = Math.abs(state.pendingMarker.y2 - state.pendingMarker.y1);
        const imgHeight = state.photo.naturalHeight;
        const betweenWarning = $('between-horiz-warning');
        if (yDiff < imgHeight * 0.03) {
            betweenWarning.style.display = '';
        } else {
            betweenWarning.style.display = 'none';
        }

        $('modal-marker-between').classList.remove('hidden');
        $('marker-dist-between').value = '';
        $('marker-dist-between').focus();
        return;
    }

    // Horizon pick: first click
    if (state.mode === 'picking-horizon-1') {
        state.pendingHorizon = { x1: imgX, y1: imgY };
        state.mode = 'picking-horizon-2';
        $('btn-pick-horizon').textContent = 'Click 2nd...';
        render();
        return;
    }

    // Horizon pick: second click
    if (state.mode === 'picking-horizon-2') {
        const p = state.pendingHorizon;
        const dx = imgX - p.x1;
        const dy = imgY - p.y1;
        if (Math.abs(dx) > 1) {
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            state.photoRotation = -angle;
            inputRotation.value = state.photoRotation;
            rotationValue.textContent = `${state.photoRotation.toFixed(1)}°`;
            applyRotation();
        }
        state.pendingHorizon = null;
        state.mode = 'idle';
        overlayCanvas.style.cursor = 'default';
        $('btn-pick-horizon').textContent = 'Pick Horizon';
        render();
        return;
    }
});

// Horizon pick button
$('btn-pick-horizon').addEventListener('click', () => {
    if (!state.photo) return;
    state.mode = 'picking-horizon-1';
    state.pendingHorizon = null;
    overlayCanvas.style.cursor = 'crosshair';
    $('btn-pick-horizon').textContent = 'Click 1st...';
});

// -- Confirm single-point marker --
function confirmSingle() {
    let dist = parseFloat($('marker-dist-single').value);
    if (!dist || dist <= 0) return;
    const unit = $('marker-unit-single').value;
    if (unit === 'm') dist *= 3.281;

    let elevFt = parseFloat($('marker-elev-single').value) || 0;
    if (unit === 'm') elevFt *= 3.281;
    if ($('marker-elev-dir').value === 'up') elevFt = -elevFt; // "up" means ground is higher, camera effectively lower

    state.markers.push({
        y: state.pendingMarker.y,
        groundDistFt: Math.round(dist * 10) / 10,
        elevChangeFt: Math.round(elevFt * 10) / 10, // positive = ground lower (camera sees further down)
        type: 'single'
    });

    state.pendingMarker = null;
    $('modal-marker-single').classList.add('hidden');
    recalibrate();
    updateMarkerList();
    fitCanvas();
}

$('btn-confirm-single').addEventListener('click', confirmSingle);
$('marker-dist-single').addEventListener('keydown', e => { if (e.key === 'Enter') confirmSingle(); });
$('btn-cancel-single').addEventListener('click', () => {
    $('modal-marker-single').classList.add('hidden');
    state.pendingMarker = null;
    state.mode = 'idle';
    overlayCanvas.style.cursor = 'default';
    $('btn-add-marker').textContent = '+ Ground Distance';
    render();
});

// -- Confirm between-points marker --
function confirmBetween() {
    let dist = parseFloat($('marker-dist-between').value);
    if (!dist || dist <= 0) return;
    const unit = $('marker-unit-between').value;
    if (unit === 'm') dist *= 3.281;

    let elevFt = parseFloat($('marker-elev-between').value) || 0;
    if (unit === 'm') elevFt *= 3.281;
    if ($('marker-elev-dir-between').value === 'up') elevFt = -elevFt;

    state.markers.push({
        y1: state.pendingMarker.y1,
        y2: state.pendingMarker.y2,
        distBetween: Math.round(dist * 10) / 10,
        elevChangeFt: Math.round(elevFt * 10) / 10,
        type: 'between'
    });

    state.pendingMarker = null;
    $('modal-marker-between').classList.add('hidden');
    recalibrate();
    updateMarkerList();
    fitCanvas();
}

$('btn-confirm-between').addEventListener('click', confirmBetween);
$('marker-dist-between').addEventListener('keydown', e => { if (e.key === 'Enter') confirmBetween(); });
$('btn-cancel-between').addEventListener('click', () => {
    $('modal-marker-between').classList.add('hidden');
    state.pendingMarker = null;
    state.mode = 'idle';
    overlayCanvas.style.cursor = 'default';
    $('btn-add-between').textContent = '+ Between Points';
    render();
});

function recalibrate() {
    // Build point list: the calibrator expects {yPixel, distanceFt} pairs.
    // We feed it "effective" ground distances that account for elevation changes.
    // Model: d_eff = groundDist * h / (h + elevChange), where h = camera height.
    const h = state.cameraHeight;
    const points = [];

    function effectiveDist(groundDist, elevChange) {
        // elevChange > 0 means ground is lower at that point
        const effectiveH = h + (elevChange || 0);
        if (effectiveH <= 0) return groundDist; // safety: don't divide by weird values
        return groundDist * h / effectiveH;
    }

    // Single-point markers
    for (const m of state.markers) {
        if (m.type === 'single') {
            points.push({
                yPixel: m.y,
                distanceFt: effectiveDist(m.groundDistFt, m.elevChangeFt)
            });
        }
    }

    // If we have one single-point and a "between" marker, derive a second reference
    if (points.length === 1) {
        for (const m of state.markers) {
            if (m.type !== 'between') continue;
            const absPoint = points[0];
            const absMarker = state.markers.find(mk => mk.type === 'single');
            // Check which end of the between-marker is closer to our known point
            const dy1 = Math.abs(absPoint.yPixel - m.y1);
            const dy2 = Math.abs(absPoint.yPixel - m.y2);
            if (dy1 < dy2) {
                // Known point is near the far end (y1). Near end = known ground dist - between.
                const nearGroundDist = absMarker.groundDistFt - m.distBetween;
                if (nearGroundDist > 0) {
                    // Near point has less elevation change (proportional)
                    const nearElev = (absMarker.elevChangeFt || 0) - (m.elevChangeFt || 0);
                    points.push({ yPixel: m.y2, distanceFt: effectiveDist(nearGroundDist, nearElev) });
                }
            } else {
                // Known point is near the near end (y2). Far end = known + between.
                const farGroundDist = absMarker.groundDistFt + m.distBetween;
                const farElev = (absMarker.elevChangeFt || 0) + (m.elevChangeFt || 0);
                points.push({ yPixel: m.y1, distanceFt: effectiveDist(farGroundDist, farElev) });
            }
            break;
        }
    }

    if (points.length >= 2) {
        state.calibration = calibrate(points);
    } else {
        state.calibration = null;
    }

    if (state.calibration) {
        calibrationStatus.textContent = `Calibrated (${points.length} reference points)`;
        calibrationStatus.style.color = '#22c55e';
    } else if (points.length === 0) {
        calibrationStatus.textContent = 'Need at least 2 distance markers';
        calibrationStatus.style.color = '#eab308';
    } else if (points.length === 1) {
        calibrationStatus.textContent = 'Need 1 more — add another "From Camera" or "Between Points" marker';
        calibrationStatus.style.color = '#eab308';
    } else {
        calibrationStatus.textContent = 'Calibration failed — try different points';
        calibrationStatus.style.color = '#ef4444';
    }
}

function updateMarkerList() {
    markerList.innerHTML = '';
    state.markers.forEach((m, i) => {
        const div = document.createElement('div');
        div.className = 'marker-item';
        let label;
        if (m.type === 'between') {
            label = `↕ ${m.distBetween} ft between`;
            if (m.elevChangeFt) label += ` (${Math.abs(m.elevChangeFt)}' ${m.elevChangeFt > 0 ? 'drop' : 'rise'})`;
        } else {
            label = `${m.groundDistFt} ft ground dist`;
            if (m.elevChangeFt) label += ` (${Math.abs(m.elevChangeFt)}' ${m.elevChangeFt > 0 ? 'drop' : 'rise'})`;
        }
        div.innerHTML = `
            <span class="marker-dist">${label}</span>
            <button title="Remove">&times;</button>
        `;
        div.querySelector('button').addEventListener('click', () => {
            state.markers.splice(i, 1);
            recalibrate();
            updateMarkerList();
            render();
        });
        markerList.appendChild(div);
    });
    btnClearMarkers.style.display = state.markers.length > 0 ? '' : 'none';
}

$('btn-clear-markers').addEventListener('click', () => {
    state.markers = [];
    recalibrate();
    updateMarkerList();
    render();
});

// ── Camera management ──
function addCamera(preset) {
    const cam = {
        ...preset,
        id: `cam-${state.nextCameraId++}`,
        visible: true,
        panOffset: 0, // horizontal aim offset in degrees (positive = right)
        tiltOffset: 0  // vertical aim offset in degrees (positive = up)
    };
    state.cameras.push(cam);
    updateCameraList();
    fitCanvas(); // re-fit to potentially expand canvas for wider FOV
}

function updateCameraList() {
    cameraListEl.innerHTML = '';
    state.cameras.forEach((cam, i) => {
        const div = document.createElement('div');
        div.className = 'camera-item';
        const hasPan = cam.panOffset !== 0;
        const hasTilt = cam.tiltOffset !== 0;
        const hasAim = hasPan || hasTilt;
        let aimLabel = '';
        if (hasAim) {
            const parts = [];
            if (hasPan) parts.push(`${cam.panOffset > 0 ? '+' : ''}${cam.panOffset.toFixed(0)}° H`);
            if (hasTilt) parts.push(`${cam.tiltOffset > 0 ? '+' : ''}${cam.tiltOffset.toFixed(0)}° V`);
            aimLabel = ` (${parts.join(', ')})`;
        }
        div.innerHTML = `
            <div class="swatch" style="background:${cam.color}"></div>
            <span class="cam-name" title="${cam.name}">${cam.name}${aimLabel}</span>
            <button class="cam-toggle ${cam.visible ? 'active' : ''}" title="Toggle visibility">
                ${cam.visible ? '&#9673;' : '&#9675;'}
            </button>
            <button class="cam-reset-pan" title="Reset aim" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:12px;padding:2px;${hasAim ? '' : 'display:none'}">↺</button>
            <button class="cam-delete" title="Remove">&times;</button>
        `;
        div.querySelector('.cam-toggle').addEventListener('click', () => {
            cam.visible = !cam.visible;
            updateCameraList();
            fitCanvas();
        });
        div.querySelector('.cam-reset-pan').addEventListener('click', () => {
            cam.panOffset = 0;
            cam.tiltOffset = 0;
            updateCameraList();
            fitCanvas();
        });
        div.querySelector('.cam-delete').addEventListener('click', () => {
            state.cameras.splice(i, 1);
            updateCameraList();
            fitCanvas();
        });
        cameraListEl.appendChild(div);
    });

    // Update preview camera selector
    const prevVal = selPreviewCam.value;
    selPreviewCam.innerHTML = '';
    if (state.cameras.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = 'No cameras added';
        opt.disabled = true;
        selPreviewCam.appendChild(opt);
    } else {
        state.cameras.forEach(cam => {
            const opt = document.createElement('option');
            opt.value = cam.id;
            opt.textContent = cam.name;
            opt.style.color = cam.color;
            if (cam.id === prevVal) opt.selected = true;
            selPreviewCam.appendChild(opt);
        });
        // If previous selection gone, select first
        if (!state.cameras.find(c => c.id === prevVal) && state.cameras.length > 0) {
            selPreviewCam.value = state.cameras[0].id;
        }
    }
}

selPreviewCam.addEventListener('change', render);

// ── Camera FOV dragging ──
overlayCanvas.addEventListener('mousedown', e => {
    if (state.mode !== 'idle') return;
    if (state.cameras.length === 0 || !state.photoLayout) return;

    // Check if clicking in a camera's FOV zone area — enable drag
    const { canvasX: x } = screenToCanvas(e.clientX, e.clientY);
    const activeCameras = state.cameras.filter(c => c.visible);
    if (activeCameras.length === 0) return;

    // Find which camera the user is likely trying to drag
    const photoW = state.photoLayout.photoW || state.photoLayout.width;
    const photoOffsetX = state.photoLayout.photoOffsetX || 0;
    let bestCam = null;
    let bestDist = Infinity;

    for (const cam of activeCameras) {
        const bounds = fovBounds(cam.hFov, state.phoneHFov, photoW, cam.panOffset || 0);
        const centerX = photoOffsetX + (bounds.left + bounds.right) / 2;
        const d = Math.abs(x - centerX);
        if (d < bestDist) {
            bestDist = d;
            bestCam = cam;
        }
    }

    if (bestCam) {
        const { canvasY: y } = screenToCanvas(e.clientX, e.clientY);
        state.mode = 'dragging-cam';
        state.draggingCamera = bestCam;
        state.dragStartX = x;
        state.dragStartY = y;
        state.dragStartPan = bestCam.panOffset;
        state.dragStartTilt = bestCam.tiltOffset;
        overlayCanvas.classList.add('drag-fov');
        e.preventDefault();
    }
});

overlayCanvas.addEventListener('mousemove', e => {
    if (state.mode === 'dragging-cam' && state.draggingCamera) {
        const { canvasX: x, canvasY: y } = screenToCanvas(e.clientX, e.clientY);
        const dx = x - state.dragStartX;
        const dy = y - state.dragStartY;

        const photoW = state.photoLayout.photoW || state.photoLayout.width;
        const photoH = state.photoLayout.photoH || state.photoLayout.height;

        // Horizontal: pan
        const hDegreesPerPixel = state.phoneHFov / photoW;
        const cam = state.draggingCamera;
        cam.panOffset = Math.max(-90, Math.min(90, state.dragStartPan + dx * hDegreesPerPixel));

        // Vertical: tilt (dragging up = positive tilt = camera points higher)
        const phoneVFov = 2 * Math.atan(Math.tan(state.phoneHFov * Math.PI / 360) * photoH / photoW) * 180 / Math.PI;
        const vDegreesPerPixel = phoneVFov / photoH;
        cam.tiltOffset = Math.max(-45, Math.min(45, state.dragStartTilt - dy * vDegreesPerPixel));

        render();
    }
});

function endDrag() {
    if (state.mode === 'dragging-cam') {
        state.mode = 'idle';
        state.draggingCamera = null;
        overlayCanvas.classList.remove('drag-fov');
        fitCanvas(); // re-fit in case pan changed expansion
    }
}

overlayCanvas.addEventListener('mouseup', endDrag);
overlayCanvas.addEventListener('mouseleave', endDrag);

// Preset picker
$('btn-add-preset').addEventListener('click', () => {
    const panel = $('panel-preset-picker');
    panel.style.display = '';
    const list = $('preset-list');
    list.innerHTML = '';
    CAMERA_PRESETS.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary btn-sm';
        btn.style.marginBottom = '4px';
        btn.style.textAlign = 'left';
        btn.textContent = `${p.name} (${p.hRes}x${p.vRes}, ${p.hFov}°)`;
        btn.addEventListener('click', () => {
            addCamera(p);
            panel.style.display = 'none';
        });
        list.appendChild(btn);
    });
});

$('btn-cancel-preset').addEventListener('click', () => {
    $('panel-preset-picker').style.display = 'none';
});

// Custom camera
const CUSTOM_COLORS = ['#a855f7', '#ec4899', '#06b6d4', '#84cc16', '#f43f5e', '#8b5cf6'];
let customColorIdx = 0;

$('btn-add-custom').addEventListener('click', () => {
    $('panel-custom-cam').style.display = '';
});

$('btn-cancel-custom').addEventListener('click', () => {
    $('panel-custom-cam').style.display = 'none';
});

$('btn-save-custom').addEventListener('click', () => {
    const cam = {
        name: $('cc-name').value || 'Custom Camera',
        hRes: parseInt($('cc-hres').value) || 2560,
        vRes: parseInt($('cc-vres').value) || 1440,
        hFov: parseFloat($('cc-hfov').value) || 90,
        vFov: parseFloat($('cc-vfov').value) || 50,
        focalLength: parseFloat($('cc-focal').value) || null,
        aperture: $('cc-aperture').value || '',
        sensorSize: $('cc-sensor').value || '',
        color: CUSTOM_COLORS[customColorIdx++ % CUSTOM_COLORS.length],
        notes: 'Custom'
    };
    addCamera(cam);
    $('panel-custom-cam').style.display = 'none';
});

// ── Display options ──
$('opt-ppf').addEventListener('change', e => { state.displayOptions.showPpf = e.target.checked; render(); });
$('opt-fov').addEventListener('change', e => { state.displayOptions.showFov = e.target.checked; render(); });
$('opt-ruler').addEventListener('change', e => { state.displayOptions.showRuler = e.target.checked; render(); });
$('opt-minimap').addEventListener('change', e => { state.displayOptions.showMiniMap = e.target.checked; render(); });

// ── Comparison modal ──
$('btn-compare').addEventListener('click', showComparisonModal);
$('btn-close-compare').addEventListener('click', () => $('modal-compare').classList.add('hidden'));
$('modal-compare').addEventListener('click', e => { if (e.target === $('modal-compare')) $('modal-compare').classList.add('hidden'); });

function showComparisonModal() {
    if (state.cameras.length === 0) return;
    const container = $('compare-table-container');

    const distances = [10, 25, 50, 75, 100, 150, 200];

    let html = '<table><thead><tr><th>Metric</th>';
    state.cameras.forEach(c => {
        html += `<th style="color:${c.color}">${c.name}</th>`;
    });
    html += '</tr></thead><tbody>';

    html += '<tr><td>Resolution</td>';
    state.cameras.forEach(c => html += `<td>${c.hRes} x ${c.vRes}</td>`);
    html += '</tr>';

    html += '<tr><td>Megapixels</td>';
    state.cameras.forEach(c => html += `<td>${((c.hRes * c.vRes) / 1e6).toFixed(1)} MP</td>`);
    html += '</tr>';

    // Lens config
    html += '<tr><td>Lens Config</td>';
    state.cameras.forEach(c => {
        if (c.numLenses && c.numLenses > 1) {
            html += `<td>${c.numLenses} lenses, ${c.perLensHRes}×${c.vRes} each, ${c.perLensHFov}° per lens</td>`;
        } else {
            html += '<td>Single lens</td>';
        }
    });
    html += '</tr>';

    html += '<tr><td>HFOV / VFOV</td>';
    state.cameras.forEach(c => html += `<td>${c.hFov}° / ${c.vFov}°</td>`);
    html += '</tr>';

    html += '<tr><td>Focal Length</td>';
    state.cameras.forEach(c => html += `<td>${c.focalLength ? c.focalLength + 'mm' : '—'}</td>`);
    html += '</tr>';

    html += '<tr><td>Aperture</td>';
    state.cameras.forEach(c => html += `<td>${c.aperture || '—'}</td>`);
    html += '</tr>';

    html += '<tr><td>Sensor Size</td>';
    state.cameras.forEach(c => html += `<td>${c.sensorSize || '—'}</td>`);
    html += '</tr>';

    html += '<tr><td colspan="100%" style="font-weight:600;padding-top:12px">Pixels Per Foot (PPF) — per lens</td></tr>';
    distances.forEach(d => {
        html += `<tr><td>@ ${d} ft</td>`;
        state.cameras.forEach(c => {
            const range = ppfRangeAtDistance(c, d);
            const ppf = ppfAtDistance(c, d);
            let cls = 'ppf-none';
            if (ppf >= 40) cls = 'ppf-id';
            else if (ppf >= 20) cls = 'ppf-rec';
            else if (ppf >= 10) cls = 'ppf-det';
            if (c.numLenses && c.numLenses > 1) {
                html += `<td class="${cls}">${range.min.toFixed(1)}–${range.max.toFixed(1)}</td>`;
            } else {
                html += `<td class="${cls}">${ppf.toFixed(1)}</td>`;
            }
        });
        html += '</tr>';
    });

    html += '<tr><td colspan="100%" style="font-weight:600;padding-top:12px">Effective Ranges <span style="font-weight:400;font-size:11px;color:var(--text-dim)">(conservative — lens center PPF)</span></td></tr>';
    PPF_ZONES.forEach(zone => {
        html += `<tr><td>${zone.label} (${zone.ppf} PPF)</td>`;
        state.cameras.forEach(c => {
            const d = distanceAtPpf(c, zone.ppf);
            html += `<td>${Math.round(d)} ft</td>`;
        });
        html += '</tr>';
    });

    html += '<tr><td>Photo Coverage</td>';
    state.cameras.forEach(c => {
        const bounds = fovBounds(c.hFov, state.phoneHFov, 100);
        if (bounds.type === 'wider') {
            html += `<td>Photo shows ${bounds.coveragePct.toFixed(0)}% of view</td>`;
        } else if (bounds.type === 'narrower') {
            html += `<td>Uses ${bounds.coveragePct.toFixed(0)}% of photo</td>`;
        } else {
            html += '<td>Matches photo</td>';
        }
    });
    html += '</tr>';

    html += '</tbody></table>';
    container.innerHTML = html;
    $('modal-compare').classList.remove('hidden');
}

// ── Camera Preview toggle ──
$('btn-preview-toggle').addEventListener('click', () => {
    const panel = $('panel-preview');
    if (panel.style.display === 'none') {
        panel.style.display = '';
        render();
    } else {
        panel.style.display = 'none';
    }
});
$('btn-close-preview').addEventListener('click', () => {
    $('panel-preview').style.display = 'none';
});

// ── Help modal ──
$('btn-help').addEventListener('click', () => $('modal-help').classList.remove('hidden'));
$('btn-close-help').addEventListener('click', () => $('modal-help').classList.add('hidden'));
$('modal-help').addEventListener('click', e => { if (e.target === $('modal-help')) $('modal-help').classList.add('hidden'); });

// ── Render ──
function render() {
    if (!state.photo || !state.photoLayout) return;
    renderOverlay(overlayCanvas, state);
    renderMiniMap(minimapCanvas, state);

    // Camera preview (only if visible)
    if ($('panel-preview').style.display !== 'none') {
        const previewCamId = selPreviewCam.value;
        const previewCam = state.cameras.find(c => c.id === previewCamId);
        const info = renderCameraPreview(previewCanvas, state, previewCam);
        if (info) {
            previewInfo.innerHTML = `${info.outputRes} &middot; ${info.aspect} &middot; ${info.projection} &middot; ${info.lenses}`;
        } else {
            previewInfo.innerHTML = '';
        }
    }
}

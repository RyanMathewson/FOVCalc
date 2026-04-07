/**
 * Perspective calibration and FOV/PPF calculations.
 *
 * Model: For a camera at height h looking out over flat ground,
 * the distance d at image row y follows: d = k / (y - yH)
 * where yH is the horizon pixel row and k is a constant.
 */

/**
 * Calibrate from 2+ distance markers.
 * @param {Array<{yPixel: number, distanceFt: number}>} markers
 * @returns {{yHorizon: number, k: number} | null}
 */
export function calibrate(markers) {
    if (markers.length < 2) return null;

    if (markers.length === 2) {
        const [m1, m2] = markers;
        const denom = m1.distanceFt - m2.distanceFt;
        if (Math.abs(denom) < 0.001) return null;

        const yH = (m1.distanceFt * m1.yPixel - m2.distanceFt * m2.yPixel) / denom;
        const k = m1.distanceFt * (m1.yPixel - yH);
        if (k <= 0) return null;
        return { yHorizon: yH, k };
    }

    // 3+ markers: least-squares on 1/d = (1/k)*y - yH/k
    // Let a = 1/k, b = -yH/k. Then 1/d = a*y + b
    let sumY = 0, sumInvD = 0, sumYY = 0, sumYInvD = 0;
    const n = markers.length;
    for (const m of markers) {
        const invD = 1 / m.distanceFt;
        sumY += m.yPixel;
        sumInvD += invD;
        sumYY += m.yPixel * m.yPixel;
        sumYInvD += m.yPixel * invD;
    }
    const det = n * sumYY - sumY * sumY;
    if (Math.abs(det) < 1e-10) return null;

    const a = (n * sumYInvD - sumY * sumInvD) / det;
    const b = (sumYY * sumInvD - sumY * sumYInvD) / det;

    if (Math.abs(a) < 1e-10) return null;
    const k = 1 / a;
    const yH = -b / a;
    if (k <= 0) return null;
    return { yHorizon: yH, k };
}

/**
 * Get distance (ft) at a pixel row.
 */
export function distanceAtRow(y, cal) {
    if (!cal) return null;
    const diff = y - cal.yHorizon;
    if (diff <= 0) return Infinity;
    return cal.k / diff;
}

/**
 * Get pixel row for a given distance (ft).
 */
export function rowAtDistance(d, cal) {
    if (!cal || d <= 0) return null;
    return cal.yHorizon + cal.k / d;
}

/**
 * Compute PPF at a given distance for a camera.
 *
 * For multi-lens cameras (e.g., dual-lens panoramic), PPF is calculated
 * per individual lens since only one lens covers any given point in the scene.
 * Returns the per-lens center PPF (most conservative/realistic estimate).
 *
 * For single-lens cameras, uses total resolution and FOV directly.
 */
export function ppfAtDistance(camera, distanceFt) {
    if (distanceFt <= 0) return Infinity;
    const lens = getLensParams(camera);
    const hFovRad = lens.hFov * Math.PI / 180;
    let width;
    if (lens.hFov >= 179) {
        width = 2 * distanceFt;
    } else {
        width = 2 * distanceFt * Math.tan(hFovRad / 2);
    }
    return lens.hRes / width;
}

/**
 * Compute PPF range at a given distance (min/max across the lens).
 * For rectilinear lenses, PPF increases toward the edges by 1/cos(θ).
 */
export function ppfRangeAtDistance(camera, distanceFt) {
    if (distanceFt <= 0) return { min: Infinity, max: Infinity, avg: Infinity };
    const lens = getLensParams(camera);
    const hFovRad = lens.hFov * Math.PI / 180;
    let width;
    if (lens.hFov >= 179) {
        width = 2 * distanceFt;
    } else {
        width = 2 * distanceFt * Math.tan(hFovRad / 2);
    }
    const centerPpf = lens.hRes / width;
    // Rectilinear lens: PPF at angle θ from center = centerPpf / cos(θ)
    // At the edge (θ = hFov/2), PPF is highest
    const edgeAngle = Math.min(lens.hFov / 2, 89) * Math.PI / 180;
    const edgePpf = centerPpf / Math.cos(edgeAngle);
    return { min: centerPpf, max: edgePpf, avg: (centerPpf + edgePpf) / 2 };
}

/**
 * Compute the distance at which a given PPF threshold is reached.
 * Uses per-lens center PPF (conservative — the lens center is the weakest point).
 */
export function distanceAtPpf(camera, targetPpf) {
    if (targetPpf <= 0) return Infinity;
    const lens = getLensParams(camera);
    if (lens.hFov >= 179) {
        return lens.hRes / (2 * targetPpf);
    }
    const hFovRad = lens.hFov * Math.PI / 180;
    return lens.hRes / (2 * targetPpf * Math.tan(hFovRad / 2));
}

/**
 * Get the effective single-lens parameters for PPF calculations.
 * For multi-lens cameras, returns per-lens specs.
 * For single-lens cameras, returns the camera's own specs.
 */
function getLensParams(camera) {
    if (camera.numLenses && camera.numLenses > 1 && camera.perLensHRes && camera.perLensHFov) {
        return { hRes: camera.perLensHRes, hFov: camera.perLensHFov };
    }
    return { hRes: camera.hRes, hFov: camera.hFov };
}

/**
 * PPF zone thresholds with labels and colors.
 */
export const PPF_ZONES = [
    { ppf: 40, label: 'Identification', color: 'rgba(34, 197, 94, 0.25)', border: 'rgba(34, 197, 94, 0.7)' },
    { ppf: 20, label: 'Recognition', color: 'rgba(234, 179, 8, 0.25)', border: 'rgba(234, 179, 8, 0.7)' },
    { ppf: 10, label: 'Detection', color: 'rgba(249, 115, 22, 0.25)', border: 'rgba(249, 115, 22, 0.7)' }
];

/**
 * Compute FOV bounds on the photo.
 * Returns how the camera's horizontal FOV maps onto the photo.
 * @param {number} panOffset - camera aim offset in degrees (positive = right)
 */
export function fovBounds(cameraHFov, phoneHFov, photoWidth, panOffset = 0) {
    if (cameraHFov >= 179 && phoneHFov >= 179 && Math.abs(panOffset) < 1) {
        return { type: 'match', left: 0, right: photoWidth, coveragePct: 100, panOffset };
    }

    const phoneHalf = Math.min(phoneHFov, 179) * Math.PI / 360;
    const phoneHalfTan = Math.tan(phoneHalf);

    // The photo maps the angular range [-phoneHFov/2, +phoneHFov/2] to [0, photoWidth].
    // A camera aimed with panOffset has its center at panOffset degrees from photo center.
    // Its edges are at panOffset ± cameraHFov/2 degrees.

    // Convert an angle (degrees from photo center) to pixel position on photo
    function angleToPx(angleDeg) {
        const angleRad = angleDeg * Math.PI / 180;
        // Using tangent projection (rectilinear)
        // Photo center is at photoWidth/2, and photoWidth/2 corresponds to tan(phoneHalf)
        return photoWidth / 2 + (Math.tan(angleRad) / phoneHalfTan) * (photoWidth / 2);
    }

    let leftAngle = panOffset - cameraHFov / 2;
    let rightAngle = panOffset + cameraHFov / 2;

    // Clamp to avoid tan() blowup near ±90°
    const clampAngle = Math.min(phoneHFov / 2, 89);
    const leftClamped = Math.max(leftAngle, -89);
    const rightClamped = Math.min(rightAngle, 89);

    let left, right;
    if (cameraHFov >= 179) {
        // For 180° cameras, use linear angle mapping (dewarped output)
        left = photoWidth / 2 + (leftAngle / (phoneHFov / 2)) * (photoWidth / 2);
        right = photoWidth / 2 + (rightAngle / (phoneHFov / 2)) * (photoWidth / 2);
    } else {
        left = angleToPx(leftClamped);
        right = angleToPx(rightClamped);
    }

    // Determine type
    const isNarrower = left >= 0 && right <= photoWidth;
    const isWider = left < 0 || right > photoWidth;

    let coveragePct;
    if (cameraHFov >= 179) {
        coveragePct = phoneHFov / cameraHFov * 100;
    } else {
        const camHalf = Math.min(cameraHFov, 179) * Math.PI / 360;
        coveragePct = Math.tan(phoneHalf) / Math.tan(camHalf) * 100;
    }

    const beyondLeft = Math.max(0, -leftAngle - phoneHFov / 2);
    const beyondRight = Math.max(0, rightAngle - phoneHFov / 2);

    if (isNarrower) {
        const fraction = (right - left) / photoWidth;
        return { type: 'narrower', left, right, fraction, coveragePct: fraction * 100, panOffset };
    }

    return { type: 'wider', left, right, coveragePct, beyondLeft, beyondRight, panOffset };
}

/**
 * Compute vertical FOV bounds on the photo.
 * Returns top/bottom pixel rows for a camera's vertical FOV with tilt offset.
 * @param {number} cameraVFov - camera vertical FOV in degrees
 * @param {number} phoneHFov - phone horizontal FOV in degrees
 * @param {number} photoWidth - photo width in pixels
 * @param {number} photoHeight - photo height in pixels
 * @param {number} tiltOffset - camera tilt in degrees (positive = up)
 */
export function vFovBounds(cameraVFov, phoneHFov, photoWidth, photoHeight, tiltOffset = 0) {
    // Compute the phone's vertical FOV from its HFOV and aspect ratio
    const phoneHHalfRad = Math.min(phoneHFov, 179) * Math.PI / 360;
    const phoneVHalfRad = Math.atan(Math.tan(phoneHHalfRad) * photoHeight / photoWidth);
    const phoneVHalfTan = Math.tan(phoneVHalfRad);

    // Convert a vertical angle (degrees from photo center, positive = up) to pixel row
    function angleToPx(angleDeg) {
        const angleRad = angleDeg * Math.PI / 180;
        // Positive angle = up = lower pixel row number
        return photoHeight / 2 - (Math.tan(angleRad) / phoneVHalfTan) * (photoHeight / 2);
    }

    const topAngle = tiltOffset + cameraVFov / 2;   // top edge of camera view
    const bottomAngle = tiltOffset - cameraVFov / 2; // bottom edge of camera view

    const topClamped = Math.min(topAngle, 89);
    const bottomClamped = Math.max(bottomAngle, -89);

    const top = angleToPx(topClamped);
    const bottom = angleToPx(bottomClamped);

    return { top, bottom, topAngle, bottomAngle, tiltOffset };
}

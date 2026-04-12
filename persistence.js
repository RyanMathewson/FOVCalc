const STORAGE_KEY = 'fovcalc_session';
const SCHEMA_VERSION = 1;

function serializeSession(state) {
    return {
        v: SCHEMA_VERSION,
        photoRotation: state.photoRotation,
        phoneModel: state.phoneModel,
        phoneZoom: state.phoneZoom,
        phoneHFov: state.phoneHFov,
        markers: state.markers,
        calibration: state.calibration,
        cameraHeight: state.cameraHeight,
        cameraHeightUnit: state.cameraHeightUnit,
        cameras: state.cameras,
        nextCameraId: state.nextCameraId,
        displayOptions: { ...state.displayOptions },
        viewport: { ...state.viewport }
    };
}

export function saveSession(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeSession(state)));
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
            console.warn('FOVCalc: localStorage quota exceeded, session not saved.');
        } else {
            throw e;
        }
    }
}

export function loadSession() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (data.v !== SCHEMA_VERSION) return null;
        return data;
    } catch {
        return null;
    }
}

export function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
}

// Export full project JSON including photo as JPEG data URL.
export function exportProject(state) {
    const session = serializeSession(state);
    if (state.photo) {
        const canvas = document.createElement('canvas');
        canvas.width = state.photo.naturalWidth;
        canvas.height = state.photo.naturalHeight;
        canvas.getContext('2d').drawImage(state.photo, 0, 0);
        session.photo = canvas.toDataURL('image/jpeg', 0.85);
    }
    return JSON.stringify(session, null, 2);
}

export function triggerDownload(jsonString, filename) {
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// Parse an imported JSON string. Returns { session, photoDataUrl } or throws.
export function parseImport(jsonString) {
    const data = JSON.parse(jsonString);
    if (data.v !== SCHEMA_VERSION) {
        throw new Error(`Unsupported project version: ${data.v ?? '(none)'}`);
    }
    const photoDataUrl = data.photo || null;
    const { photo, ...session } = data;
    return { session, photoDataUrl };
}

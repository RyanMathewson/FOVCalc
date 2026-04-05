export const CAMERA_PRESETS = [
    {
        id: 'duo-poe',
        name: 'Reolink Duo PoE',
        hRes: 4608,
        vRes: 1728,
        hFov: 180,
        vFov: 60,
        focalLength: 3.2,
        aperture: 'F/2.0',
        sensorSize: '1/2.7"',
        color: '#3b82f6',
        notes: '8MP dual-lens, IR 30m'
    },
    {
        id: 'duo-3-poe',
        name: 'Reolink Duo 3 PoE',
        hRes: 7680,
        vRes: 2160,
        hFov: 180,
        vFov: 55,
        focalLength: 2.8,
        aperture: 'F/1.6',
        sensorSize: '1/2.7"',
        color: '#22c55e',
        notes: '16MP dual-lens, IR 30m'
    },
    {
        id: 'duo-3v-poe-d',
        name: 'Reolink Duo 3V PoE-D',
        hRes: 7680,
        vRes: 2160,
        hFov: 180,
        vFov: 53,
        focalLength: 2.8,
        aperture: 'F/1.6',
        sensorSize: '1/2.8"',
        color: '#f97316',
        notes: '16MP dual-lens, IR 30m'
    }
];

export const PHONE_PRESETS = [
    {
        id: 'iphone-14',
        name: 'iPhone 14',
        lenses: [
            { zoom: '0.5x', label: '0.5x (Ultrawide)', hFov: 120 },
            { zoom: '1x', label: '1x (Main)', hFov: 75.4 }
        ]
    },
    {
        id: 'iphone-15-pro',
        name: 'iPhone 15 Pro',
        lenses: [
            { zoom: '0.5x', label: '0.5x (Ultrawide)', hFov: 120 },
            { zoom: '1x', label: '1x (Main)', hFov: 77 },
            { zoom: '2x', label: '2x (Telephoto)', hFov: 35 }
        ]
    },
    {
        id: 'iphone-16',
        name: 'iPhone 16',
        lenses: [
            { zoom: '0.5x', label: '0.5x (Ultrawide)', hFov: 120 },
            { zoom: '1x', label: '1x (Main)', hFov: 75.4 },
            { zoom: '2x', label: '2x (Telephoto)', hFov: 35 }
        ]
    },
    {
        id: 'galaxy-s24',
        name: 'Samsung Galaxy S24',
        lenses: [
            { zoom: '0.5x', label: '0.5x (Ultrawide)', hFov: 120 },
            { zoom: '1x', label: '1x (Main)', hFov: 80 },
            { zoom: '3x', label: '3x (Telephoto)', hFov: 23 }
        ]
    },
    {
        id: 'pixel-8',
        name: 'Google Pixel 8',
        lenses: [
            { zoom: '0.5x', label: '0.5x (Ultrawide)', hFov: 125.8 },
            { zoom: '1x', label: '1x (Main)', hFov: 78.6 },
            { zoom: '2x', label: '2x (Telephoto)', hFov: 38 }
        ]
    },
    {
        id: 'custom',
        name: 'Custom',
        lenses: [
            { zoom: 'custom', label: 'Custom FOV', hFov: 75 }
        ]
    }
];

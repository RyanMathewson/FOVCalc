# Security Camera FOV Calculator

A web-based tool for visualizing security camera field of view on real-world reference photos. Take a photo from where you plan to mount a camera, upload it, and see exactly what different cameras will capture — including pixel density zones that tell you at what distances you can identify, recognize, or detect people.

**[Try it live](https://ryanmathewson.github.io/FOVCalc/)** (GitHub Pages)

## How It Works

1. **Take a photo** from your intended camera mounting position using your phone (ultrawide/0.5x recommended for maximum coverage)
2. **Upload and configure** — select your phone model and lens to set the correct field of view
3. **Straighten the photo** using the rotation slider or by picking two points on the horizon
4. **Calibrate distances** by marking ground features at known distances from the camera base
5. **Add cameras** from presets or enter custom specs, then drag to aim them

## Features

- **Perspective-calibrated distance mapping** — mark ground points at known distances to build an accurate depth model
- **PPF (Pixels Per Foot) zone visualization** — color-coded bands show identification (40+ PPF), recognition (20-40 PPF), and detection (10-20 PPF) ranges
- **Horizontal and vertical FOV bounds** — see exactly what the camera captures, with dimmed regions outside its view
- **Draggable pan/tilt aiming** — click and drag on the photo to aim each camera and see how coverage shifts
- **Expanded canvas** — when a camera's FOV is wider than the phone photo, the view expands to show the full coverage area
- **Camera comparison table** — side-by-side specs, PPF at various distances, and effective range for each threshold
- **Top-down mini-map** — bird's-eye view showing each camera's full FOV arc, aim direction, and PPF zone rings
- **Photo straightening** — manual rotation slider or two-click horizon detection to level a tilted photo
- **Slope/elevation support** — optional elevation change per calibration marker for non-flat terrain
- **Preset cameras** — Reolink Duo PoE, Duo 3 PoE, and Duo 3V PoE-D included, plus custom camera entry

## PPF Zones Explained

Pixels Per Foot (PPF) measures how much detail a camera captures at a given distance:

| Zone | PPF | What You Can See |
|------|-----|------------------|
| Identification | 40+ | Identify unknown individuals — facial features clearly visible |
| Recognition | 20-40 | Recognize known people — general features and clothing visible |
| Detection | 10-20 | Detect presence — motion and shapes visible, no detail |

## Calibration Tips

- **Camera height**: Measure from the ground to the mounting point (e.g., 9 feet for a typical eave mount)
- **Ground distance markers**: Measure along the ground from directly below the camera to visible features (driveway edge, sidewalk, curb, fence). Use a tape measure or count known distances like driveway width
- **Between-points markers**: If you know the distance between two visible features (e.g., width of a sidewalk), use this mode — combined with at least one ground distance marker, it provides a second calibration reference
- **More markers = better accuracy**, especially if placed at varying distances (one near, one far)
- **For sloped ground**: Enter the elevation change when adding a marker (e.g., "ground is 3ft lower at the street")

## Built-in Camera Presets

| Camera | Resolution | HFOV | VFOV | Focal Length | Aperture |
|--------|-----------|------|------|-------------|----------|
| Reolink Duo PoE | 4608x1728 (8MP) | 180° | 60° | 3.2mm | F/2.0 |
| Reolink Duo 3 PoE | 7680x2160 (16MP) | 180° | 55° | 2.8mm | F/1.6 |
| Reolink Duo 3V PoE-D | 7680x2160 (16MP) | 180° | 53° | 2.8mm | F/1.6 |

## Running Locally

No build step required — just serve the static files:

```bash
# Python
python -m http.server 8080

# Node
npx serve .
```

Then open `http://localhost:8080`.

## Tech Stack

Pure HTML, CSS, and JavaScript — no frameworks, no dependencies, no build tools. ES modules for code organization. Runs entirely in the browser.

## License

MIT

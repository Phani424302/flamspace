# FlamSpace — Real-Time Collaborative Whiteboard

**Built for the FLAM AI Frontend R&D Assignment**  
*Track: Real-Time Collaborative Drawing Canvas & Real-Time Multiplayer Cursor/State Sync*

---

An enterprise-grade, FigJam/Miro-inspired real-time collaborative whiteboard built for modern interactive surfaces. Features an infinite pan/zoom canvas, smooth Bézier curve freehand drawing, live shapes, synchronized sticky notes, Figma-style live cursor chat, emoji reaction bursts, laser pointer presentations, undo/redo, and instant presence sync over WebSockets.

---

## Live Demo & Features

### 1. Infinite Viewport & Responsive Grid
- **Infinite Pan & Zoom:** Zoom smoothly from 20% to 400% centered around the mouse cursor (`Ctrl+Wheel` or trackpad pinch). Pan across the canvas with `Space + Drag` or Middle Mouse button.
- **Dynamic Coordinate System:** Transparent translation between screen space and infinite world coordinates.
- **Responsive Dot Grid:** Scales dynamically with zoom and pan to maintain visual grounding.

### 2. Pro Whiteboard Creation Suite
- **Smooth Pen & Highlighter:** Uses quadratic Bézier midpoint interpolation for natural, fluid curves without jagged edges.
- **Geometric Shapes:** Rectangles (with rounded corners), Circles/Ellipses, Lines, and Directional Arrows with live drag preview.
- **Collaborative Sticky Notes:** Real draggable sticky notes in vibrant pastel themes (Yellow, Coral, Mint, Sky, Lavender) with live synchronized text editing.
- **Laser Pointer:** Temporary glowing trail that fades over 1.2s — perfect for live remote presentations.
- **Eraser:** High-precision element and stroke eraser.
- **Undo / Redo:** Full `Ctrl+Z` / `Ctrl+Y` support with synced element state.

### 3. Next-Gen Collaborative R&D Features
- **Figma-Style Live Cursor Chat (`/`):** Press `/` to type a live message directly above your cursor. Every keystroke is broadcast to collaborators in real-time.
- **Live Emoji Reaction Bursts:** Send animated floating emoji reactions (🔥, ❤️, 🎉, 🚀, 👍) that burst and rise with physics-based particle animation.
- **Attention Radar Ping:** Double-click on the board to emit an expanding radar wave alerting all collaborators to "look here".
- **Collaborator Presence Stack:** Top navigation shows live avatars with custom initials, user colors, and active status indicators.
- **Procedural Audio (Web Audio API):** Subtle, pleasant UI sounds for clicks, sticky drops, and reactions (toggleable on/off).

### 4. Export & Multi-Room
- **High-Res PNG Export:** Exports a 2x retina-resolution PNG of the entire board.
- **JSON Save & Load:** Export the board state to a `.json` file or import existing boards.
- **Multi-Room Routing:** Rooms are partitioned via URL query (`?room=design-sprint`). Shareable with a single click.

---

## Tech Stack & Architecture

- **Frontend:** Vanilla HTML5 Canvas (multi-layer canvas architecture: Grid + Board + Draft + DOM + VFX) + Vanilla JavaScript + CSS Glassmorphism. Zero heavy frontend framework overhead — pure 60fps performance.
- **Backend:** Node.js, Express, Socket.io for low-latency WebSocket broadcasting with in-memory element history and presence management.
- **Audio:** Web Audio API (zero external audio files or bandwidth cost).

---

## Keyboard Shortcuts

| Key | Tool / Action |
| :--- | :--- |
| `V` | Select / Pan Mode |
| `P` | Smooth Pen |
| `H` | Highlighter |
| `E` | Eraser |
| `R` | Rectangle |
| `O` | Circle / Ellipse |
| `A` | Arrow |
| `L` | Line |
| `S` | Sticky Note |
| `X` | Laser Pointer |
| `/` | Live Cursor Chat |
| `Space + Drag` | Pan Canvas |
| `Ctrl + Wheel` / `+ -` | Zoom In / Out |
| `Ctrl + Z` / `Ctrl + Y` | Undo / Redo |
| `?` | Show Shortcuts Cheat Sheet |

---

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000/?room=demo` in two different browser windows side-by-side to experience multiplayer synchronization.

---

## Deploy to the Web (Free on Render)

1. Push this repository to GitHub:
   ```bash
   git init
   git add .
   git commit -m "feat: FlamSpace collaborative whiteboard for FLAM AI R&D"
   git branch -M main
   git remote add origin https://github.com/<your-username>/flamspace.git
   git push -u origin main
   ```
2. Go to [Render.com](https://render.com) and click **New +** &rarr; **Web Service**.
3. Select your GitHub repository (`flamspace`).
4. Set:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Click **Deploy**. Render will generate a public HTTPS URL (e.g. `https://flamspace.onrender.com/?room=demo`).

---

## Candidate Information

- **Candidate Name:** Chennamareddygari Phani Bhushan Reddy (C. Phani Bhushan Reddy)
- **Email:** phani424302@gmail.com
- **Institution:** Vellore Institute of Technology (VIT-AP)
- **Role Applied:** Frontend R&D Engineer — FLAM AI
- **Assignment Track:** Real-Time Collaborative Drawing Canvas & Real-Time Multiplayer Cursor/State Sync
- **Repository:** `flamspace`

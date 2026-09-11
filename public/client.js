(() => {
  'use strict';

  // ---------- Room & URL Resolution ----------
  const params = new URLSearchParams(window.location.search);
  const urlRoom = (params.get('room') || '').trim();
  const sessionRoom = sessionStorage.getItem('flamspace_active_room');
  let isJoined = !!(sessionRoom && (!urlRoom || sessionRoom === urlRoom));
  let roomId = isJoined ? sessionRoom : (urlRoom || '');

  // ---------- DOM Elements ----------
  const gridCanvas = document.getElementById('gridCanvas');
  const board = document.getElementById('board');
  const draftLayer = document.getElementById('draftLayer');
  const domLayer = document.getElementById('domLayer');
  const cursorLayer = document.getElementById('cursorLayer');

  const gctx = gridCanvas.getContext('2d');
  const bctx = board.getContext('2d');
  const dctx = draftLayer.getContext('2d');
  const cctx = cursorLayer.getContext('2d');

  const connStatus = document.getElementById('connStatus');
  const roomInput = document.getElementById('roomInput');
  const roomCopyBtn = document.getElementById('roomCopyBtn');
  const switchRoomBtn = document.getElementById('switchRoomBtn');
  const presenceStack = document.getElementById('presenceStack');
  const sfxToggleBtn = document.getElementById('sfxToggleBtn');
  const shortcutsBtn = document.getElementById('shortcutsBtn');
  const shortcutsModal = document.getElementById('shortcutsModal');
  const closeShortcutsBtn = document.getElementById('closeShortcutsBtn');
  const exportMenuBtn = document.getElementById('exportMenuBtn');
  const exportDropdown = document.getElementById('exportDropdown');
  const exportPngBtn = document.getElementById('exportPngBtn');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const importJsonInput = document.getElementById('importJsonInput');
  const clearBoardBtn = document.getElementById('clearBoardBtn');
  const toastEl = document.getElementById('toast');

  const mainDock = document.getElementById('mainDock');
  const shapesTriggerBtn = document.getElementById('shapesTriggerBtn');
  const shapesPalettePopover = document.getElementById('shapesPalettePopover');
  const currentShapeIcon = document.getElementById('currentShapeIcon');

  const colorTriggerBtn = document.getElementById('colorTriggerBtn');
  const currentColorDot = document.getElementById('currentColorDot');
  const colorPalettePopover = document.getElementById('colorPalettePopover');
  const colorGrid = document.getElementById('colorGrid');

  const reactionsTriggerBtn = document.getElementById('reactionsTriggerBtn');
  const reactionsPalettePopover = document.getElementById('reactionsPalettePopover');
  const cursorChatBtn = document.getElementById('cursorChatBtn');
  const cursorChatBubble = document.getElementById('cursorChatBubble');
  const cursorChatInput = document.getElementById('cursorChatInput');
  const reactionsStrip = document.getElementById('reactionsStrip');

  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');

  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomLevelText = document.getElementById('zoomLevelText');
  const fitViewBtn = document.getElementById('fitViewBtn');

  roomInput.value = roomId;

  // ---------- Modern Color Palette ----------
  const PALETTE = [
    '#6366F1', // Indigo
    '#38BDF8', // Sky
    '#10B981', // Emerald
    '#F59E0B', // Amber
    '#EF4444', // Red
    '#EC4899', // Pink
    '#A855F7', // Purple
    '#F3F4F6'  // White/Light Gray
  ];

  // ---------- State ----------
  let currentTool = 'select'; // 'select', 'pen', 'highlighter', 'eraser', 'rect', 'circle', 'arrow', 'line', 'sticky', 'text', 'laser'
  let currentColor = PALETTE[0];
  let currentSize = 3;
  let sfxEnabled = true;

  // Infinite Viewport state
  let panX = 0;
  let panY = 0;
  let zoom = 1.0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let spacePressed = false;

  // Canvas dimensions
  let cssW = window.innerWidth;
  let cssH = window.innerHeight;
  let dpr = window.devicePixelRatio || 1;

  // Collaborative Data Model
  let elements = []; // All persistent whiteboard elements
  let redoStack = []; // Local redo stack
  let users = {};
  let me = null;
  const remoteCursors = {}; // userId -> { x, y, color, name, initials, chatText, lastSeen }
  const laserTrails = []; // { points, timestamp, color }
  const radarPings = []; // { x, y, color, radius, opacity, startTime }
  const reactionParticles = []; // { emoji, x, y, vx, vy, opacity, scale }

  // Active interaction state
  let isPointerDown = false;
  let startWorldPoint = null;
  let currentStroke = null;

  // ---------- Sound Synthesizer (Web Audio API) ----------
  let audioCtx = null;
  function playSound(type) {
    if (!sfxEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const now = audioCtx.currentTime;

      if (type === 'click') {
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.05);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'pop') {
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(640, now + 0.08);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === 'reaction') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.exponentialRampToValueAtTime(1046.5, now + 0.15);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      }
    } catch (e) {}
  }

  // ---------- Coordinate Transforms ----------
  function screenToWorld(sx, sy) {
    return {
      x: (sx - panX) / zoom,
      y: (sy - panY) / zoom
    };
  }

  function worldToScreen(wx, wy) {
    return {
      x: wx * zoom + panX,
      y: wy * zoom + panY
    };
  }

  // ---------- Canvas Resizing ----------
  function resizeAll() {
    dpr = window.devicePixelRatio || 1;
    cssW = window.innerWidth;
    cssH = window.innerHeight;

    [gridCanvas, board, draftLayer, cursorLayer].forEach(c => {
      c.width = cssW * dpr;
      c.height = cssH * dpr;
      c.style.width = cssW + 'px';
      c.style.height = cssH + 'px';
    });

    drawGrid();
    redrawAll();
  }

  // ---------- Subtle Responsive Grid Canvas ----------
  function drawGrid() {
    gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gctx.clearRect(0, 0, cssW, cssH);

    const gridSize = 28 * zoom;
    if (gridSize < 10) return; // Too small to render cleanly

    const offsetX = (panX % gridSize + gridSize) % gridSize;
    const offsetY = (panY % gridSize + gridSize) % gridSize;

    gctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    for (let x = offsetX; x < cssW; x += gridSize) {
      for (let y = offsetY; y < cssH; y += gridSize) {
        gctx.beginPath();
        gctx.arc(x, y, 1.2, 0, Math.PI * 2);
        gctx.fill();
      }
    }
  }

  // ---------- Whiteboard Rendering Engine ----------
  function redrawAll() {
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.clearRect(0, 0, cssW, cssH);

    // Apply World Camera Transform
    bctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY);

    // Draw all whiteboard elements in chronological order
    for (const el of elements) {
      drawElement(el, bctx);
    }

    // Sync DOM elements position (Sticky notes & text)
    updateDomOverlays();
  }

  function drawElement(el, ctx) {
    ctx.save();

    if (el.type === 'stroke') {
      if (!el.points || el.points.length === 0) return;
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (el.isHighlighter) {
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = el.size * 2.8;
      }

      ctx.beginPath();
      if (el.points.length === 1) {
        ctx.arc(el.points[0].x, el.points[0].y, el.size / 2, 0, Math.PI * 2);
        ctx.fillStyle = el.color;
        ctx.fill();
      } else {
        // Midpoint Quadratic Curve Smoothing
        ctx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length - 1; i++) {
          const midX = (el.points[i].x + el.points[i + 1].x) / 2;
          const midY = (el.points[i].y + el.points[i + 1].y) / 2;
          ctx.quadraticCurveTo(el.points[i].x, el.points[i].y, midX, midY);
        }
        const last = el.points[el.points.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      }
    } else if (el.type === 'shape') {
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.size || 3;
      ctx.fillStyle = el.color + '1A'; // 10% translucent fill

      const x = Math.min(el.x, el.x + el.w);
      const y = Math.min(el.y, el.y + el.h);
      const w = Math.abs(el.w);
      const h = Math.abs(el.h);

      if (el.shapeType === 'rect') {
        const radius = Math.min(8, w / 2, h / 2);
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, radius);
        ctx.fill();
        ctx.stroke();
      } else if (el.shapeType === 'circle') {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (el.shapeType === 'line') {
        ctx.beginPath();
        ctx.moveTo(el.x, el.y);
        ctx.lineTo(el.x + el.w, el.y + el.h);
        ctx.stroke();
      } else if (el.shapeType === 'arrow') {
        drawArrow(ctx, el.x, el.y, el.x + el.w, el.y + el.h, el.size || 3);
      }
    } else if (el.type === 'text') {
      if (el.text) {
        ctx.fillStyle = el.color || '#FFFFFF';
        const size = el.fontSize || 20;
        ctx.font = `600 ${size}px 'Plus Jakarta Sans', sans-serif`;
        const lines = el.text.split('\n');
        lines.forEach((line, i) => {
          ctx.fillText(line, el.x, el.y + (i + 1) * size * 1.25);
        });
      }
    }

    ctx.restore();
  }

  function drawArrow(ctx, fromx, fromy, tox, toy, width) {
    const headlen = Math.max(12, width * 3);
    const angle = Math.atan2(toy - fromy, tox - fromx);

    ctx.beginPath();
    ctx.moveTo(fromx, fromy);
    ctx.lineTo(tox, toy);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tox, toy);
    ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }

  // ---------- Draft Layer (Live Drag Preview) ----------
  function drawDraftShape(shapeType, startW, currentW) {
    dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dctx.clearRect(0, 0, cssW, cssH);
    dctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY);

    const draftEl = {
      type: 'shape',
      shapeType,
      x: startW.x,
      y: startW.y,
      w: currentW.x - startW.x,
      h: currentW.y - startW.y,
      color: currentColor,
      size: currentSize
    };
    drawElement(draftEl, dctx);
  }

  function clearDraft() {
    dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dctx.clearRect(0, 0, cssW, cssH);
  }

  // ---------- DOM Overlays (Sticky Notes & Freeform Text) ----------
  const stickyDoms = new Map(); // id -> HTMLElement
  const textDoms = new Map();   // id -> HTMLElement

  function updateDomOverlays() {
    elements.forEach(el => {
      if (el.type === 'sticky') {
        let node = stickyDoms.get(el.id);
        if (!node) {
          node = createStickyDom(el);
          domLayer.appendChild(node);
          stickyDoms.set(el.id, node);
        }
        const screenPos = worldToScreen(el.x, el.y);
        node.style.left = `${screenPos.x}px`;
        node.style.top = `${screenPos.y}px`;
        node.style.transform = `scale(${zoom})`;
        node.style.transformOrigin = 'top left';

        const textarea = node.querySelector('textarea');
        if (textarea && textarea !== document.activeElement && textarea.value !== el.text) {
          textarea.value = el.text || '';
        }
      } else if (el.type === 'text') {
        let node = textDoms.get(el.id);
        if (!node) {
          node = createTextDom(el);
          domLayer.appendChild(node);
          textDoms.set(el.id, node);
        }
        const screenPos = worldToScreen(el.x, el.y);
        node.style.left = `${screenPos.x}px`;
        node.style.top = `${screenPos.y}px`;
        node.style.transform = `scale(${zoom})`;
        node.style.transformOrigin = 'top left';

        const input = node.querySelector('.board-text-input');
        if (input && input !== document.activeElement && input.innerText !== el.text) {
          input.innerText = el.text || '';
        }
        if (input) {
          input.style.color = el.color || currentColor;
          input.style.fontSize = `${el.fontSize || 20}px`;
        }
      }
    });

    // Remove deleted stickies from DOM
    for (const [id, node] of stickyDoms.entries()) {
      if (!elements.some(e => e.id === id)) {
        node.remove();
        stickyDoms.delete(id);
      }
    }

    // Remove deleted text elements from DOM
    for (const [id, node] of textDoms.entries()) {
      if (!elements.some(e => e.id === id)) {
        node.remove();
        textDoms.delete(id);
      }
    }
  }

  function createTextDom(el) {
    const box = document.createElement('div');
    box.className = 'board-text-box';
    box.dataset.id = el.id;

    box.innerHTML = `
      <div class="board-text-drag-handle" title="Drag to move text">⠿</div>
      <div class="board-text-input" contenteditable="true" spellcheck="false" data-placeholder="Type text...">${el.text || ''}</div>
      <button class="board-text-btn-delete" title="Delete text">&times;</button>
    `;

    const input = box.querySelector('.board-text-input');
    input.style.color = el.color || currentColor;
    input.style.fontSize = `${el.fontSize || 20}px`;

    input.addEventListener('focus', () => box.classList.add('is-focused'));
    input.addEventListener('blur', () => box.classList.remove('is-focused'));

    let textSyncTimeout = null;
    input.addEventListener('input', () => {
      el.text = input.innerText;
      clearTimeout(textSyncTimeout);
      textSyncTimeout = setTimeout(() => {
        socket.emit('element:update', { id: el.id, text: el.text });
      }, 200);
    });

    const handle = box.querySelector('.board-text-drag-handle');
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let originalElX = 0, originalElY = 0;

    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      isDragging = true;
      box.classList.add('is-dragging');
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      originalElX = el.x;
      originalElY = el.y;
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = (e.clientX - dragStartX) / zoom;
      const dy = (e.clientY - dragStartY) / zoom;
      el.x = originalElX + dx;
      el.y = originalElY + dy;
      updateDomOverlays();
    });

    const finishTextDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      box.classList.remove('is-dragging');
      socket.emit('element:update', { id: el.id, x: el.x, y: el.y });
    };

    handle.addEventListener('pointerup', finishTextDrag);
    handle.addEventListener('pointercancel', finishTextDrag);

    const textDeleteBtn = box.querySelector('.board-text-btn-delete');
    ['pointerdown', 'mousedown', 'pointerup'].forEach(evt => {
      textDeleteBtn.addEventListener(evt, (e) => e.stopPropagation());
    });

    const deleteTextBox = (e) => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      box.remove();
      textDoms.delete(el.id);
      elements = elements.filter(item => item.id !== el.id);
      redrawAll();
      socket.emit('element:delete', el.id);
      playSound('pop');
    };

    textDeleteBtn.addEventListener('click', deleteTextBox);

    return box;
  }

  const STICKY_THEMES = ['yellow', 'coral', 'mint', 'sky', 'lavender'];

  function createStickyDom(el) {
    const card = document.createElement('div');
    const theme = el.theme || 'yellow';
    card.className = `sticky-note sticky-note--${theme}`;
    card.dataset.id = el.id;

    const authorName = el.author || 'Collaborator';

    card.innerHTML = `
      <div class="sticky-header">
        <span class="sticky-author">${authorName}</span>
        <div class="sticky-actions">
          <button class="sticky-btn-delete" title="Delete note">&times;</button>
        </div>
      </div>
      <textarea class="sticky-textarea" placeholder="Write thoughts here...">${el.text || ''}</textarea>
    `;

    // Sticky dragging
    const header = card.querySelector('.sticky-header');
    let isDraggingSticky = false;
    let dragStartX = 0, dragStartY = 0;
    let originalElX = 0, originalElY = 0;

    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.sticky-actions') || e.target.closest('.sticky-btn-delete')) {
        return;
      }
      e.stopPropagation();
      isDraggingSticky = true;
      card.classList.add('is-dragging');
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      originalElX = el.x;
      originalElY = el.y;
      header.setPointerCapture(e.pointerId);
    });

    header.addEventListener('pointermove', (e) => {
      if (!isDraggingSticky) return;
      const dx = (e.clientX - dragStartX) / zoom;
      const dy = (e.clientY - dragStartY) / zoom;
      el.x = originalElX + dx;
      el.y = originalElY + dy;
      updateDomOverlays();
    });

    const finishStickyDrag = () => {
      if (!isDraggingSticky) return;
      isDraggingSticky = false;
      card.classList.remove('is-dragging');
      socket.emit('element:update', { id: el.id, x: el.x, y: el.y });
    };

    header.addEventListener('pointerup', finishStickyDrag);
    header.addEventListener('pointercancel', finishStickyDrag);

    // Text editing sync
    const textarea = card.querySelector('.sticky-textarea');
    let textSyncTimeout = null;
    textarea.addEventListener('input', () => {
      el.text = textarea.value;
      clearTimeout(textSyncTimeout);
      textSyncTimeout = setTimeout(() => {
        socket.emit('element:update', { id: el.id, text: el.text });
      }, 200);
    });

    // Delete note
    const deleteBtn = card.querySelector('.sticky-btn-delete');
    ['pointerdown', 'mousedown', 'pointerup'].forEach(evt => {
      deleteBtn.addEventListener(evt, (e) => e.stopPropagation());
    });

    const deleteSticky = (e) => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      card.remove();
      stickyDoms.delete(el.id);
      elements = elements.filter(item => item.id !== el.id);
      redrawAll();
      socket.emit('element:delete', el.id);
      playSound('pop');
    };

    deleteBtn.addEventListener('click', deleteSticky);

    return card;
  }

  // ---------- User Profile & Entry Modal Management ----------
  const welcomeModal = document.getElementById('welcomeModal');
  const closeWelcomeBtn = document.getElementById('closeWelcomeBtn');
  const welcomeNameInput = document.getElementById('welcomeNameInput');
  const welcomeColorGrid = document.getElementById('welcomeColorGrid');
  const tabCreateRoom = document.getElementById('tabCreateRoom');
  const tabJoinRoom = document.getElementById('tabJoinRoom');
  const paneCreateRoom = document.getElementById('paneCreateRoom');
  const paneJoinRoom = document.getElementById('paneJoinRoom');
  const welcomeNewRoomCode = document.getElementById('welcomeNewRoomCode');
  const regenRoomBtn = document.getElementById('regenRoomBtn');
  const welcomeCreateBtn = document.getElementById('welcomeCreateBtn');
  const welcomeJoinInput = document.getElementById('welcomeJoinInput');
  const welcomeJoinNotice = document.getElementById('welcomeJoinNotice');
  const welcomeJoinBtn = document.getElementById('welcomeJoinBtn');

  const profileModal = document.getElementById('profileModal');
  const profileNameInput = document.getElementById('profileNameInput');
  const profileColorGrid = document.getElementById('profileColorGrid');
  const closeProfileBtn = document.getElementById('closeProfileBtn');
  const cancelProfileBtn = document.getElementById('cancelProfileBtn');
  const saveProfileBtn = document.getElementById('saveProfileBtn');

  let myProfile = null;
  try {
    myProfile = JSON.parse(localStorage.getItem('flamspace_profile'));
  } catch (e) {}

  let selectedColor = (myProfile && myProfile.color) || PALETTE[Math.floor(Math.random() * PALETTE.length)];
  let activeEntryTab = urlRoom ? 'join' : 'create';
  let generatedRoomCode = Math.random().toString(36).slice(2, 8);

  function renderColorOptions(container, activeColor, onSelect) {
    if (!container) return;
    container.innerHTML = '';
    PALETTE.forEach(c => {
      const dot = document.createElement('button');
      dot.className = `profile-color-dot ${c === activeColor ? 'is-active' : ''}`;
      dot.style.backgroundColor = c;
      dot.addEventListener('click', (e) => {
        e.preventDefault();
        container.querySelectorAll('.profile-color-dot').forEach(d => d.classList.remove('is-active'));
        dot.classList.add('is-active');
        onSelect(c);
      });
      container.appendChild(dot);
    });
  }

  function setEntryTab(tab) {
    activeEntryTab = tab;
    if (tab === 'create') {
      tabCreateRoom.classList.add('is-active');
      tabJoinRoom.classList.remove('is-active');
      paneCreateRoom.classList.remove('hidden');
      paneJoinRoom.classList.add('hidden');
    } else {
      tabJoinRoom.classList.add('is-active');
      tabCreateRoom.classList.remove('is-active');
      paneJoinRoom.classList.remove('hidden');
      paneCreateRoom.classList.add('hidden');
      setTimeout(() => welcomeJoinInput.focus(), 60);
    }
  }

  tabCreateRoom.addEventListener('click', () => setEntryTab('create'));
  tabJoinRoom.addEventListener('click', () => setEntryTab('join'));

  function refreshGeneratedCode() {
    generatedRoomCode = Math.random().toString(36).slice(2, 8);
    if (welcomeNewRoomCode) welcomeNewRoomCode.textContent = generatedRoomCode;
  }
  refreshGeneratedCode();

  if (regenRoomBtn) {
    regenRoomBtn.addEventListener('click', () => {
      refreshGeneratedCode();
      playSound('click');
    });
  }

  function enterRoom(targetRoomId) {
    const rawCode = (targetRoomId || '').trim();
    if (!rawCode) {
      showToast('Please enter a valid room code');
      return;
    }
    const safeRoomId = rawCode.slice(0, 64);
    const chosenName = welcomeNameInput.value.trim() || (myProfile && myProfile.name) || 'Collaborator';

    myProfile = { name: chosenName, color: selectedColor };
    localStorage.setItem('flamspace_profile', JSON.stringify(myProfile));
    sessionStorage.setItem('flamspace_active_room', safeRoomId);

    roomId = safeRoomId;
    isJoined = true;
    roomInput.value = safeRoomId;

    // Update URL query string
    const url = new URL(window.location.href);
    url.searchParams.set('room', safeRoomId);
    window.history.replaceState({}, '', url);

    welcomeModal.classList.add('hidden');

    // Emit room:join if socket is ready
    if (socket.connected) {
      socket.emit('room:join', { roomId: safeRoomId, name: chosenName, color: selectedColor });
    }
    showToast(`Joined room: ${safeRoomId}`);
  }

  welcomeCreateBtn.addEventListener('click', () => {
    enterRoom(generatedRoomCode);
  });

  welcomeJoinBtn.addEventListener('click', () => {
    const code = welcomeJoinInput.value.trim();
    if (!code) {
      welcomeJoinInput.focus();
      showToast("Please enter your friend's room code");
      return;
    }
    enterRoom(code);
  });

  welcomeJoinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      welcomeJoinBtn.click();
    }
  });

  welcomeNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (activeEntryTab === 'create') {
        welcomeCreateBtn.click();
      } else {
        if (welcomeJoinInput.value.trim()) {
          welcomeJoinBtn.click();
        } else {
          welcomeJoinInput.focus();
        }
      }
    }
  });

  function openWelcomeModal(canClose = false) {
    welcomeModal.classList.remove('hidden');
    if (canClose && isJoined) {
      closeWelcomeBtn.classList.remove('hidden');
    } else {
      closeWelcomeBtn.classList.add('hidden');
    }

    refreshGeneratedCode();
    welcomeNameInput.value = (myProfile && myProfile.name) || '';
    renderColorOptions(welcomeColorGrid, selectedColor, (c) => { selectedColor = c; });

    if (urlRoom) {
      setEntryTab('join');
      welcomeJoinInput.value = urlRoom;
      welcomeJoinNotice.style.display = 'block';
      welcomeJoinNotice.textContent = `Joining room from invite: "${urlRoom}"`;
    } else {
      setEntryTab('create');
      welcomeJoinNotice.style.display = 'none';
    }

    setTimeout(() => {
      if (!welcomeNameInput.value) welcomeNameInput.focus();
      else if (activeEntryTab === 'join') welcomeJoinInput.focus();
    }, 80);
  }

  closeWelcomeBtn.addEventListener('click', () => {
    if (isJoined) welcomeModal.classList.add('hidden');
  });

  if (switchRoomBtn) {
    switchRoomBtn.addEventListener('click', () => openWelcomeModal(true));
  }

  // Display entry modal whenever visiting until joined in this tab
  if (!isJoined) {
    openWelcomeModal(false);
  } else {
    roomInput.value = roomId;
  }

  // Profile Modal logic (open when clicking own avatar in top bar)
  function openProfileModal() {
    profileModal.classList.remove('hidden');
    profileNameInput.value = (me && me.name) || (myProfile && myProfile.name) || '';
    let editColor = (me && me.color) || selectedColor;
    renderColorOptions(profileColorGrid, editColor, (c) => { editColor = c; });
    setTimeout(() => profileNameInput.focus(), 50);

    const saveProfile = () => {
      const newName = profileNameInput.value.trim() || (me ? me.name : 'Collaborator');
      selectedColor = editColor;
      myProfile = { name: newName, color: editColor };
      localStorage.setItem('flamspace_profile', JSON.stringify(myProfile));
      if (me) {
        me.name = newName;
        me.color = editColor;
        me.initials = newName.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'U';
        users[me.id] = { ...users[me.id], name: newName, color: editColor, initials: me.initials };
      }
      socket.emit('user:update', { name: newName, color: editColor });
      profileModal.classList.add('hidden');
      renderPresence();
      showToast('Profile updated!');
    };

    saveProfileBtn.onclick = saveProfile;
    profileNameInput.onkeydown = (e) => {
      if (e.key === 'Enter') saveProfile();
    };
  }

  closeProfileBtn.addEventListener('click', () => profileModal.classList.add('hidden'));
  cancelProfileBtn.addEventListener('click', () => profileModal.classList.add('hidden'));
  profileModal.addEventListener('click', (e) => {
    if (e.target === profileModal) profileModal.classList.add('hidden');
  });

  // ---------- Socket.IO Multiplayer Architecture ----------
  const socket = io();

  function setStatus(state, text) {
    connStatus.dataset.state = state;
    connStatus.querySelector('.brand__statusText').textContent = text;
  }

  socket.on('connect', () => {
    setStatus('online', 'live');
    if (isJoined && roomId) {
      const name = (myProfile && myProfile.name) || 'Collaborator';
      socket.emit('room:join', { roomId, name, color: selectedColor });
    }
  });

  socket.on('disconnect', () => {
    setStatus('connecting', 'reconnecting');
  });

  socket.on('room:init', (data) => {
    elements = data.elements || [];
    me = data.me;
    users = {};
    (data.users || []).forEach(u => { users[u.id] = u; });
    renderPresence();
    redrawAll();
  });

  socket.on('element:add', (el) => {
    elements.push(el);
    redrawAll();
    playSound('click');
  });

  socket.on('element:update', (updated) => {
    const idx = elements.findIndex(e => e.id === updated.id);
    if (idx !== -1) {
      elements[idx] = { ...elements[idx], ...updated };
      redrawAll();
    }
  });

  socket.on('element:delete', (elementId) => {
    elements = elements.filter(e => e.id !== elementId);
    redrawAll();
  });

  socket.on('board:imported', (imported) => {
    elements = imported;
    redrawAll();
    showToast('Board state imported successfully');
  });

  socket.on('canvas:clear', () => {
    elements = [];
    redrawAll();
    showToast('Board cleared by collaborator');
  });

  socket.on('user:list', (list) => {
    users = {};
    list.forEach(u => { users[u.id] = u; });
    renderPresence();
  });

  socket.on('user:left', (id) => {
    delete remoteCursors[id];
  });

  socket.on('cursor:move', (data) => {
    const u = users[data.userId];
    remoteCursors[data.userId] = {
      x: data.x,
      y: data.y,
      color: u ? u.color : '#6366F1',
      name: u ? u.name : 'Collaborator',
      initials: u ? u.initials : 'C',
      chatText: data.chatText || '',
      lastSeen: performance.now()
    };
  });

  socket.on('reaction:emit', (r) => {
    spawnReaction(r.emoji, r.x, r.y);
    playSound('reaction');
  });

  socket.on('radar:ping', (coord) => {
    radarPings.push({
      x: coord.x,
      y: coord.y,
      color: coord.color || '#6366F1',
      radius: 5,
      opacity: 1,
      startTime: performance.now()
    });
    playSound('pop');
  });

  socket.on('laser:trail', (trail) => {
    laserTrails.push({
      points: trail.points,
      timestamp: performance.now(),
      color: '#EF4444'
    });
  });

  // ---------- Presence Avatars Stack ----------
  function renderPresence() {
    presenceStack.innerHTML = '';
    const userEntries = Object.entries(users);

    userEntries.slice(0, 5).forEach(([id, u]) => {
      const isMe = (me && id === me.id);
      const av = document.createElement('div');
      av.className = `presence-avatar ${isMe ? 'presence-avatar--me' : ''}`;
      av.style.backgroundColor = u.color;
      av.textContent = u.initials || u.name.slice(0, 2);
      av.title = isMe ? `${u.name} (You) — Click to edit profile` : u.name;
      if (isMe) {
        av.style.cursor = 'pointer';
        av.addEventListener('click', openProfileModal);
      }
      presenceStack.appendChild(av);
    });

    if (userEntries.length > 5) {
      const more = document.createElement('div');
      more.className = 'presence-avatar';
      more.style.backgroundColor = '#374151';
      more.textContent = `+${userEntries.length - 5}`;
      more.title = `${userEntries.length} collaborators online`;
      presenceStack.appendChild(more);
    }
  }

  // ---------- Input & Drawing Handling ----------
  board.addEventListener('pointerdown', (e) => {
    if (e.button === 1 || spacePressed || currentTool === 'select') {
      // Pan mode
      isPanning = true;
      panStartX = e.clientX - panX;
      panStartY = e.clientY - panY;
      document.body.classList.add('is-panning-active');
      return;
    }

    if (e.button !== 0) return;
    isPointerDown = true;
    const worldP = screenToWorld(e.clientX, e.clientY);
    startWorldPoint = worldP;

    if (currentTool === 'pen' || currentTool === 'highlighter') {
      currentStroke = {
        id: 'stroke_' + Math.random().toString(36).slice(2, 9),
        type: 'stroke',
        points: [worldP],
        color: currentColor,
        size: currentSize,
        isHighlighter: (currentTool === 'highlighter')
      };
    } else if (currentTool === 'laser') {
      currentStroke = {
        type: 'laser',
        points: [worldP]
      };
    } else if (currentTool === 'sticky') {
      createStickyAt(worldP);
      isPointerDown = false;
      setTool('select');
    } else if (currentTool === 'text') {
      createTextAt(worldP);
      isPointerDown = false;
      setTool('select');
    } else if (currentTool === 'eraser') {
      eraseAt(worldP);
    }

    board.setPointerCapture(e.pointerId);
  });

  board.addEventListener('pointermove', (e) => {
    const worldP = screenToWorld(e.clientX, e.clientY);

    // Throttled Cursor Move broadcast
    throttledCursorEmit(worldP.x, worldP.y);

    if (isPanning) {
      panX = e.clientX - panStartX;
      panY = e.clientY - panStartY;
      drawGrid();
      redrawAll();
      return;
    }

    if (!isPointerDown) return;

    if (currentTool === 'pen' || currentTool === 'highlighter') {
      if (currentStroke) {
        currentStroke.points.push(worldP);
        // Incremental local draw to draftLayer for instant responsiveness
        drawDraftStroke(currentStroke);
      }
    } else if (currentTool === 'laser') {
      currentStroke.points.push(worldP);
      socket.emit('laser:trail', currentStroke.points.slice(-4));
    } else if (['rect', 'circle', 'arrow', 'line'].includes(currentTool)) {
      drawDraftShape(currentTool, startWorldPoint, worldP);
    } else if (currentTool === 'eraser') {
      eraseAt(worldP);
    }
  });

  function drawDraftStroke(stroke) {
    dctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY);
    dctx.clearRect(0, 0, cssW / zoom, cssH / zoom);
    drawElement(stroke, dctx);
  }

  function finishPointerAction(e) {
    if (isPanning) {
      isPanning = false;
      document.body.classList.remove('is-panning-active');
    }

    if (!isPointerDown) return;
    isPointerDown = false;
    clearDraft();

    const worldP = screenToWorld(e.clientX, e.clientY);

    if (currentTool === 'pen' || currentTool === 'highlighter') {
      if (currentStroke && currentStroke.points.length > 0) {
        elements.push(currentStroke);
        redoStack = [];
        socket.emit('element:add', currentStroke);
        redrawAll();
      }
      currentStroke = null;
    } else if (['rect', 'circle', 'arrow', 'line'].includes(currentTool)) {
      if (startWorldPoint) {
        const shapeEl = {
          id: 'shape_' + Math.random().toString(36).slice(2, 9),
          type: 'shape',
          shapeType: currentTool,
          x: startWorldPoint.x,
          y: startWorldPoint.y,
          w: worldP.x - startWorldPoint.x,
          h: worldP.y - startWorldPoint.y,
          color: currentColor,
          size: currentSize
        };
        // Avoid tiny zero-click shapes
        if (Math.hypot(shapeEl.w, shapeEl.h) > 5) {
          elements.push(shapeEl);
          redoStack = [];
          socket.emit('element:add', shapeEl);
          redrawAll();
          playSound('click');
        }
      }
    }
    startWorldPoint = null;
  }

  window.addEventListener('pointerup', finishPointerAction);
  window.addEventListener('pointercancel', finishPointerAction);

  // ---------- Double-Click Attention Radar Ping ----------
  board.addEventListener('dblclick', (e) => {
    if (currentTool !== 'select') return;
    const worldP = screenToWorld(e.clientX, e.clientY);
    socket.emit('radar:ping', worldP);
    radarPings.push({
      x: worldP.x,
      y: worldP.y,
      color: currentColor,
      radius: 5,
      opacity: 1,
      startTime: performance.now()
    });
    playSound('pop');
  });

  // ---------- Wheel Pan & Zoom ----------
  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    const mouseX = e.clientX;
    const mouseY = e.clientY;

    if (e.ctrlKey || e.metaKey) {
      // Pinch to zoom or ctrl-wheel zoom
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      applyZoom(zoomFactor, mouseX, mouseY);
    } else {
      // Two finger trackpad scroll or regular wheel pan
      panX -= e.deltaX;
      panY -= e.deltaY;
      drawGrid();
      redrawAll();
    }
  }, { passive: false });

  function applyZoom(factor, centerX = cssW / 2, centerY = cssH / 2) {
    const oldZoom = zoom;
    const newZoom = Math.min(4.0, Math.max(0.2, zoom * factor));
    if (newZoom === oldZoom) return;

    // Zoom centered around (centerX, centerY)
    const worldCenter = screenToWorld(centerX, centerY);
    zoom = newZoom;
    panX = centerX - worldCenter.x * zoom;
    panY = centerY - worldCenter.y * zoom;

    zoomLevelText.textContent = `${Math.round(zoom * 100)}%`;
    drawGrid();
    redrawAll();
  }

  // ---------- Create Sticky Notes & Text ----------
  function createStickyAt(worldP) {
    const randomTheme = STICKY_THEMES[Math.floor(Math.random() * STICKY_THEMES.length)];
    const stickyEl = {
      id: 'sticky_' + Math.random().toString(36).slice(2, 9),
      type: 'sticky',
      x: worldP.x - 95,
      y: worldP.y - 75,
      w: 190,
      h: 150,
      text: '',
      theme: randomTheme,
      author: me ? me.name : 'You'
    };
    elements.push(stickyEl);
    socket.emit('element:add', stickyEl);
    redrawAll();
    playSound('pop');

    // Auto-focus the new sticky's textarea
    setTimeout(() => {
      const node = stickyDoms.get(stickyEl.id);
      if (node) {
        const ta = node.querySelector('textarea');
        if (ta) ta.focus();
      }
    }, 50);
  }

  function createTextAt(worldP) {
    const fontSize = currentSize <= 3 ? 20 : (currentSize <= 6 ? 28 : 40);
    const textEl = {
      id: 'text_' + Math.random().toString(36).slice(2, 9),
      type: 'text',
      x: worldP.x,
      y: worldP.y,
      text: '',
      color: currentColor,
      fontSize: fontSize
    };
    elements.push(textEl);
    socket.emit('element:add', textEl);
    redrawAll();
    playSound('pop');

    // Auto-focus the new text box
    setTimeout(() => {
      const node = textDoms.get(textEl.id);
      if (node) {
        const input = node.querySelector('.board-text-input');
        if (input) input.focus();
      }
    }, 50);
  }

  function eraseAt(worldP) {
    const eraseRadius = 24 / zoom;
    const initialLen = elements.length;
    elements = elements.filter(el => {
      if (el.type === 'stroke') {
        return !el.points.some(p => Math.hypot(p.x - worldP.x, p.y - worldP.y) < eraseRadius);
      } else if (el.type === 'shape') {
        return Math.hypot(el.x + el.w / 2 - worldP.x, el.y + el.h / 2 - worldP.y) > eraseRadius + Math.max(Math.abs(el.w), Math.abs(el.h)) / 2;
      } else if (el.type === 'text') {
        return Math.hypot(el.x - worldP.x, el.y - worldP.y) > eraseRadius * 1.5;
      }
      return true;
    });
    if (elements.length !== initialLen) {
      redrawAll();
      socket.emit('element:delete', 'erased');
    }
  }

  // ---------- Live Cursor Broadcast (rAF throttled) ----------
  let cursorEmitPending = false;
  let activeChatText = '';

  function throttledCursorEmit(wx, wy) {
    if (cursorEmitPending) return;
    cursorEmitPending = true;
    requestAnimationFrame(() => {
      socket.emit('cursor:move', { x: wx, y: wy, chatText: activeChatText });
      cursorEmitPending = false;
    });
  }

  // ---------- Figma-Style Live Cursor Chat ----------
  let isChatActive = false;
  let chatAnchorX = 0, chatAnchorY = 0;

  function openCursorChat(x, y) {
    isChatActive = true;
    chatAnchorX = x;
    chatAnchorY = y;
    cursorChatBubble.style.left = `${x}px`;
    cursorChatBubble.style.top = `${y}px`;
    cursorChatBubble.classList.remove('hidden');
    cursorChatInput.value = '';
    cursorChatInput.focus();
    playSound('pop');
  }

  function closeCursorChat() {
    if (!isChatActive) return;
    isChatActive = false;
    cursorChatBubble.classList.add('hidden');
    // Clear chat after 2.5 seconds
    setTimeout(() => {
      activeChatText = '';
      const worldP = screenToWorld(chatAnchorX, chatAnchorY);
      throttledCursorEmit(worldP.x, worldP.y);
    }, 2500);
  }

  cursorChatInput.addEventListener('input', () => {
    activeChatText = cursorChatInput.value.trim();
    const worldP = screenToWorld(chatAnchorX, chatAnchorY);
    throttledCursorEmit(worldP.x, worldP.y);
  });

  cursorChatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      closeCursorChat();
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (isChatActive) {
      chatAnchorX = e.clientX;
      chatAnchorY = e.clientY;
      cursorChatBubble.style.left = `${chatAnchorX}px`;
      cursorChatBubble.style.top = `${chatAnchorY}px`;
    }
  });

  cursorChatBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (reactionsPalettePopover) reactionsPalettePopover.classList.add('hidden');
    openCursorChat(window.innerWidth / 2, window.innerHeight / 2);
  });

  // ---------- Live Emoji Reactions ----------
  function spawnReaction(emoji, wx, wy) {
    for (let i = 0; i < 4; i++) {
      reactionParticles.push({
        emoji,
        x: wx,
        y: wy,
        vx: (Math.random() - 0.5) * 60,
        vy: -80 - Math.random() * 60,
        opacity: 1,
        scale: 0.8 + Math.random() * 0.5,
        life: 1.0
      });
    }
  }

  reactionsStrip.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const emoji = btn.dataset.emoji;
      const centerWorld = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
      socket.emit('reaction:emit', { emoji, x: centerWorld.x, y: centerWorld.y });
      spawnReaction(emoji, centerWorld.x, centerWorld.y);
      playSound('reaction');
    });
  });

  // ---------- Cursor & Transient VFX Animation Loop ----------
  let lastFrameTime = performance.now();

  function renderVfxLoop() {
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.clearRect(0, 0, cssW, cssH);

    const now = performance.now();
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    // 1. Radar Attention Pings
    for (let i = radarPings.length - 1; i >= 0; i--) {
      const ping = radarPings[i];
      const elapsed = (now - ping.startTime) / 1000;
      if (elapsed > 1.2) {
        radarPings.splice(i, 1);
        continue;
      }
      const progress = elapsed / 1.2;
      const screenPos = worldToScreen(ping.x, ping.y);
      const currentRadius = 8 + progress * 64 * zoom;
      const alpha = (1 - progress) * 0.8;

      cctx.save();
      cctx.strokeStyle = ping.color;
      cctx.lineWidth = 2.5;
      cctx.globalAlpha = alpha;
      cctx.beginPath();
      cctx.arc(screenPos.x, screenPos.y, currentRadius, 0, Math.PI * 2);
      cctx.stroke();
      cctx.restore();
    }

    // 2. Laser Trails
    for (let i = laserTrails.length - 1; i >= 0; i--) {
      const trail = laserTrails[i];
      const age = (now - trail.timestamp) / 1000;
      if (age > 1.2) {
        laserTrails.splice(i, 1);
        continue;
      }
      const alpha = 1 - age / 1.2;
      cctx.save();
      cctx.strokeStyle = '#EF4444';
      cctx.lineWidth = 4 * zoom;
      cctx.lineCap = 'round';
      cctx.globalAlpha = alpha;
      cctx.beginPath();
      trail.points.forEach((p, idx) => {
        const s = worldToScreen(p.x, p.y);
        if (idx === 0) cctx.moveTo(s.x, s.y);
        else cctx.lineTo(s.x, s.y);
      });
      cctx.stroke();
      cctx.restore();
    }

    // 3. Floating Emoji Reaction Particles
    for (let i = reactionParticles.length - 1; i >= 0; i--) {
      const p = reactionParticles[i];
      p.life -= dt;
      if (p.life <= 0) {
        reactionParticles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const screenPos = worldToScreen(p.x, p.y);
      cctx.save();
      cctx.globalAlpha = Math.max(0, p.life);
      cctx.font = `${Math.round(24 * p.scale)}px sans-serif`;
      cctx.fillText(p.emoji, screenPos.x, screenPos.y);
      cctx.restore();
    }

    // 4. Remote Collaborator Cursors & Live Chat Bubbles
    Object.entries(remoteCursors).forEach(([id, c]) => {
      if (now - c.lastSeen > 4000) return; // Hide stale cursors

      const s = worldToScreen(c.x, c.y);

      cctx.save();
      // Cursor pointer shape
      cctx.fillStyle = c.color;
      cctx.beginPath();
      cctx.moveTo(s.x, s.y);
      cctx.lineTo(s.x + 13, s.y + 4);
      cctx.lineTo(s.x + 6, s.y + 7);
      cctx.lineTo(s.x + 5, s.y + 14);
      cctx.closePath();
      cctx.fill();

      // Username tag pill
      cctx.font = "600 11px 'Plus Jakarta Sans', sans-serif";
      const nameWidth = cctx.measureText(c.name).width;
      cctx.fillStyle = c.color;
      cctx.beginPath();
      cctx.roundRect(s.x + 12, s.y + 8, nameWidth + 12, 18, 4);
      cctx.fill();
      cctx.fillStyle = '#FFFFFF';
      cctx.fillText(c.name, s.x + 18, s.y + 21);

      // Live Cursor Chat Bubble (if collaborator is typing!)
      if (c.chatText) {
        cctx.font = "600 12px 'Plus Jakarta Sans', sans-serif";
        const chatWidth = cctx.measureText(c.chatText).width;
        cctx.fillStyle = '#181C26';
        cctx.strokeStyle = c.color;
        cctx.lineWidth = 1.5;
        cctx.beginPath();
        cctx.roundRect(s.x + 14, s.y - 24, chatWidth + 16, 22, 10);
        cctx.fill();
        cctx.stroke();

        cctx.fillStyle = '#FFFFFF';
        cctx.fillText(c.chatText, s.x + 22, s.y - 9);
      }

      cctx.restore();
    });

    requestAnimationFrame(renderVfxLoop);
  }
  requestAnimationFrame(renderVfxLoop);

  // ---------- Toolbar & Dock Controls ----------
  const SHAPE_TOOLS = ['rect', 'circle', 'arrow', 'line'];
  let currentShapeType = 'rect';

  const shapeIcons = {
    rect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>',
    circle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>',
    line: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5"></line></svg>'
  };

  function setTool(tool) {
    currentTool = tool;
    document.body.dataset.tool = tool;

    if (SHAPE_TOOLS.includes(tool)) {
      currentShapeType = tool;
      if (shapesTriggerBtn) {
        shapesTriggerBtn.dataset.tool = tool;
        shapesTriggerBtn.classList.add('is-active');
      }
      if (currentShapeIcon) {
        currentShapeIcon.innerHTML = shapeIcons[tool] || shapeIcons.rect;
      }
      if (shapesPalettePopover) {
        shapesPalettePopover.querySelectorAll('.popover-tool-btn').forEach(btn => {
          btn.classList.toggle('is-active', btn.dataset.tool === tool);
        });
      }
    } else {
      if (shapesTriggerBtn) shapesTriggerBtn.classList.remove('is-active');
    }

    mainDock.querySelectorAll('.dock__btn[data-tool]').forEach(btn => {
      if (btn === shapesTriggerBtn) return;
      btn.classList.toggle('is-active', btn.dataset.tool === tool);
    });

    playSound('click');
  }

  mainDock.querySelectorAll('.dock__btn[data-tool]').forEach(btn => {
    if (btn === shapesTriggerBtn) return;
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  function closeAllPopovers() {
    if (shapesPalettePopover) shapesPalettePopover.classList.add('hidden');
    if (reactionsPalettePopover) reactionsPalettePopover.classList.add('hidden');
    if (colorPalettePopover) colorPalettePopover.classList.add('hidden');
    if (exportDropdown) exportDropdown.classList.add('hidden');
  }

  // 1. Shapes Popover Handling (Shapes in one section)
  if (shapesTriggerBtn && shapesPalettePopover) {
    shapesTriggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = !shapesPalettePopover.classList.contains('hidden');
      closeAllPopovers();
      if (!isVisible) {
        shapesPalettePopover.classList.remove('hidden');
      }
      if (!SHAPE_TOOLS.includes(currentTool)) {
        setTool(currentShapeType);
      }
    });

    shapesPalettePopover.querySelectorAll('.popover-tool-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setTool(btn.dataset.tool);
        shapesPalettePopover.classList.add('hidden');
      });
    });
  }

  // 2. Reactions Popover Handling (Reactions in one section)
  if (reactionsTriggerBtn && reactionsPalettePopover) {
    reactionsTriggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = !reactionsPalettePopover.classList.contains('hidden');
      closeAllPopovers();
      if (!isVisible) {
        reactionsPalettePopover.classList.remove('hidden');
      }
    });
  }

  // 3. Color & Stroke Width Popover Handling (Colours in one section)
  if (colorTriggerBtn && colorPalettePopover) {
    colorTriggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = !colorPalettePopover.classList.contains('hidden');
      closeAllPopovers();
      if (!isVisible) {
        colorPalettePopover.classList.remove('hidden');
      }
    });
  }

  // Color Swatches Initialization
  PALETTE.forEach((color, i) => {
    const swatch = document.createElement('button');
    swatch.className = 'color-swatch' + (i === 0 ? ' is-active' : '');
    swatch.style.backgroundColor = color;
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      currentColor = color;
      currentColorDot.style.backgroundColor = color;
      colorGrid.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('is-active'));
      swatch.classList.add('is-active');
      playSound('click');
    });
    colorGrid.appendChild(swatch);
  });

  // Size Picker Buttons (Inside Color Popover)
  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentSize = Number(btn.dataset.size);
      document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      playSound('click');
    });
  });

  document.addEventListener('click', (e) => {
    if (shapesPalettePopover && !shapesPalettePopover.contains(e.target) && (!shapesTriggerBtn || !shapesTriggerBtn.contains(e.target))) {
      shapesPalettePopover.classList.add('hidden');
    }
    if (reactionsPalettePopover && !reactionsPalettePopover.contains(e.target) && (!reactionsTriggerBtn || !reactionsTriggerBtn.contains(e.target))) {
      reactionsPalettePopover.classList.add('hidden');
    }
    if (colorPalettePopover && !colorPalettePopover.contains(e.target) && (!colorTriggerBtn || !colorTriggerBtn.contains(e.target))) {
      colorPalettePopover.classList.add('hidden');
    }
    if (exportDropdown && !exportDropdown.contains(e.target) && (!exportMenuBtn || !exportMenuBtn.contains(e.target))) {
      exportDropdown.classList.add('hidden');
    }
  });

  // Undo / Redo
  undoBtn.addEventListener('click', performUndo);
  redoBtn.addEventListener('click', performRedo);

  function performUndo() {
    if (elements.length === 0) return;
    const popped = elements.pop();
    redoStack.push(popped);
    socket.emit('element:undo');
    redrawAll();
    playSound('pop');
  }

  function performRedo() {
    if (redoStack.length === 0) return;
    const restored = redoStack.pop();
    elements.push(restored);
    socket.emit('element:add', restored);
    redrawAll();
    playSound('pop');
  }

  // Zoom HUD Actions
  zoomInBtn.addEventListener('click', () => applyZoom(1.2));
  zoomOutBtn.addEventListener('click', () => applyZoom(0.8));
  zoomLevelText.addEventListener('click', () => {
    zoom = 1.0;
    panX = 0;
    panY = 0;
    zoomLevelText.textContent = '100%';
    drawGrid();
    redrawAll();
  });
  fitViewBtn.addEventListener('click', () => {
    zoom = 1.0;
    panX = 0;
    panY = 0;
    zoomLevelText.textContent = '100%';
    drawGrid();
    redrawAll();
    showToast('View reset to center (100%)');
  });

  // Top Bar Actions
  clearBoardBtn.addEventListener('click', () => {
    if (confirm('Clear the entire whiteboard for all collaborators in this room?')) {
      elements = [];
      redrawAll();
      socket.emit('canvas:clear');
      showToast('Board cleared');
    }
  });

  exportMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportDropdown.classList.toggle('hidden');
  });

  exportPngBtn.addEventListener('click', () => {
    exportDropdown.classList.add('hidden');
    exportHighResPng();
  });

  exportJsonBtn.addEventListener('click', () => {
    exportDropdown.classList.add('hidden');
    exportJsonBoard();
  });

  importJsonInput.addEventListener('change', (e) => {
    exportDropdown.classList.add('hidden');
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const loaded = JSON.parse(ev.target.result);
        if (Array.isArray(loaded)) {
          elements = loaded;
          socket.emit('board:import', elements);
          redrawAll();
          showToast('Board loaded from JSON');
        }
      } catch (err) {
        alert('Invalid JSON board file');
      }
    };
    reader.readAsText(file);
  });

  if (sfxToggleBtn) {
    sfxToggleBtn.addEventListener('click', () => {
      sfxEnabled = !sfxEnabled;
      sfxToggleBtn.style.opacity = sfxEnabled ? '1' : '0.4';
      showToast(sfxEnabled ? 'Audio Effects: ON' : 'Audio Effects: OFF');
    });
  }

  // Shortcuts Modal
  shortcutsBtn.addEventListener('click', () => shortcutsModal.classList.remove('hidden'));
  closeShortcutsBtn.addEventListener('click', () => shortcutsModal.classList.add('hidden'));
  shortcutsModal.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) shortcutsModal.classList.add('hidden');
  });

  // Room copy link
  roomCopyBtn.addEventListener('click', async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomInput.value.trim() || roomId);
    try {
      await navigator.clipboard.writeText(url.toString());
      roomCopyBtn.classList.add('is-copied');
      showToast('Room link copied to clipboard!');
      setTimeout(() => roomCopyBtn.classList.remove('is-copied'), 2000);
    } catch (e) {
      prompt('Copy this link:', url.toString());
    }
  });

  roomInput.addEventListener('change', () => {
    const newRoom = roomInput.value.trim().slice(0, 64) || Math.random().toString(36).slice(2, 8);
    roomInput.value = newRoom;
    sessionStorage.setItem('flamspace_active_room', newRoom);
    const url = new URL(window.location.href);
    url.searchParams.set('room', newRoom);
    window.history.replaceState({}, '', url);
    roomId = newRoom;
    isJoined = true;
    elements = [];
    redrawAll();
    const currentName = (myProfile && myProfile.name) || 'Collaborator';
    socket.emit('room:join', { roomId: newRoom, name: currentName, color: selectedColor });
    showToast(`Joined room: ${newRoom}`);
  });

  // ---------- High-Res PNG Export ----------
  function exportHighResPng() {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = cssW * 2;
    exportCanvas.height = cssH * 2;
    const ectx = exportCanvas.getContext('2d');

    // Fill dark theme canvas background
    ectx.fillStyle = '#0E1117';
    ectx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // Apply scale & draw elements
    ectx.setTransform(2 * zoom, 0, 0, 2 * zoom, 2 * panX, 2 * panY);
    for (const el of elements) {
      drawElement(el, ectx);
    }

    const link = document.createElement('a');
    link.download = `flamspace-${roomId}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
    showToast('High-Res PNG exported!');
  }

  function exportJsonBoard() {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(elements, null, 2));
    const link = document.createElement('a');
    link.download = `flamspace-board-${roomId}.json`;
    link.href = dataStr;
    link.click();
    showToast('Board saved to JSON!');
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
  }

  // ---------- Keyboard Shortcuts ----------
  window.addEventListener('keydown', (e) => {
    // Ignore keyboard shortcuts if user is typing inside an input or textarea
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    if (e.code === 'Space') {
      spacePressed = true;
      document.body.classList.add('is-panning');
    } else if (e.key === 'v' || e.key === 'V') {
      setTool('select');
    } else if (e.key === 'p' || e.key === 'P') {
      setTool('pen');
    } else if (e.key === 'h' || e.key === 'H') {
      setTool('highlighter');
    } else if (e.key === 'e' || e.key === 'E') {
      setTool('eraser');
    } else if (e.key === 'r' || e.key === 'R') {
      setTool('rect');
    } else if (e.key === 'o' || e.key === 'O') {
      setTool('circle');
    } else if (e.key === 'a' || e.key === 'A') {
      setTool('arrow');
    } else if (e.key === 'l' || e.key === 'L') {
      setTool('line');
    } else if (e.key === 's' || e.key === 'S') {
      setTool('sticky');
    } else if (e.key === '/') {
      e.preventDefault();
      openCursorChat(window.innerWidth / 2, window.innerHeight / 2);
    } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      shortcutsModal.classList.toggle('hidden');
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      if (e.shiftKey) performRedo();
      else performUndo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      performRedo();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spacePressed = false;
      document.body.classList.remove('is-panning');
    }
  });

  window.addEventListener('resize', resizeAll);
  resizeAll();
})();

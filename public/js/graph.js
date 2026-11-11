// Grafo de notas con una simulación de fuerzas mínima sobre <canvas> (sin dependencias).
// Arrastrar el fondo desplaza, rueda hace zoom, clic en un nodo abre la nota.

export function mountGraph(canvas, { nodes, edges }, onSelect) {
  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const colors = {
    node: css.getPropertyValue('--accent').trim(),
    edge: css.getPropertyValue('--border').trim(),
    text: css.getPropertyValue('--muted').trim(),
    hover: css.getPropertyValue('--text').trim(),
  };

  const byId = new Map();
  const degree = new Map();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const sim = nodes.map((n, i) => {
    const angle = i * 2.399963; // ángulo áureo: reparto inicial uniforme
    const r = 12 * Math.sqrt(i + 1);
    const node = { ...n, x: Math.cos(angle) * r, y: Math.sin(angle) * r, vx: 0, vy: 0, deg: degree.get(n.id) ?? 0 };
    byId.set(n.id, node);
    return node;
  });
  const links = edges.map((e) => ({ s: byId.get(e.source), t: byId.get(e.target) })).filter((l) => l.s && l.t);

  let view = { x: 0, y: 0, k: 1 };
  let hover = null;
  let alpha = 1;
  let frame = 0;
  let width = 0;
  let height = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function tick() {
    // Repulsión O(n²): suficiente hasta el límite de 1000 nodos del endpoint.
    for (let i = 0; i < sim.length; i++) {
      const a = sim[i];
      for (let j = i + 1; j < sim.length; j++) {
        const b = sim[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy || 0.01;
        if (d2 > 90000) continue;
        const f = (600 / d2) * alpha;
        dx *= f; dy *= f;
        a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
      }
    }
    for (const { s, t } of links) {
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = ((d - 70) / d) * 0.04 * alpha;
      s.vx += dx * f; s.vy += dy * f; t.vx -= dx * f; t.vy -= dy * f;
    }
    for (const n of sim) {
      n.vx -= n.x * 0.004 * alpha;
      n.vy -= n.y * 0.004 * alpha;
      n.x += (n.vx *= 0.6);
      n.y += (n.vy *= 0.6);
    }
    alpha = Math.max(0, alpha - 0.006);
  }

  const radius = (n) => 4 + Math.min(10, Math.sqrt(n.deg) * 2);
  const toScreen = (n) => [width / 2 + (n.x + view.x) * view.k, height / 2 + (n.y + view.y) * view.k];

  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = colors.edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const { s, t } of links) {
      const [x1, y1] = toScreen(s);
      const [x2, y2] = toScreen(t);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const n of sim) {
      const [x, y] = toScreen(n);
      const r = radius(n) * Math.sqrt(view.k);
      ctx.fillStyle = n === hover ? colors.hover : colors.node;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (view.k > 0.7 || n === hover || sim.length < 40) {
        ctx.fillStyle = n === hover ? colors.hover : colors.text;
        ctx.fillText(n.title.length > 32 ? n.title.slice(0, 31) + '…' : n.title, x, y + r + 13);
      }
    }
  }

  function loop() {
    if (alpha > 0) tick();
    draw();
    frame = requestAnimationFrame(loop);
  }

  function nodeAt(px, py) {
    for (let i = sim.length - 1; i >= 0; i--) {
      const [x, y] = toScreen(sim[i]);
      const r = radius(sim[i]) * Math.sqrt(view.k) + 4;
      if ((px - x) ** 2 + (py - y) ** 2 <= r * r) return sim[i];
    }
    return null;
  }

  let drag = null;
  const pos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  const onDown = (e) => {
    const [x, y] = pos(e);
    drag = { x, y, vx: view.x, vy: view.y, moved: false };
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const [x, y] = pos(e);
    if (drag) {
      if (Math.abs(x - drag.x) + Math.abs(y - drag.y) > 3) drag.moved = true;
      view.x = drag.vx + (x - drag.x) / view.k;
      view.y = drag.vy + (y - drag.y) / view.k;
    } else {
      hover = nodeAt(x, y);
      canvas.style.cursor = hover ? 'pointer' : 'grab';
    }
  };
  const onUp = (e) => {
    const [x, y] = pos(e);
    if (drag && !drag.moved) {
      const n = nodeAt(x, y);
      if (n) onSelect(n.id);
    }
    drag = null;
  };
  const onWheel = (e) => {
    e.preventDefault();
    view.k = Math.min(4, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
  };

  resize();
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', resize);
  loop();

  return function unmount() {
    cancelAnimationFrame(frame);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('resize', resize);
  };
}

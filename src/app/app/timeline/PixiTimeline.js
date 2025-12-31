'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Flex, Text } from '@radix-ui/themes';

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const dayMs = 24 * 60 * 60 * 1000;

function formatInTimeZoneClient(dateIso, timeZone) {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return '';

  const opts = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  };

  try {
    if (timeZone) {
      return new Intl.DateTimeFormat(undefined, { timeZone, ...opts }).format(d);
    }
    return new Intl.DateTimeFormat(undefined, opts).format(d);
  } catch {
    return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...opts }).format(d);
  }
}

function getLocalTimeParts(dateMs, timeZone) {
  const d = new Date(dateMs);
  const fmt = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;

  const hour = Number(get('hour') || 0);
  const minute = Number(get('minute') || 0);
  const second = Number(get('second') || 0);

  return {
    hour: Number.isNaN(hour) ? 0 : hour,
    minute: Number.isNaN(minute) ? 0 : minute,
    second: Number.isNaN(second) ? 0 : second,
  };
}

function clampInt(v, min, max) {
  const n = Number(v);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export default function PixiTimeline({ userTimeZone }) {
  const containerRef = useRef(null);
  const appRef = useRef(null);
  const requestRenderRef = useRef(() => {});
  const renderNowRef = useRef(() => {});

  const worldRef = useRef(null);
  const axesGfxRef = useRef(null);
  const eventsLayerRef = useRef(null);
  const eventGfxRef = useRef([]);

  const [layout, setLayout] = useState('linear');
  const [status, setStatus] = useState('');

  const [channels, setChannels] = useState([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState([]);
  const [pastDays, setPastDays] = useState(10);
  const [futureDays, setFutureDays] = useState(5);

  const [originTargetMs, setOriginTargetMs] = useState(() => Date.now());
  const originAnimatedMsRef = useRef(originTargetMs);
  const originTargetMsRef = useRef(originTargetMs);

  const [layoutBlend, setLayoutBlend] = useState(0);
  const layoutBlendRef = useRef(0);

  const [items, setItems] = useState([]);
  const itemsRef = useRef([]);

  const [hover, setHover] = useState(null);
  const hoverClearTimeoutRef = useRef(null);

  function cancelHoverClear() {
    if (hoverClearTimeoutRef.current) {
      clearTimeout(hoverClearTimeoutRef.current);
      hoverClearTimeoutRef.current = null;
    }
  }

  function scheduleHoverClear() {
    cancelHoverClear();
    hoverClearTimeoutRef.current = setTimeout(() => {
      setHover(null);
    }, 80);
  }

  function resetView() {
    const app = appRef.current;
    const world = worldRef.current;
    if (!app || !world) return;

    world.scale.set(1);
    world.position.set(app.screen.width * 0.5, app.screen.height * 0.5);
    requestRenderRef.current();
  }

  const palette = useMemo(
    () => [0x60a5fa, 0xa78bfa, 0x34d399, 0xfbbf24, 0xf87171, 0x22c55e, 0x38bdf8, 0xfb7185, 0xf97316, 0x94a3b8],
    []
  );

  const colorByChannelId = useMemo(() => {
    const m = new Map();
    for (let i = 0; i < channels.length; i += 1) {
      const c = channels[i];
      m.set(c.id, palette[i % palette.length]);
    }
    return m;
  }, [channels, palette]);

  function computeLinearPoint(timeMs, channelIndex, originMs) {
    const pxPerDay = 180;
    const laneY = 64;
    const laneGap = 42;

    const dxDays = (timeMs - originMs) / dayMs;
    const x = dxDays * pxPerDay;
    const y = laneY + channelIndex * laneGap;
    return { x, y };
  }

  function computeSpiralPoint(timeMs, channelIndex, channelCount, originMs, rOrigin, dayStep, channelTimeZone) {
    const tz = channelTimeZone || userTimeZone || 'UTC';

    const approx = (timeMs - originMs) / dayMs;
    const loop = approx >= 0 ? Math.floor(approx) : Math.ceil(approx);
    const local = getLocalTimeParts(timeMs, tz);
    const dayFraction = (local.hour * 3600 + local.minute * 60 + local.second) / 86400;

    const spiralDay = loop + dayFraction;
    const r = rOrigin - approx * dayStep + (channelIndex - (channelCount - 1) * 0.5) * 6;

    const theta = -spiralDay * Math.PI * 2 - Math.PI / 2;

    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    return { x, y };
  }

  function redrawTimeline() {
    const app = appRef.current;
    const axes = axesGfxRef.current;
    const eventsLayer = eventsLayerRef.current;

    if (!app || !axes || !eventsLayer) return;

    const originMs = originAnimatedMsRef.current;
    const blend = layoutBlendRef.current;

    const selected = selectedChannelIds.length ? selectedChannelIds : channels.map((c) => c.id);
    const channelOrder = new Map(selected.map((id, idx) => [id, idx]));
    const channelCount = selected.length;

    axes.clear();

    const blendIsZero = Math.abs(blend) < 0.001;

    const spiralBaseRadius = 30;
    const spiralOuterRadius = Math.max(80, Math.min(app.screen.width, app.screen.height) * 0.5 - 44);
    const spiralTotalDays = Math.max(1, pastDays + futureDays);
    const spiralDayStep = (spiralOuterRadius - spiralBaseRadius) / spiralTotalDays;
    const spiralOriginRadius = spiralBaseRadius + futureDays * spiralDayStep;

    if (layout === 'linear') {
      axes.lineStyle(2, 0xffffff, 0.18);
      axes.moveTo(0, 0);
      axes.lineTo(0, 900);
    } else {
      axes.lineStyle(2, 0xffffff, 0.14);
      axes.drawCircle(0, 0, spiralOriginRadius);
    }

    const gfxList = eventGfxRef.current;
    const allItems = itemsRef.current;

    for (let i = 0; i < allItems.length; i += 1) {
      const it = allItems[i];
      const idx = channelOrder.get(it.channelId);
      if (idx === undefined) continue;

      const startMs = it.startMs;
      const endMs = it.endMs;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;

      const aMs = Math.min(startMs, endMs);
      const bMs = Math.max(startMs, endMs);

      const channelTz = it.channelTimeZone || userTimeZone || 'UTC';

      const g = gfxList[i];
      if (!g) continue;

      g.clear();

      const color = colorByChannelId.get(it.channelId) || 0x94a3b8;
      const alpha = it.kind === 'scheduled' && it.isCanceled ? 0.18 : it.kind === 'scheduled' ? 0.55 : 0.8;
      const thickness = it.kind === 'video' ? 10 : 8;
      const pad = thickness * 0.75 + 8;

      if (blendIsZero) {
        const linearA = computeLinearPoint(aMs, idx, originMs);
        const linearB = computeLinearPoint(bMs, idx, originMs);

        g.lineStyle(thickness, color, alpha);
        g.moveTo(linearA.x, linearA.y);
        g.lineTo(linearB.x, linearB.y);

        g.beginFill(color, alpha);
        g.drawCircle(linearA.x, linearA.y, thickness * 0.5);
        g.drawCircle(linearB.x, linearB.y, thickness * 0.5);
        g.endFill();

        const minX = Math.min(linearA.x, linearB.x) - pad;
        const minY = Math.min(linearA.y, linearB.y) - pad;
        const maxX = Math.max(linearA.x, linearB.x) + pad;
        const maxY = Math.max(linearA.y, linearB.y) + pad;
        if (g.__hitRect) {
          g.__hitRect.x = minX;
          g.__hitRect.y = minY;
          g.__hitRect.width = Math.max(1, maxX - minX);
          g.__hitRect.height = Math.max(1, maxY - minY);
        }
      } else {
        const durationMs = Math.max(0, bMs - aMs);
        const days = durationMs / dayMs;

        let points = 2;
        if (durationMs >= 30 * 60 * 1000) {
          points = Math.ceil(days * 24) + 1;
        }
        points = Math.max(2, Math.min(80, points));

        let first = null;
        let last = null;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        g.lineStyle(thickness, color, alpha);

        for (let pi = 0; pi < points; pi += 1) {
          const tt = points === 1 ? aMs : aMs + (durationMs * pi) / (points - 1);

          const linearP = computeLinearPoint(tt, idx, originMs);
          const spiralP = computeSpiralPoint(tt, idx, channelCount, originMs, spiralOriginRadius, spiralDayStep, channelTz);

          const x = linearP.x + (spiralP.x - linearP.x) * blend;
          const y = linearP.y + (spiralP.y - linearP.y) * blend;

          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);

          if (pi === 0) {
            g.moveTo(x, y);
            first = { x, y };
          } else {
            g.lineTo(x, y);
          }

          if (pi === points - 1) {
            last = { x, y };
          }
        }

        if (first && last) {
          g.beginFill(color, alpha);
          g.drawCircle(first.x, first.y, thickness * 0.5);
          g.drawCircle(last.x, last.y, thickness * 0.5);
          g.endFill();
        }

        if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY) && g.__hitRect) {
          g.__hitRect.x = minX - pad;
          g.__hitRect.y = minY - pad;
          g.__hitRect.width = Math.max(1, maxX - minX + pad * 2);
          g.__hitRect.height = Math.max(1, maxY - minY + pad * 2);
        }
      }
    }

    for (let i = allItems.length; i < gfxList.length; i += 1) {
      const g = gfxList[i];
      if (g) {
        g.clear();
      }
    }

    app.renderer.render(app.stage);
  }

  function ensureEventGraphics(pixi) {
    const eventsLayer = eventsLayerRef.current;
    if (!eventsLayer) return;

    const existing = eventGfxRef.current;
    const needed = itemsRef.current.length;

    for (let i = existing.length; i < needed; i += 1) {
      const g = new pixi.Graphics();
      g.eventMode = 'static';
      g.cursor = 'pointer';
      g.__itemIndex = i;
      g.__hitRect = new pixi.Rectangle(0, 0, 1, 1);
      g.hitArea = g.__hitRect;

      g.on('pointerdown', (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      });

      g.on('pointermove', (e) => {
        cancelHoverClear();
        const idx = g.__itemIndex;
        const it = itemsRef.current[idx];
        if (!it) return;

        const rect = containerRef.current ? containerRef.current.getBoundingClientRect() : null;
        const oe = e?.data?.originalEvent;
        const clientX = oe && typeof oe.clientX === 'number' ? oe.clientX : null;
        const clientY = oe && typeof oe.clientY === 'number' ? oe.clientY : null;

        const x = rect && clientX !== null ? clientX - rect.left : e.global.x;
        const y = rect && clientY !== null ? clientY - rect.top : e.global.y;

        setHover({
          item: it,
          x,
          y,
        });
      });

      g.on('pointerover', () => {
        cancelHoverClear();
        const idx = g.__itemIndex;
        const it = itemsRef.current[idx];
        if (!it) return;
        setHover((prev) => (prev && prev.item?.id === it.id ? prev : { item: it, x: 0, y: 0 }));
      });

      g.on('pointerout', () => {
        scheduleHoverClear();
      });

      g.on('click', () => {
        const idx = g.__itemIndex;
        const it = itemsRef.current[idx];
        if (it?.url) {
          window.open(it.url, '_blank', 'noopener,noreferrer');
        }
      });

      existing.push(g);
      eventsLayer.addChild(g);
    }

    for (let i = 0; i < existing.length; i += 1) {
      existing[i].__itemIndex = i;
    }
  }

  function animateOriginTo(nextMs) {
    originTargetMsRef.current = nextMs;
    setOriginTargetMs(nextMs);

    const startOrigin = originAnimatedMsRef.current;
    const start = performance.now();
    const duration = 420;

    setStatus('');

    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const k = easeInOutCubic(t);
      originAnimatedMsRef.current = startOrigin + (nextMs - startOrigin) * k;
      redrawTimeline();

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        originAnimatedMsRef.current = nextMs;
        redrawTimeline();
      }
    }

    requestAnimationFrame(step);
  }

  function animateLayoutTo(nextLayout) {
    const start = performance.now();
    const duration = 700;
    const from = layoutBlendRef.current;
    const to = nextLayout === 'spiral' ? 1 : 0;

    setStatus('');

    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const k = easeInOutCubic(t);
      const v = from + (to - from) * k;
      layoutBlendRef.current = v;
      setLayoutBlend(v);
      redrawTimeline();

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        layoutBlendRef.current = to;
        setLayoutBlend(to);
        redrawTimeline();
        setStatus('');
      }
    }

    requestAnimationFrame(step);
  }

  async function loadConfig() {
    try {
      const res = await fetch('/api/timeline/config', { cache: 'no-store' });
      if (!res.ok) return null;
      const json = await res.json();
      if (!json?.ok) return null;
      return json.timelineConfig || null;
    } catch {
      return null;
    }
  }

  async function saveConfig(next) {
    try {
      await fetch('/api/timeline/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
    } catch {
    }
  }

  async function loadTimelineData({ originMs, past, future, selectedIds }) {
    const url = new URL('/api/timeline', window.location.origin);
    url.searchParams.set('originMs', String(originMs));
    url.searchParams.set('pastDays', String(past));
    url.searchParams.set('futureDays', String(future));
    if (selectedIds && selectedIds.length) {
      url.searchParams.set('channelIds', selectedIds.join(','));
    }

    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to load timeline');
    }

    const json = await res.json();
    if (!json?.ok) {
      throw new Error(json?.error || 'Failed to load timeline');
    }

    return json;
  }

  useEffect(() => {
    let destroyed = false;

    async function init() {
      const el = containerRef.current;
      if (!el) return;

      const { Application, Container, Graphics } = await import('pixi.js');

      if (destroyed) return;

      const app = new Application({
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
        resizeTo: el,
      });

      appRef.current = app;
      app.view.style.cursor = 'grab';
      el.appendChild(app.view);

      let renderQueued = false;
      const renderNow = () => {
        app.renderer.render(app.stage);
      };
      const requestRender = () => {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => {
          renderQueued = false;
          renderNow();
        });
      };
      requestRenderRef.current = requestRender;
      renderNowRef.current = renderNow;

      app.ticker.stop();

      const world = new Container();
      worldRef.current = world;
      app.stage.addChild(world);

      const axesGfx = new Graphics();
      axesGfxRef.current = axesGfx;
      world.addChild(axesGfx);

      const eventsLayer = new Container();
      eventsLayerRef.current = eventsLayer;
      world.addChild(eventsLayer);

      app.stage.eventMode = 'static';
      app.stage.hitArea = app.screen;
      app.stage.cursor = 'grab';
      app.renderer.events.cursorStyles.default = 'grab';
      app.renderer.events.cursorStyles.grab = 'grab';
      app.renderer.events.cursorStyles.grabbing = 'grabbing';

      let dragging = false;
      let last = { x: 0, y: 0 };

      app.stage.on('pointerdown', (e) => {
        dragging = true;
        app.view.style.cursor = 'grabbing';
        app.stage.cursor = 'grabbing';
        last = { x: e.global.x, y: e.global.y };
      });

      app.stage.on('pointerup', () => {
        dragging = false;
        app.view.style.cursor = 'grab';
        app.stage.cursor = 'grab';
      });

      app.stage.on('pointerupoutside', () => {
        dragging = false;
        app.view.style.cursor = 'grab';
        app.stage.cursor = 'grab';
      });

      app.stage.on('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.global.x - last.x;
        const dy = e.global.y - last.y;
        last = { x: e.global.x, y: e.global.y };
        world.position.x += dx;
        world.position.y += dy;
        requestRender();
      });

      const onWheel = (e) => {
        e.preventDefault();

        const scaleFactor = e.deltaY > 0 ? 0.92 : 1.08;

        const p = { x: 0, y: 0 };
        app.renderer.events.mapPositionToPoint(p, e.clientX, e.clientY);

        const worldX = (p.x - world.position.x) / world.scale.x;
        const worldY = (p.y - world.position.y) / world.scale.y;

        const nextScale = Math.max(0.1, Math.min(6, world.scale.x * scaleFactor));

        world.scale.set(nextScale);

        world.position.x = p.x - worldX * world.scale.x;
        world.position.y = p.y - worldY * world.scale.y;

        requestRender();
      };

      el.addEventListener('wheel', onWheel, { passive: false });

      resetView();
      renderNow();

      const onResize = () => {
        app.stage.hitArea = app.screen;
        resetView();
        requestRender();
      };

      window.addEventListener('resize', onResize);

      return () => {
        window.removeEventListener('resize', onResize);
        el.removeEventListener('wheel', onWheel);
        requestRenderRef.current = () => {};
        renderNowRef.current = () => {};
        app.destroy(true, { children: true, texture: true, baseTexture: true });
      };
    }

    let cleanup = null;
    init().then((fn) => {
      cleanup = fn;
    });

    return () => {
      destroyed = true;
      if (cleanup) cleanup();
    };
  }, []);

  useEffect(() => {
    animateLayoutTo(layout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const cfg = await loadConfig();
      if (!mounted) return;

      const cfgPast = cfg?.pastDays !== undefined ? clampInt(cfg.pastDays, 0, 365) : 10;
      const cfgFuture = cfg?.futureDays !== undefined ? clampInt(cfg.futureDays, 0, 365) : 5;
      const cfgSelected = Array.isArray(cfg?.selectedChannelIds)
        ? cfg.selectedChannelIds.map((s) => String(s || '').trim()).filter(Boolean)
        : [];

      setPastDays(cfgPast);
      setFutureDays(cfgFuture);
      if (cfgSelected.length) setSelectedChannelIds(cfgSelected);

      try {
        setStatus('Loading…');
        const json = await loadTimelineData({
          originMs: originTargetMsRef.current,
          past: cfgPast,
          future: cfgFuture,
          selectedIds: cfgSelected,
        });
        if (!mounted) return;

        setChannels(json.channels || []);
        setSelectedChannelIds((prev) => (cfgSelected.length ? cfgSelected : prev.length ? prev : json.selectedChannelIds || []));

        const byId = new Map((json.channels || []).map((c) => [c.id, c]));

        const nextItems = [];

        for (const s of json.scheduleSegments || []) {
          const st = s.startTimeIso ? new Date(s.startTimeIso).getTime() : NaN;
          const en = s.endTimeIso ? new Date(s.endTimeIso).getTime() : NaN;
          const c = byId.get(s.channelId);
          nextItems.push({
            id: `sched_${s.id}`,
            kind: 'scheduled',
            channelId: s.channelId,
            channelLogin: c?.login || '',
            channelTimeZone: c?.timeZone || null,
            title: s.title || '',
            startMs: st,
            endMs: en,
            isCanceled: Boolean(s.isCanceled),
            url: null,
          });
        }

        for (const v of json.videos || []) {
          const st = v.startedAtIso ? new Date(v.startedAtIso).getTime() : NaN;
          const en = v.endedAtIso ? new Date(v.endedAtIso).getTime() : NaN;
          const c = byId.get(v.channelId);
          nextItems.push({
            id: `vid_${v.id}`,
            kind: 'video',
            channelId: v.channelId,
            channelLogin: c?.login || '',
            channelTimeZone: c?.timeZone || null,
            title: v.title || '',
            startMs: st,
            endMs: Number.isFinite(en) ? en : Number.isFinite(st) ? st : NaN,
            isCanceled: false,
            url: v.url || null,
            viewCount: v.viewCount,
          });
        }

        nextItems.sort((a, b) => (a.startMs || 0) - (b.startMs || 0));

        setItems(nextItems);
        itemsRef.current = nextItems;

        const pixi = await import('pixi.js');
        ensureEventGraphics(pixi);
        redrawTimeline();
        setStatus('');
      } catch (e) {
        if (!mounted) return;
        setStatus(e instanceof Error ? e.message : 'Failed to load');
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let timeout = null;

    timeout = setTimeout(() => {
      saveConfig({
        selectedChannelIds,
        pastDays,
        futureDays,
      });
    }, 600);

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [selectedChannelIds, pastDays, futureDays]);

  useEffect(() => {
    if (!channels.length) return;

    let cancelled = false;

    (async () => {
      try {
        const json = await loadTimelineData({
          originMs: originTargetMs,
          past: pastDays,
          future: futureDays,
          selectedIds: selectedChannelIds,
        });
        if (cancelled) return;

        setChannels(json.channels || []);

        const byId = new Map((json.channels || []).map((c) => [c.id, c]));

        const nextItems = [];

        for (const s of json.scheduleSegments || []) {
          const st = s.startTimeIso ? new Date(s.startTimeIso).getTime() : NaN;
          const en = s.endTimeIso ? new Date(s.endTimeIso).getTime() : NaN;
          const c = byId.get(s.channelId);
          nextItems.push({
            id: `sched_${s.id}`,
            kind: 'scheduled',
            channelId: s.channelId,
            channelLogin: c?.login || '',
            channelTimeZone: c?.timeZone || null,
            title: s.title || '',
            startMs: st,
            endMs: en,
            isCanceled: Boolean(s.isCanceled),
            url: null,
          });
        }

        for (const v of json.videos || []) {
          const st = v.startedAtIso ? new Date(v.startedAtIso).getTime() : NaN;
          const en = v.endedAtIso ? new Date(v.endedAtIso).getTime() : NaN;
          const c = byId.get(v.channelId);
          nextItems.push({
            id: `vid_${v.id}`,
            kind: 'video',
            channelId: v.channelId,
            channelLogin: c?.login || '',
            channelTimeZone: c?.timeZone || null,
            title: v.title || '',
            startMs: st,
            endMs: Number.isFinite(en) ? en : Number.isFinite(st) ? st : NaN,
            isCanceled: false,
            url: v.url || null,
            viewCount: v.viewCount,
          });
        }

        nextItems.sort((a, b) => (a.startMs || 0) - (b.startMs || 0));

        setItems(nextItems);
        itemsRef.current = nextItems;

        const pixi = await import('pixi.js');
        ensureEventGraphics(pixi);
        redrawTimeline();
      } catch {
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [originTargetMs, pastDays, futureDays, selectedChannelIds]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e?.target?.tagName ? String(e.target.tagName).toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        animateOriginTo(originTargetMsRef.current + dayMs);
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        animateOriginTo(originTargetMsRef.current - dayMs);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    originTargetMsRef.current = originTargetMs;
  }, [originTargetMs]);

  useEffect(() => {
    redrawTimeline();
  }, [items, channels, selectedChannelIds, pastDays, futureDays, layoutBlend]);

  return (
    <Card>
      <Flex direction="column" gap="3">
        <Flex gap="2" align="center" wrap="wrap">
          <Button
            variant={layout === 'linear' ? 'solid' : 'soft'}
            onClick={() => setLayout('linear')}
          >
            Linear
          </Button>
          <Button
            variant={layout === 'spiral' ? 'solid' : 'soft'}
            onClick={() => setLayout('spiral')}
          >
            Spiral
          </Button>
          <Button variant="soft" onClick={() => animateOriginTo(Date.now())}>
            Center to NOW
          </Button>
          <Button variant="soft" onClick={() => animateOriginTo(originTargetMsRef.current - dayMs)}>
            Back 1 day
          </Button>
          <Button variant="soft" onClick={() => animateOriginTo(originTargetMsRef.current + dayMs)}>
            Forward 1 day
          </Button>
          <Button variant="soft" onClick={resetView}>
            Reset view
          </Button>

          {status ? (
            <Text size="2" color="gray">
              {status}
            </Text>
          ) : null}
        </Flex>

        <Flex gap="4" wrap="wrap">
          <Flex direction="column" gap="2" style={{ minWidth: 260 }}>
            <Text size="2" color="gray">
              Channels
            </Text>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {channels.map((c, idx) => {
                const checked = selectedChannelIds.length ? selectedChannelIds.includes(c.id) : true;
                const color = palette[idx % palette.length];
                const hex = `#${color.toString(16).padStart(6, '0')}`;
                return (
                  <label key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const nextChecked = e.target.checked;
                        setSelectedChannelIds((prev) => {
                          const base = prev.length ? prev : channels.map((x) => x.id);
                          if (nextChecked) return Array.from(new Set([...base, c.id]));
                          return base.filter((id) => id !== c.id);
                        });
                      }}
                    />
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: hex, display: 'inline-block' }} />
                    <Text size="2">{c.displayName || c.login}</Text>
                  </label>
                );
              })}
            </div>

            <Text size="2" color="gray" style={{ marginTop: 10 }}>
              Window
            </Text>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Text size="2" style={{ width: 90 }}>
                Past days
              </Text>
              <Button variant="soft" type="button" onClick={() => setPastDays((d) => Math.max(0, d - 1))}>
                -
              </Button>
              <input
                type="number"
                value={pastDays}
                min={0}
                max={365}
                onChange={(e) => setPastDays(clampInt(e.target.value, 0, 365))}
                style={{ width: 76 }}
              />
              <Button variant="soft" type="button" onClick={() => setPastDays((d) => Math.min(365, d + 1))}>
                +
              </Button>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Text size="2" style={{ width: 90 }}>
                Future days
              </Text>
              <Button variant="soft" type="button" onClick={() => setFutureDays((d) => Math.max(0, d - 1))}>
                -
              </Button>
              <input
                type="number"
                value={futureDays}
                min={0}
                max={365}
                onChange={(e) => setFutureDays(clampInt(e.target.value, 0, 365))}
                style={{ width: 76 }}
              />
              <Button variant="soft" type="button" onClick={() => setFutureDays((d) => Math.min(365, d + 1))}>
                +
              </Button>
            </label>

            <Text size="2" color="gray" style={{ marginTop: 10 }}>
              Origin
            </Text>
            <Text size="2" color="gray">
              {formatInTimeZoneClient(new Date(originTargetMs).toISOString(), userTimeZone || 'UTC')}
            </Text>
            <Text size="2" color="gray">
              Arrow keys: left = future, right = past
            </Text>
          </Flex>

          <div style={{ position: 'relative', flex: 1, minWidth: 420 }}>
            <div
              ref={containerRef}
              style={{
                height: 620,
                width: '100%',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.12)',
                overflow: 'hidden',
                background: 'rgba(255,255,255,0.02)',
                touchAction: 'none',
              }}
            />

            {hover?.item ? (
              <div
                style={{
                  position: 'absolute',
                  left: hover.x + 12,
                  top: hover.y + 12,
                  maxWidth: 360,
                  padding: 10,
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(10,10,10,0.92)',
                  pointerEvents: 'none',
                }}
              >
                <Text size="2" style={{ fontWeight: 600 }}>
                  {hover.item.channelLogin}
                </Text>
                <Text size="2" color="gray">
                  {hover.item.kind === 'video' ? 'Video' : hover.item.isCanceled ? 'Scheduled (canceled)' : 'Scheduled'}
                </Text>
                <Text size="2">{hover.item.title || '-'}</Text>
                <Text size="2" color="gray">
                  {Number.isFinite(hover.item.startMs)
                    ? formatInTimeZoneClient(new Date(hover.item.startMs).toISOString(), userTimeZone || 'UTC')
                    : '-'}
                </Text>
                <Text size="2" color="gray">
                  {Number.isFinite(hover.item.endMs)
                    ? formatInTimeZoneClient(new Date(hover.item.endMs).toISOString(), userTimeZone || 'UTC')
                    : '-'}
                </Text>
                {hover.item.url ? (
                  <Text size="2" color="gray">
                    Click to open
                  </Text>
                ) : null}
              </div>
            ) : null}
          </div>
        </Flex>

        <Text size="2" color="gray">
          Pan: drag. Zoom: mouse wheel.
        </Text>
      </Flex>
    </Card>
  );
}

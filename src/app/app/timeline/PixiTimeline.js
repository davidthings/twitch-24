'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Flex, Text } from '@radix-ui/themes';

import TimeZonePicker from '../settings/TimeZonePicker';

function parseColorHexToInt(hex) {
  const s = String(hex || '').trim();
  const m = s.match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return Number.isFinite(n) ? n : null;
}

function hashStringToIndex(s, mod) {
  const str = String(s || '');
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }

  return mod > 0 ? h % mod : 0;
}

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

export default function PixiTimeline({ userTimeZone, initialNowMs, isAdmin }) {
  const containerRef = useRef(null);
  const appRef = useRef(null);
  const requestRenderRef = useRef(() => {});
  const renderNowRef = useRef(() => {});

  const layoutAnimRef = useRef(0);
  const originAnimRef = useRef(0);

  const worldRef = useRef(null);
  const gridGfxRef = useRef(null);
  const gridLabelsLayerRef = useRef(null);
  const gridLabelTextsRef = useRef([]);
  const pixiTextCtorRef = useRef(null);
  const axesGfxRef = useRef(null);
  const eventsLayerRef = useRef(null);
  const eventGfxRef = useRef([]);

  const [layout, setLayout] = useState('linear');
  const [status, setStatus] = useState('');

  const [channels, setChannels] = useState([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState([]);
  const [pastDays, setPastDays] = useState(10);
  const [futureDays, setFutureDays] = useState(5);
  const [displayTimeZoneMode, setDisplayTimeZoneMode] = useState('user');
  const [customTimeZone, setCustomTimeZone] = useState(userTimeZone || 'UTC');

  const initialOriginMs = typeof initialNowMs === 'number' && Number.isFinite(initialNowMs) ? initialNowMs : Date.now();
  const [originTargetMs, setOriginTargetMs] = useState(() => initialOriginMs);
  const originAnimatedMsRef = useRef(initialOriginMs);
  const originTargetMsRef = useRef(initialOriginMs);

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

  function resolveDisplayTimeZoneForItem(item) {
    if (displayTimeZoneMode === 'utc') return 'UTC';
    if (displayTimeZoneMode === 'custom') return customTimeZone || userTimeZone || 'UTC';
    if (displayTimeZoneMode === 'channel') return item?.channelTimeZone || userTimeZone || 'UTC';
    return userTimeZone || 'UTC';
  }

  function resolveDisplayTimeZoneForAxes() {
    if (displayTimeZoneMode === 'utc') return 'UTC';
    if (displayTimeZoneMode === 'custom') return customTimeZone || userTimeZone || 'UTC';
    return userTimeZone || 'UTC';
  }

  function formatDateLabel(dateMs, timeZone) {
    const d = new Date(dateMs);
    if (Number.isNaN(d.getTime())) return '';
    try {
      return new Intl.DateTimeFormat(undefined, { timeZone, month: 'short', day: '2-digit' }).format(d);
    } catch {
      return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: '2-digit' }).format(d);
    }
  }

  function getZonedParts(dateMs, timeZone) {
    const d = new Date(dateMs);
    const fmt = new Intl.DateTimeFormat(undefined, {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = fmt.formatToParts(d);
    const get = (type) => parts.find((p) => p.type === type)?.value;

    const year = Number(get('year') || 0);
    const month = Number(get('month') || 1);
    const day = Number(get('day') || 1);
    const hour = Number(get('hour') || 0);
    const minute = Number(get('minute') || 0);
    const second = Number(get('second') || 0);

    return {
      year: Number.isNaN(year) ? 0 : year,
      month: Number.isNaN(month) ? 1 : month,
      day: Number.isNaN(day) ? 1 : day,
      hour: Number.isNaN(hour) ? 0 : hour,
      minute: Number.isNaN(minute) ? 0 : minute,
      second: Number.isNaN(second) ? 0 : second,
    };
  }

  function getZonedMidnightUtcMs(dateMs, timeZone) {
    const p = getZonedParts(dateMs, timeZone);
    let guess = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);

    for (let i = 0; i < 4; i += 1) {
      const gp = getZonedParts(guess, timeZone);
      const deltaMinutes = gp.hour * 60 + gp.minute;
      const dayDelta = Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(gp.year, gp.month - 1, gp.day);
      guess = guess + dayDelta - deltaMinutes * 60 * 1000;
    }

    return guess;
  }

  function setGridLabels(labels) {
    const layer = gridLabelsLayerRef.current;
    const TextCtor = pixiTextCtorRef.current;
    if (!layer || !TextCtor) return;

    const pool = gridLabelTextsRef.current;

    for (let i = pool.length; i < labels.length; i += 1) {
      const t = new TextCtor('', {
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        fontSize: 12,
        fill: 0xffffff,
        align: 'center',
      });
      t.alpha = 0.8;
      pool.push(t);
      layer.addChild(t);
    }

    for (let i = 0; i < labels.length; i += 1) {
      const l = labels[i];
      const t = pool[i];
      t.text = l.text;
      t.position.set(l.x, l.y);
      t.anchor?.set?.(0.5, 0.5);
      t.visible = true;
    }

    for (let i = labels.length; i < pool.length; i += 1) {
      pool[i].visible = false;
    }
  }

  function resetView() {
    const app = appRef.current;
    const world = worldRef.current;
    if (!app || !world) return;

    world.scale.set(1);
    world.position.set(app.screen.width * 0.5, app.screen.height * 0.5);
    requestRenderRef.current();
  }

  function animateLayoutTo(nextLayout) {
    const target = nextLayout === 'spiral' ? 1 : 0;
    const start = layoutBlendRef.current;
    if (Math.abs(target - start) < 0.001) {
      layoutBlendRef.current = target;
      setLayoutBlend(target);
      redrawTimeline();
      requestRenderRef.current();
      return;
    }

    const myId = (layoutAnimRef.current || 0) + 1;
    layoutAnimRef.current = myId;

    const startT = performance.now();
    const durationMs = 260;

    const step = (now) => {
      if (layoutAnimRef.current !== myId) return;
      const t = Math.max(0, Math.min(1, (now - startT) / durationMs));
      const eased = easeInOutCubic(t);
      const v = start + (target - start) * eased;
      layoutBlendRef.current = v;
      setLayoutBlend(v);
      redrawTimeline();
      requestRenderRef.current();
      if (t < 1) requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  }

  function animateOriginTo(nextOriginMs) {
    const target = typeof nextOriginMs === 'number' && Number.isFinite(nextOriginMs) ? nextOriginMs : Date.now();

    setOriginTargetMs(target);
    originTargetMsRef.current = target;

    const start = originAnimatedMsRef.current;
    if (!Number.isFinite(start) || Math.abs(target - start) < 1) {
      originAnimatedMsRef.current = target;
      redrawTimeline();
      requestRenderRef.current();
      return;
    }

    const myId = (originAnimRef.current || 0) + 1;
    originAnimRef.current = myId;

    const startT = performance.now();
    const durationMs = 320;

    const step = (now) => {
      if (originAnimRef.current !== myId) return;
      const t = Math.max(0, Math.min(1, (now - startT) / durationMs));
      const eased = easeInOutCubic(t);
      const v = start + (target - start) * eased;
      originAnimatedMsRef.current = v;
      redrawTimeline();
      requestRenderRef.current();
      if (t < 1) requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  }

  const palette = useMemo(
    () => [0x60a5fa, 0xa78bfa, 0x34d399, 0xfbbf24, 0xf87171, 0x22c55e, 0x38bdf8, 0xfb7185, 0xf97316, 0x94a3b8],
    []
  );

  const colorByChannelId = useMemo(() => {
    const m = new Map();
    for (let i = 0; i < channels.length; i += 1) {
      const c = channels[i];
      const stored = parseColorHexToInt(c.colorHex);
      if (stored !== null) {
        m.set(c.id, stored);
      } else {
        const idx = hashStringToIndex(c.id || c.login, palette.length);
        m.set(c.id, palette[idx]);
      }
    }
    return m;
  }, [channels, palette]);

  const colorCssByChannelId = useMemo(() => {
    const m = new Map();
    for (let i = 0; i < channels.length; i += 1) {
      const c = channels[i];
      const stored = String(c.colorHex || '').trim();
      if (stored.match(/^#[0-9a-fA-F]{6}$/)) {
        m.set(c.id, stored);
      } else {
        const n = colorByChannelId.get(c.id);
        const hex = typeof n === 'number' ? `#${n.toString(16).padStart(6, '0')}` : '#94a3b8';
        m.set(c.id, hex);
      }
    }
    return m;
  }, [channels, colorByChannelId]);

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

    const theta = spiralDay * Math.PI * 2 - Math.PI / 2;

    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    return { x, y };
  }

  function redrawTimeline() {
    const app = appRef.current;
    const axes = axesGfxRef.current;
    const eventsLayer = eventsLayerRef.current;
    const gridGfx = gridGfxRef.current;

    if (!app || !axes || !eventsLayer || !gridGfx) return;

    const originMs = originAnimatedMsRef.current;
    const blend = layoutBlendRef.current;

    const selectedSet = new Set(selectedChannelIds.length ? selectedChannelIds : channels.map((c) => c.id));
    const orderedSelected = channels.filter((c) => selectedSet.has(c.id)).map((c) => c.id);
    const channelOrder = new Map(orderedSelected.map((id, idx) => [id, idx]));
    const channelCount = orderedSelected.length;

    axes.clear();
    gridGfx.clear();

    const blendIsZero = Math.abs(blend) < 0.001;

    const spiralBaseRadius = 30;
    const spiralOuterRadius = Math.max(80, Math.min(app.screen.width, app.screen.height) * 0.5 - 44);
    const spiralTotalDays = Math.max(1, pastDays + futureDays);
    const spiralDayStep = (spiralOuterRadius - spiralBaseRadius) / spiralTotalDays;
    const spiralOriginRadius = spiralBaseRadius + futureDays * spiralDayStep;

    const axesTimeZone = resolveDisplayTimeZoneForAxes();
    const originMidnightMs = getZonedMidnightUtcMs(originMs, axesTimeZone);

    const laneY = 64;
    const laneGap = 42;
    const maxLaneY = channelCount ? laneY + (channelCount - 1) * laneGap : laneY;

    if (layout === 'linear') {
      const baselineY = 42;
      const gridBottom = maxLaneY + 30;

      gridGfx.lineStyle(1, 0xffffff, 0.06);

      const startTickMs = originMidnightMs - pastDays * dayMs;
      const endTickMs = originMidnightMs + (futureDays + 1) * dayMs;

      const labels = [];

      for (let tMs = startTickMs; tMs <= endTickMs; tMs += 60 * 60 * 1000) {
        const x = ((tMs - originMs) / dayMs) * 180;
        const p = getZonedParts(tMs, axesTimeZone);
        const isMidnight = p.hour === 0 && p.minute === 0;
        const isMajor = p.hour % 6 === 0 && p.minute === 0;

        if (!isMidnight) {
          gridGfx.lineStyle(1, 0xffffff, isMajor ? 0.06 : 0.03);
          gridGfx.moveTo(x, baselineY);
          gridGfx.lineTo(x, gridBottom);
        }

        const tickLen = isMajor ? 10 : 6;
        gridGfx.lineStyle(1, 0xffffff, isMajor ? 0.18 : 0.12);
        gridGfx.moveTo(x, baselineY - tickLen);
        gridGfx.lineTo(x, baselineY + tickLen);

        if (isMajor) {
          labels.push({
            text: String(p.hour).padStart(2, '0'),
            x,
            y: 34,
          });
        }
      }

      for (let tMs = startTickMs; tMs <= endTickMs; tMs += dayMs) {
        const x = ((tMs - originMs) / dayMs) * 180;
        gridGfx.lineStyle(1, 0xffffff, 0.08);
        gridGfx.moveTo(x, baselineY);
        gridGfx.lineTo(x, gridBottom);

        labels.push({
          text: formatDateLabel(tMs, axesTimeZone),
          x,
          y: 18,
        });
      }

      setGridLabels(labels);

      axes.lineStyle(2, 0xffffff, 0.18);
      axes.moveTo(0, baselineY);
      axes.lineTo(0, gridBottom);
      axes.lineStyle(1, 0xffffff, 0.14);
      axes.moveTo(-999999, baselineY);
      axes.lineTo(999999, baselineY);
    } else {
      gridGfx.lineStyle(1, 0xffffff, 0.08);

      const labels = [];

      const outerMostRadius = spiralOriginRadius + pastDays * spiralDayStep;
      const tickBaseInner = outerMostRadius + 6;
      const tickBaseOuter = outerMostRadius + 16;
      const tickMajorOuter = outerMostRadius + 22;
      const labelRadius = outerMostRadius + 40;

      const outerAxisRadius = tickBaseInner;

      for (let q = 0; q < 96; q += 1) {
        const hour = (q / 96) * 24;
        const isHour = q % 4 === 0;
        if (isHour) continue;

        const theta = (hour / 24) * Math.PI * 2 - Math.PI / 2;
        const isHalfHour = q % 2 === 0;

        gridGfx.lineStyle(1, 0xffffff, isHalfHour ? 0.08 : 0.05);

        const x0 = outerAxisRadius * Math.cos(theta);
        const y0 = outerAxisRadius * Math.sin(theta);
        const tickOuter = outerAxisRadius + (isHalfHour ? 7 : 5);
        const x1 = tickOuter * Math.cos(theta);
        const y1 = tickOuter * Math.sin(theta);
        gridGfx.moveTo(x0, y0);
        gridGfx.lineTo(x1, y1);
      }

      for (let h = 0; h < 24; h += 1) {
        const theta = (h / 24) * Math.PI * 2 - Math.PI / 2;
        const isMajor = h % 6 === 0;

        gridGfx.lineStyle(1, 0xffffff, isMajor ? 0.16 : 0.08);

        const x0 = tickBaseInner * Math.cos(theta);
        const y0 = tickBaseInner * Math.sin(theta);

        const tickOuter = isMajor ? tickMajorOuter : tickBaseOuter;
        const x1 = tickOuter * Math.cos(theta);
        const y1 = tickOuter * Math.sin(theta);
        gridGfx.moveTo(x0, y0);
        gridGfx.lineTo(x1, y1);

        labels.push({
          text: String(h).padStart(2, '0'),
          x: labelRadius * Math.cos(theta),
          y: labelRadius * Math.sin(theta),
        });
      }

      const startDayMs = originMidnightMs - pastDays * dayMs;
      const endDayMs = originMidnightMs + futureDays * dayMs;

      for (let tMs = startDayMs; tMs <= endDayMs; tMs += dayMs) {
        const p = computeSpiralPoint(tMs, 0, 1, originMs, spiralOriginRadius, spiralDayStep, axesTimeZone);
        const r = Math.hypot(p.x, p.y);
        const s = r > 0 ? (r + 14) / r : 1;

        labels.push({
          text: formatDateLabel(tMs, axesTimeZone),
          x: p.x * s,
          y: p.y * s,
        });
      }

      setGridLabels(labels);

      axes.lineStyle(2, 0xffffff, 0.14);
      axes.drawCircle(0, 0, spiralOriginRadius);
      axes.lineStyle(1, 0xffffff, 0.12);
      axes.drawCircle(0, 0, outerAxisRadius);

      const spiralStartMs = originMs + futureDays * dayMs;
      const spiralEndMs = originMs - pastDays * dayMs;
      const spiralDurationMs = Math.max(1, spiralStartMs - spiralEndMs);
      const spiralDays = spiralDurationMs / dayMs;
      const axisPoints = Math.max(64, Math.min(2400, Math.ceil(spiralDays * 96) + 1));

      axes.lineStyle(1, 0xffffff, 0.08);
      for (let i = 0; i < axisPoints; i += 1) {
        const tt = spiralStartMs - (spiralDurationMs * i) / (axisPoints - 1);
        const p = computeSpiralPoint(tt, 0, 1, originMs, spiralOriginRadius, spiralDayStep, axesTimeZone);
        if (i === 0) axes.moveTo(p.x, p.y);
        else axes.lineTo(p.x, p.y);
      }
    }
    const gfxList = eventGfxRef.current;
    const allItems = itemsRef.current;

    for (let i = 0; i < allItems.length; i += 1) {
      const it = allItems[i];
      if (!channelOrder.has(it.channelId)) continue;
      const idx = channelOrder.get(it.channelId);
      const y0 = 140 + idx * 44;

      const startMs = it.startMs;
      const endMs = it.endMs;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;

      const aMs = Math.min(startMs, endMs);
      const bMs = Math.max(startMs, endMs);

      const channelTz = resolveDisplayTimeZoneForItem(it);

      const g = gfxList[i];
      if (!g) continue;

      g.clear();

      const color = colorByChannelId.get(it.channelId) || 0x94a3b8;
      const alpha = it.kind === 'scheduled' && it.isCanceled ? 0.18 : it.kind === 'scheduled' ? 0.55 : 0.8;
      const baseThickness = it.kind === 'video' ? 10 : 8;
      const blendClamped = Math.max(0, Math.min(1, blend));
      const thickness = baseThickness * (1 - 0.625 * blendClamped);
      const pad = thickness * 0.75 + 8;

      if (blendIsZero) {
        const linearA = computeLinearPoint(aMs, idx, originMs);
        const linearB = computeLinearPoint(bMs, idx, originMs);

        g.lineStyle(thickness, color, alpha);
        g.moveTo(linearA.x, linearA.y);
        g.lineTo(linearB.x, linearB.y);

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
          points = Math.ceil(days * 48) + 1;
        }
        points = Math.max(2, Math.min(160, points));

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
          } else {
            g.lineTo(x, y);
          }
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

  function applyTimelineJson(json) {
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
  }

  useEffect(() => {
    let destroyed = false;

    async function init() {
      const el = containerRef.current;
      if (!el) return;

      const { Application, Container, Graphics, Text: PixiText, Rectangle } = await import('pixi.js');

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

      pixiTextCtorRef.current = PixiText;

      const gridGfx = new Graphics();
      gridGfxRef.current = gridGfx;
      world.addChild(gridGfx);

      const gridLabelsLayer = new Container();
      gridLabelsLayerRef.current = gridLabelsLayer;
      world.addChild(gridLabelsLayer);

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
      redrawTimeline();
      renderNow();

      const onResize = () => {
        app.stage.hitArea = app.screen;
        resetView();
        redrawTimeline();
        requestRender();
      };

      window.addEventListener('resize', onResize);

      return () => {
        window.removeEventListener('resize', onResize);
        el.removeEventListener('wheel', onWheel);
        requestRenderRef.current = () => {};
        renderNowRef.current = () => {};
        pixiTextCtorRef.current = null;
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
      const cfgModeRaw = cfg?.displayTimeZoneMode !== undefined ? String(cfg.displayTimeZoneMode) : 'user';
      const cfgMode =
        cfgModeRaw === 'utc' || cfgModeRaw === 'user' || cfgModeRaw === 'channel' || cfgModeRaw === 'custom' ? cfgModeRaw : 'user';

      const cfgCustomTzRaw = cfg?.customTimeZone !== undefined ? String(cfg.customTimeZone || '').trim() : '';
      const cfgCustomTz = cfgCustomTzRaw || userTimeZone || 'UTC';

      setPastDays(cfgPast);
      setFutureDays(cfgFuture);
      if (cfgSelected.length) setSelectedChannelIds(cfgSelected);
      setDisplayTimeZoneMode(cfgMode);
      setCustomTimeZone(cfgCustomTz);

      try {
        setStatus('Loading…');
        const json = await loadTimelineData({
          originMs: originTargetMsRef.current,
          past: cfgPast,
          future: cfgFuture,
          selectedIds: cfgSelected,
        });
        if (!mounted) return;

        applyTimelineJson(json);
        setSelectedChannelIds((prev) => (cfgSelected.length ? cfgSelected : prev.length ? prev : json.selectedChannelIds || []));

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
        displayTimeZoneMode,
        customTimeZone,
      });
    }, 600);

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [selectedChannelIds, pastDays, futureDays, displayTimeZoneMode, customTimeZone]);

  useEffect(() => {
    if (displayTimeZoneMode !== 'custom') return;
    if (!customTimeZone) return;
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: customTimeZone }).format(new Date());
    } catch {
      setCustomTimeZone(userTimeZone || 'UTC');
    }
  }, [customTimeZone, displayTimeZoneMode, userTimeZone]);

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

  async function reorderChannel(channelId, direction) {
    if (!isAdmin) return;
    try {
      setStatus('Reordering…');
      const res = await fetch('/api/twitch/channels/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, direction }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Reorder failed: ${res.status} ${text}`);
      }

      const json = await loadTimelineData({
        originMs: originTargetMsRef.current,
        past: pastDays,
        future: futureDays,
        selectedIds: selectedChannelIds,
      });
      applyTimelineJson(json);
      setStatus('');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Failed to reorder');
    }
  }

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
  }, [items, channels, selectedChannelIds, pastDays, futureDays, displayTimeZoneMode, customTimeZone, layoutBlend]);

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
                const hex = colorCssByChannelId.get(c.id) || '#94a3b8';
                return (
                  <Flex key={c.id} gap="2" align="center" wrap="wrap">
                    <label style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1, minWidth: 180 }}>
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

                    {isAdmin ? (
                      <Flex gap="1" align="center">
                        <Button variant="soft" type="button" onClick={() => reorderChannel(c.id, 'up')}>
                          Up
                        </Button>
                        <Button variant="soft" type="button" onClick={() => reorderChannel(c.id, 'down')}>
                          Down
                        </Button>
                      </Flex>
                    ) : null}
                  </Flex>
                );
              })}
            </div>

            <Text size="2" color="gray" style={{ marginTop: 10 }}>
              Window
            </Text>

            <Text size="2" color="gray" style={{ marginTop: 10 }}>
              Timezone
            </Text>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Text size="2" style={{ width: 90 }}>
                Display
              </Text>
              <select
                value={displayTimeZoneMode}
                onChange={(e) => {
                  const v = String(e.target.value);
                  setDisplayTimeZoneMode(v === 'utc' || v === 'user' || v === 'channel' || v === 'custom' ? v : 'user');
                }}
              >
                <option value="user">User</option>
                <option value="utc">UTC</option>
                <option value="channel">Channel-local</option>
                <option value="custom">Custom…</option>
              </select>
            </label>

            {displayTimeZoneMode === 'custom' ? (
              <TimeZonePicker
                initialTimeZone={customTimeZone || userTimeZone || 'UTC'}
                fieldName="__ignored"
                recentsStorageKey="t24_recent_timeline_custom_time_zones_v1"
                onChange={(tz) => setCustomTimeZone(tz)}
              />
            ) : null}

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
              {formatInTimeZoneClient(new Date(originTargetMs).toISOString(), resolveDisplayTimeZoneForAxes())}
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

            <div
              style={{
                position: 'absolute',
                left: 12,
                top: 10,
                padding: '6px 10px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(10,10,10,0.55)',
                pointerEvents: 'none',
              }}
            >
              <Text size="2" color="gray">
                TZ:{' '}
                <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                  {resolveDisplayTimeZoneForAxes()}
                </span>
              </Text>
            </div>

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
                    ? formatInTimeZoneClient(new Date(hover.item.startMs).toISOString(), resolveDisplayTimeZoneForItem(hover.item))
                    : '-'}
                </Text>
                <Text size="2" color="gray">
                  {Number.isFinite(hover.item.endMs)
                    ? formatInTimeZoneClient(new Date(hover.item.endMs).toISOString(), resolveDisplayTimeZoneForItem(hover.item))
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

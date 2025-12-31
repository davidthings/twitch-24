export function createServerTimelineDataSource() {
  return {
    async loadConfig() {
      try {
        const res = await fetch('/api/timeline/config', { cache: 'no-store' });
        if (!res.ok) return null;
        const json = await res.json();
        if (!json?.ok) return null;
        return json.timelineConfig || null;
      } catch {
        return null;
      }
    },

    async saveConfig(next) {
      try {
        await fetch('/api/timeline/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        });
      } catch {
      }
    },

    async loadTimelineData({ originMs, pastDays, futureDays, channelIds }) {
      const url = new URL('/api/timeline', window.location.origin);
      url.searchParams.set('originMs', String(originMs));
      url.searchParams.set('pastDays', String(pastDays));
      url.searchParams.set('futureDays', String(futureDays));
      if (channelIds && channelIds.length) {
        url.searchParams.set('channelIds', channelIds.join(','));
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
    },

    async reorderChannel({ channelId, direction }) {
      const res = await fetch('/api/twitch/channels/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, direction }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Reorder failed: ${res.status} ${text}`);
      }

      const json = await res.json().catch(() => null);
      if (json && typeof json === 'object' && json.ok === false) {
        return { ok: false, error: json.error || 'Reorder failed' };
      }

      return { ok: true, moved: Boolean(json?.moved) };
    },
  };
}

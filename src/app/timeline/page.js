'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, Flex, Heading, Text } from '@radix-ui/themes';

import PixiTimeline from '@/server-app/timeline/PixiTimeline';
import { createStaticTimelineDataSource } from '@/lib/staticTimelineDataSource';

function getSystemTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export default function StaticTimelinePage() {
  const dataSource = useMemo(() => createStaticTimelineDataSource(), []);
  const tz = useMemo(() => getSystemTimeZone(), []);
  const [nowMs, setNowMs] = useState(null);

  useEffect(() => {
    setNowMs(Date.now());
  }, []);

  return (
    <Flex direction="column" gap="4">
      <Card>
        <Flex direction="column" gap="2">
          <Heading size="4">Timeline</Heading>
          <Text color="gray" size="2">
            Static mode: channels + settings come from localStorage.
          </Text>
        </Flex>
      </Card>

      {typeof nowMs === 'number' ? <PixiTimeline userTimeZone={tz} initialNowMs={nowMs} isAdmin={true} dataSource={dataSource} /> : null}
    </Flex>
  );
}

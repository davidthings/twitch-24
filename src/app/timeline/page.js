'use client';

import { useMemo } from 'react';
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

      <PixiTimeline userTimeZone={tz} initialNowMs={Date.now()} isAdmin={true} dataSource={dataSource} />
    </Flex>
  );
}

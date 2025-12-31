import { Card, Flex, Heading, Text } from '@radix-ui/themes';

export default function HomePage() {
  return (
    <Card>
      <Flex direction="column" gap="2">
        <Heading size="4">Welcome</Heading>
        <Text color="gray">
          Static build smoke test: use Twitch OAuth and verify Helix access.
        </Text>
        <Text color="gray">
          Start at <a href="/twitch/login/">/twitch/login/</a>.
        </Text>
      </Flex>
    </Card>
  );
}

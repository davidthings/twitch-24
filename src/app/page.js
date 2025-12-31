import { Card, Flex, Heading, Text } from '@radix-ui/themes';

export default function HomePage() {
  return (
    <Card>
      <Flex direction="column" gap="2">
        <Heading size="4">Welcome</Heading>
        <Text color="gray">
          This is the starting point for the hosted Twitch analysis app.
        </Text>
      </Flex>
    </Card>
  );
}

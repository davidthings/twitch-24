import '@radix-ui/themes/styles.css';
import './globals.css';

import { Theme, Container, Flex, Heading } from '@radix-ui/themes';
import Providers from './providers';
import Nav from './Nav';

export const metadata = {
  title: 'twitch-24',
  description: 'Twitch analysis tools',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Theme appearance="dark" accentColor="purple" grayColor="slate" radius="medium">
            <Container size="3" p="4">
              <Flex direction="column" gap="4">
                <Flex align="center" justify="between">
                  <Heading size="6">twitch-24</Heading>
                  <Nav />
                </Flex>
                {children}
              </Flex>
            </Container>
          </Theme>
        </Providers>
      </body>
    </html>
  );
}

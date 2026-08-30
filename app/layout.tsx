import type { Metadata } from 'next';
import { Bacasime_Antique, Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const bacasimeAntique = Bacasime_Antique({
  variable: '--font-display',
  subsets: ['latin'],
  weight: '400',
});

export const metadata: Metadata = {
  title: 'RouteShift — when reality changes, the interface changes with it',
  description:
    'Create a global delivery and watch a flow-native interface adapt historical logistics disruptions to today.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${bacasimeAntique.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

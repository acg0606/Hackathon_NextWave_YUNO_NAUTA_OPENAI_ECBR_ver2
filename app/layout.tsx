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
  title: 'RouteShift — a realidade muda, a interface também',
  description:
    'Crie uma entrega global e teste como ela responderia hoje a incidentes logísticos históricos.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${bacasimeAntique.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

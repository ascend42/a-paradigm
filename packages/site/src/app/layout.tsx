import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import './globals.css';

const geistSans = localFont({
  src: [{ path: './fonts/GeistVF.woff2' }],
  variable: '--font-geist-sans',
  display: 'swap',
});

const geistMono = localFont({
  src: [{ path: './fonts/GeistMonoVF.woff2' }],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Paradigm — The Context Engineering Framework',
    template: '%s | Paradigm',
  },
  description:
    'The context engineering framework for AI-native development. Structure your codebase so AI agents understand it.',
  metadataBase: new URL('https://useparadigm.dev'),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://useparadigm.dev',
    siteName: 'Paradigm',
    title: 'Paradigm — The Context Engineering Framework',
    description:
      'Structure your codebase so AI agents understand it. Five symbols. Infinite clarity.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Paradigm — The Context Engineering Framework',
    description:
      'Structure your codebase so AI agents understand it. Five symbols. Infinite clarity.',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('paradigm-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}

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
    default: 'Paradigm — Structure for AI-assisted development',
    template: '%s | Paradigm',
  },
  description:
    'Structure for AI-assisted development: a symbol graph built from files in your repo, hooks that are scripts, and decisions on record.',
  metadataBase: new URL('https://useparadigm.dev'),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://useparadigm.dev',
    siteName: 'Paradigm',
    title: 'Paradigm — Structure for AI-assisted development',
    description:
      'Structure your codebase so AI agents understand it. Five symbols, one symbol graph.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Paradigm — Structure for AI-assisted development',
    description:
      'Structure your codebase so AI agents understand it. Five symbols, one symbol graph.',
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

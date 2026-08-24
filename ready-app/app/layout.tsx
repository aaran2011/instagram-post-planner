import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ready? — are you actually ready?',
  description:
    'AI-powered outfit, appearance, setup and preparation checks for whatever you are about to walk into. Interview, wedding, presentation or date.',
  applicationName: 'Ready?',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Ready?' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The camera stage is a full-height layout; letting it zoom breaks framing
  // guidance, but pinch-zoom stays available everywhere for accessibility.
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf7f4' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0a15' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[color:var(--ink)] focus:px-5 focus:py-3 focus:text-[color:var(--paper)]"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}

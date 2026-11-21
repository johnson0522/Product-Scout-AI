import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Product Scout',
  description: 'AI-powered product research and opportunity analysis',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body><header><Link href="/" className="brand">Product Scout <span>AI</span></Link><nav aria-label="Main navigation"><Link href="/projects">Projects</Link><Link href="/research">Research</Link></nav></header>{children}<footer>Evidence first. Reasoning second. Product decision third.</footer></body>
    </html>
  );
}

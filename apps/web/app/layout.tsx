import type { Metadata } from 'next';

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
      <body className="min-h-screen bg-gray-50">{children}</body>
    </html>
  );
}

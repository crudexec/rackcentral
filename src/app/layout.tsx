import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Racking Maintenance Visualizer',
  description: '3D warehouse racking visualization with maintenance tracking',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

'use client';

import dynamic from 'next/dynamic';

const RackingVisualizer = dynamic(
  () => import('@/components/RackingVisualizer'),
  { ssr: false }
);

export default function Home() {
  return <RackingVisualizer />;
}

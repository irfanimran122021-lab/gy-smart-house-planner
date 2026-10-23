import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'GY Smart House Planner · Architectural workspace',
  description:
    'Measured architectural planning for Guyana. Create, edit, check and export coordinated vector drawings for professional review.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

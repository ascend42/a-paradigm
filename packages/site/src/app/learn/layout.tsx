import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    default: 'University',
    template: '%s | Paradigm University',
  },
  description: 'Learn context engineering with structured courses, quizzes, and PLSAT certification.',
};

export default function LearnLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div data-section="university">
      {children}
    </div>
  );
}

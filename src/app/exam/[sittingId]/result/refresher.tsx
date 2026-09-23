'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/** While the marker is at work: look again every few seconds, for a few minutes, then stop. */
export function Refresher() {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries > 40) return;
    const t = setTimeout(() => {
      router.refresh();
      setTries((n) => n + 1);
    }, 6000);
    return () => clearTimeout(t);
  }, [tries, router]);
  return (
    <p className="exam-toast" role="status">
      Schreiben und Sprechen werden gerade bewertet. Diese Seite aktualisiert sich von selbst.
    </p>
  );
}

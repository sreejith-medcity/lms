'use client';

import { useState } from 'react';
import { Field, Select } from '@/components/ui';
import { TutorLeaveForm } from '@/components/tutoring/forms';

/** Leave entered by the office for a tutor is approved as it is entered. */
export function TutorPicker({ tutors, today }: { tutors: { id: string; name: string }[]; today: string }) {
  const [id, setId] = useState('');
  if (!tutors.length) return <p className="t-small muted">No tutors yet.</p>;
  return (
    <div className="space-y-4">
      <Field label="Tutor">
        <Select value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Choose…</option>
          {tutors.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      {id && <TutorLeaveForm key={id} today={today} userId={id} />}
    </div>
  );
}

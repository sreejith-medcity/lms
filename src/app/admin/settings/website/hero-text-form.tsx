'use client';

import { useState, useTransition } from 'react';
import { saveSetting } from '@/server/settings';
import { Button, Field, FormError, FormSuccess, Input, Textarea } from '@/components/ui';

/**
 * The words in the home page hero.
 *
 * They are ordinary settings and the Preferences screen can edit them, but
 * nobody writes a headline in a list of switches. They belong beside the
 * photograph they sit next to, in fields big enough to read the sentence in.
 */
export function HeroTextForm({
  values,
  canEdit,
}: {
  values: { eyebrow: string; title: string; highlight: string; blurb: string };
  canEdit: boolean;
}) {
  const [draft, setDraft] = useState(values);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [pending, start] = useTransition();

  const set = (key: keyof typeof draft) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = () =>
    start(async () => {
      setError(undefined);
      setMessage(undefined);

      const writes: [string, string][] = [
        ['website.heroEyebrow', draft.eyebrow],
        ['website.heroTitle', draft.title],
        ['website.heroHighlight', draft.highlight],
        ['website.heroBlurb', draft.blurb],
      ];

      // One at a time rather than in parallel: they write to the same table
      // and a failure halfway through should stop rather than race.
      for (const [key, value] of writes) {
        const res = await saveSetting(key, value);
        if (res.error) {
          setError(`${res.error} (${key})`);
          return;
        }
      }
      setMessage('Saved. The home page is showing this now.');
    });

  return (
    <div className="space-y-3">
      <Field
        label="Headline"
        hint="The first thing a stranger reads. Say what they get, not what you are."
      >
        <Input
          value={draft.title}
          maxLength={120}
          disabled={!canEdit || pending}
          onChange={(e) => set('title')(e.target.value)}
        />
      </Field>

      <Field label="Second line" hint="Shown underneath in amber. Leave blank for a one-line headline.">
        <Input
          value={draft.highlight}
          maxLength={120}
          disabled={!canEdit || pending}
          onChange={(e) => set('highlight')(e.target.value)}
        />
      </Field>

      <Field label="The sentence under it" hint="Two lines at most. What the courses are and who they are for.">
        <Textarea
          rows={3}
          value={draft.blurb}
          maxLength={400}
          disabled={!canEdit || pending}
          onChange={(e) => set('blurb')(e.target.value)}
        />
      </Field>

      <Field
        label="A short line above the headline"
        hint="For something time-bound: an intake opening, a launch. Blank hides it, which is usually right."
      >
        <Input
          value={draft.eyebrow}
          maxLength={80}
          placeholder="January intake now open"
          disabled={!canEdit || pending}
          onChange={(e) => set('eyebrow')(e.target.value)}
        />
      </Field>

      <FormError message={error} />
      <FormSuccess message={message} />

      {canEdit && (
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? 'Saving...' : 'Save wording'}
        </Button>
      )}
    </div>
  );
}

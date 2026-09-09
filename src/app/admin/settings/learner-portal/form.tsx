'use client';

import { useActionState, useState } from 'react';
import { saveLearnerNav } from '@/server/settings';
import type { ActionState } from '@/server/courses';
import { LEARNER_NAV_ITEMS } from '@/lib/learner-nav';
import { Button, FormError, FormSuccess } from '@/components/ui';

const initial: ActionState = {};

export function LearnerNavForm({ current, canEdit }: { current: string[]; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveLearnerNav, initial);
  const [chosen, setChosen] = useState<string[]>(current);

  const available = LEARNER_NAV_ITEMS.filter((i) => !chosen.includes(i.key));

  function move(index: number, direction: -1 | 1) {
    const next = [...chosen];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setChosen(next);
  }

  return (
    <form action={action} className="space-y-4">
      {chosen.map((key) => (
        <input key={key} type="hidden" name="navKeys" value={key} />
      ))}

      <ol className="divide-y rounded-[var(--radius-sm)] border">
        {chosen.map((key, i) => {
          const item = LEARNER_NAV_ITEMS.find((n) => n.key === key);
          if (!item) return null;
          const required = key === 'learning';

          return (
            <li key={key} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="t-micro faint">{item.href}</span>
              </span>
              <span className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Move up"
                  disabled={!canEdit || i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Move down"
                  disabled={!canEdit || i === chosen.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!canEdit || required}
                  title={required ? 'Learners always need a way back to their courses' : undefined}
                  onClick={() => setChosen(chosen.filter((k) => k !== key))}
                >
                  Remove
                </Button>
              </span>
            </li>
          );
        })}
      </ol>

      {available.length > 0 && canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="t-small faint">Add:</span>
          {available.map((item) => (
            <Button
              key={item.key}
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setChosen([...chosen, item.key])}
            >
              {item.label}
            </Button>
          ))}
        </div>
      )}

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      {canEdit && (
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      )}
    </form>
  );
}

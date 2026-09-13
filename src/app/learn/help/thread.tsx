import { formatDateTime } from '@/lib/clock';

export interface ThreadMessage {
  id: string;
  fromStaff: boolean;
  body: string;
  attachmentIds: string[];
  createdAt: Date;
  authorName: string | null;
}

/** The exchange, learner on one side and the office on the other. Shared by both screens. */
export function Thread({ messages, timezone, viewer, attachments }: { messages: ThreadMessage[]; timezone: string; viewer: 'learner' | 'staff'; attachments: Map<string, { fileName: string }> }) {
  return (
    <ol className="space-y-3">
      {messages.map((m) => {
        const mine = viewer === 'staff' ? m.fromStaff : !m.fromStaff;
        return (
          <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-[var(--radius)] border px-4 py-3 ${mine ? 'bg-[var(--brand-soft)]' : 'bg-[var(--surface)]'}`}>
              <p className="t-micro faint">
                {m.fromStaff ? (m.authorName ? `${m.authorName}, the office` : 'The office') : m.authorName ?? 'Learner'} · {formatDateTime(m.createdAt, timezone)}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
              {m.attachmentIds.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {m.attachmentIds.map((id) => (
                    <li key={id}>
                      <a href={`/api/assets/${id}?download=1`} className="t-small underline" target="_blank" rel="noreferrer">
                        {attachments.get(id)?.fileName ?? 'attachment'}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

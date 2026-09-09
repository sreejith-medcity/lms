'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { $Enums } from '@prisma/client';
import {
  updateBatch,
  setBatchStaff,
  setBatchModules,
  setEnrollmentStatus,
} from '@/server/batch';
import type { ActionState } from '@/server/courses';
import {
  Badge,
  Button,
  Card,
  Cell,
  Checkbox,
  EmptyState,
  Field,
  FormError,
  FormSuccess,
  Input,
  ProgressRing,
  Row,
  Select,
  Table,
} from '@/components/ui';

/**
 * One batch, four questions.
 *
 * Tabs rather than pages: switching between "who is falling behind" and "was
 * Tuesday's class actually held" is a comparison, and a comparison you have to
 * navigate between is a comparison you stop making.
 */

export interface ClassroomLearner {
  enrollmentId: string;
  userId: string;
  name: string;
  contact: string;
  status: string;
  progress: number;
  attended: number;
  attendanceRate: number | null;
  averageScore: number | null;
  assessmentsTaken: number;
  assessmentsPassed: number;
  joinedAt: string;
}

export interface ClassroomSession {
  id: string;
  title: string;
  startsAt: string;
  status: string;
  present: number;
  late: number;
}

interface Props {
  canEdit: boolean;
  batch: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    capacity: number;
    isDefault: boolean;
  };
  learners: ClassroomLearner[];
  sessions: ClassroomSession[];
  roster: number;
  totalLessons: number;
  courseModules: { id: string; name: string; lessons: number }[];
  selectedModules: string[];
  staff: { userId: string; role: string }[];
  team: { id: string; name: string }[];
}

const TABS = ['Learners', 'Classes', 'Curriculum', 'Team and settings'] as const;
type Tab = (typeof TABS)[number];

const STATUSES: { value: $Enums.EnrollmentStatus; label: string }[] = [
  { value: 'REGISTERED', label: 'Registered' },
  { value: 'ENROLLED', label: 'Enrolled' },
  { value: 'ON_LEAVE', label: 'On leave' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const ROLES: { value: $Enums.BatchRole; label: string; hint: string }[] = [
  { value: 'PRIMARY_TUTOR', label: 'Tutor', hint: 'Teaches the classes' },
  { value: 'BATCH_MANAGER', label: 'Manager', hint: 'Owns the batch' },
  { value: 'ADDITIONAL_MANAGER', label: 'Co-manager', hint: 'Shares the batch' },
  { value: 'ASSISTANT', label: 'Assistant', hint: 'Helps out' },
];

function statusTone(status: string): 'ok' | 'warn' | 'bad' | 'neutral' | 'brand' {
  if (status === 'ENROLLED') return 'ok';
  if (status === 'COMPLETED') return 'brand';
  if (status === 'ON_LEAVE') return 'warn';
  if (status === 'CANCELLED' || status === 'EXPIRED') return 'bad';
  return 'neutral';
}

function sessionTone(status: string): 'ok' | 'warn' | 'bad' | 'neutral' | 'brand' {
  if (status === 'COMPLETED') return 'ok';
  if (status === 'LIVE') return 'brand';
  if (status === 'CANCELLED' || status === 'NO_SHOW') return 'bad';
  return 'neutral';
}

/** Worst first: the list exists to find the people about to drop out. */
function concern(l: ClassroomLearner) {
  const attendance = l.attendanceRate ?? 100;
  const score = l.averageScore ?? 100;
  return Math.round(attendance * 0.4 + l.progress * 0.4 + score * 0.2);
}

export function Classroom(props: Props) {
  const [tab, setTab] = useState<Tab>('Learners');

  return (
    <div>
      <div role="tablist" className="mb-5 flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t
                ? 'border-[var(--brand)] text-[var(--ink)]'
                : 'border-transparent text-[var(--ink-2)] hover:text-[var(--ink)]'
            }`}
          >
            {t}
            {t === 'Learners' && props.learners.length > 0 && (
              <span className="t-micro faint ml-1.5 tabular-nums">{props.learners.length}</span>
            )}
            {t === 'Classes' && props.sessions.length > 0 && (
              <span className="t-micro faint ml-1.5 tabular-nums">{props.sessions.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'Learners' && (
        <Learners
          learners={props.learners}
          canEdit={props.canEdit}
          totalLessons={props.totalLessons}
        />
      )}
      {tab === 'Classes' && <Classes sessions={props.sessions} roster={props.roster} />}
      {tab === 'Curriculum' && (
        <Curriculum
          batchId={props.batch.id}
          modules={props.courseModules}
          selected={props.selectedModules}
          canEdit={props.canEdit}
        />
      )}
      {tab === 'Team and settings' && (
        <TeamAndSettings
          batch={props.batch}
          staff={props.staff}
          team={props.team}
          canEdit={props.canEdit}
        />
      )}
    </div>
  );
}

/* Learners ---------------------------------------------------------------- */

type Sort = 'concern' | 'name' | 'joined';

function Learners({
  learners,
  canEdit,
  totalLessons,
}: {
  learners: ClassroomLearner[];
  canEdit: boolean;
  totalLessons: number;
}) {
  const [sort, setSort] = useState<Sort>('concern');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? learners.filter(
          (l) =>
            l.name.toLowerCase().includes(needle) || l.contact.toLowerCase().includes(needle),
        )
      : learners.slice();

    if (sort === 'name') return filtered.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'joined')
      return filtered.sort((a, b) => b.joinedAt.localeCompare(a.joinedAt));
    return filtered.sort((a, b) => concern(a) - concern(b));
  }, [learners, query, sort]);

  if (learners.length === 0) {
    return (
      <EmptyState
        title="Nobody is in this batch yet"
        hint="Enrol learners from the course page or import them, and they will appear here with their attendance and scores."
        action={<Link className="t-small hover:underline" href="/admin/enrol">Enrol someone</Link>}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-xs">
          <Input
            type="search"
            value={query}
            placeholder="Find a learner"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find a learner"
          />
        </div>
        <div className="w-52">
          <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Order">
            <option value="concern">Needs attention first</option>
            <option value="name">By name</option>
            <option value="joined">Newest first</option>
          </Select>
        </div>
      </div>

      <Table
        head={[
          'Learner',
          'Progress',
          'Attendance',
          'Assessments',
          'Status',
          '',
        ]}
      >
        {rows.map((l) => (
          <Row key={l.enrollmentId}>
            <Cell>
              <Link href={`/admin/learners/${l.userId}`} className="font-medium hover:underline">
                {l.name}
              </Link>
              <p className="t-micro faint">{l.contact}</p>
            </Cell>
            <Cell>
              <div className="flex items-center gap-2">
                <ProgressRing value={l.progress} size={32} />
                <span className="t-micro faint">
                  {totalLessons > 0
                    ? `${Math.round((l.progress / 100) * totalLessons)} of ${totalLessons} lessons`
                    : 'no lessons yet'}
                </span>
              </div>
            </Cell>
            <Cell>
              {l.attendanceRate === null ? (
                <span className="t-small faint">no classes yet</span>
              ) : (
                <>
                  <span
                    className="text-sm font-medium tabular-nums"
                    style={{ color: l.attendanceRate < 60 ? 'var(--bad)' : undefined }}
                  >
                    {l.attendanceRate}%
                  </span>
                  <p className="t-micro faint">came to {l.attended}</p>
                </>
              )}
            </Cell>
            <Cell>
              {l.assessmentsTaken === 0 ? (
                <span className="t-small faint">none taken</span>
              ) : (
                <>
                  <span className="text-sm font-medium tabular-nums">{l.averageScore}%</span>
                  <p className="t-micro faint">
                    passed {l.assessmentsPassed} of {l.assessmentsTaken}
                  </p>
                </>
              )}
            </Cell>
            <Cell>
              {canEdit ? (
                <StatusPicker enrollmentId={l.enrollmentId} status={l.status} />
              ) : (
                <Badge tone={statusTone(l.status)}>{l.status.toLowerCase().replace('_', ' ')}</Badge>
              )}
            </Cell>
            <Cell className="text-right">
              <Link
                href={`/admin/learners/${l.userId}`}
                className="t-small faint hover:underline"
              >
                Open
              </Link>
            </Cell>
          </Row>
        ))}
      </Table>
    </div>
  );
}

function StatusPicker({ enrollmentId, status }: { enrollmentId: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(status);
  const [error, setError] = useState<string>();

  return (
    <div className="w-36">
      <Select
        value={value}
        disabled={pending}
        aria-label="Enrolment status"
        onChange={(e) => {
          const next = e.target.value as $Enums.EnrollmentStatus;
          const previous = value;
          setValue(next);
          start(async () => {
            const res = await setEnrollmentStatus(enrollmentId, next);
            if (res.error) {
              setValue(previous);
              setError(res.error);
            } else {
              setError(undefined);
              router.refresh();
            }
          });
        }}
      >
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>
      {error && <p className="t-micro mt-1 text-[var(--bad)]">{error}</p>}
    </div>
  );
}

/* Classes ----------------------------------------------------------------- */

function Classes({ sessions, roster }: { sessions: ClassroomSession[]; roster: number }) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        title="No classes scheduled"
        hint="Schedule a live class and attendance will start counting here."
        action={
          <Link className="t-small hover:underline" href="/admin/sessions">
            Schedule a class
          </Link>
        }
      />
    );
  }

  const now = Date.now();

  return (
    <Table head={['Class', 'When', 'Attendance', 'Status', '']}>
      {sessions.map((s) => {
        const when = new Date(s.startsAt);
        const upcoming = when.getTime() > now;
        const rate = roster > 0 ? Math.round((s.present / roster) * 100) : null;

        return (
          <Row key={s.id}>
            <Cell>
              <Link href={`/admin/sessions/${s.id}`} className="font-medium hover:underline">
                {s.title}
              </Link>
            </Cell>
            <Cell className="whitespace-nowrap">
              <span className="text-sm">
                {when.toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
              <p className="t-micro faint">
                {when.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
              </p>
            </Cell>
            <Cell>
              {upcoming || s.status === 'CANCELLED' ? (
                <span className="t-small faint">—</span>
              ) : (
                <>
                  <span
                    className="text-sm font-medium tabular-nums"
                    style={{ color: rate !== null && rate < 60 ? 'var(--bad)' : undefined }}
                  >
                    {s.present} of {roster}
                    {rate !== null ? ` (${rate}%)` : ''}
                  </span>
                  {s.late > 0 && <p className="t-micro faint">{s.late} joined late</p>}
                </>
              )}
            </Cell>
            <Cell>
              <Badge tone={sessionTone(s.status)}>{s.status.toLowerCase().replace('_', ' ')}</Badge>
            </Cell>
            <Cell className="text-right">
              <Link href={`/admin/attendance?session=${s.id}`} className="t-small faint hover:underline">
                Attendance
              </Link>
            </Cell>
          </Row>
        );
      })}
    </Table>
  );
}

/* Curriculum -------------------------------------------------------------- */

function Curriculum({
  batchId,
  modules,
  selected,
  canEdit,
}: {
  batchId: string;
  modules: { id: string; name: string; lessons: number }[];
  selected: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [chosen, setChosen] = useState<string[]>(selected);
  const [state, setState] = useState<ActionState>({});

  const wholeCourse = chosen.length === 0;

  function save(next: string[]) {
    setChosen(next);
    start(async () => {
      const res = await setBatchModules(batchId, next);
      setState(res);
      if (!res.error) router.refresh();
    });
  }

  if (modules.length === 0) {
    return (
      <EmptyState
        title="This course has no modules yet"
        hint="Build the curriculum on the course, then come back to choose which parts this batch teaches."
      />
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="t-heading">What this batch teaches</h2>
            <p className="t-small muted mt-1 max-w-prose">
              Leave everything unticked and the batch runs the whole course. Tick modules only when
              this batch is a shorter run of it — a four-week intensive out of a five-month
              programme, say.
            </p>
          </div>
          <Badge tone={wholeCourse ? 'brand' : 'warn'}>
            {wholeCourse ? 'whole course' : `${chosen.length} of ${modules.length} modules`}
          </Badge>
        </div>

        <ul className="mt-4 divide-y border-t">
          {modules.map((m) => (
            <li key={m.id} className="py-2.5">
              <Checkbox
                label={m.name}
                hint={`${m.lessons} ${m.lessons === 1 ? 'lesson' : 'lessons'}`}
                checked={chosen.includes(m.id)}
                disabled={!canEdit || pending}
                onChange={(e) =>
                  save(
                    e.target.checked
                      ? [...chosen, m.id]
                      : chosen.filter((id) => id !== m.id),
                  )
                }
              />
            </li>
          ))}
        </ul>

        {canEdit && !wholeCourse && (
          <div className="mt-4">
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => save([])}>
              Teach the whole course
            </Button>
          </div>
        )}

        <div className="mt-3 space-y-2">
          <FormError message={state.error} />
          <FormSuccess message={state.ok ? state.message : undefined} />
        </div>
      </Card>
    </div>
  );
}

/* Team and settings ------------------------------------------------------- */

const initial: ActionState = {};

function TeamAndSettings({
  batch,
  staff,
  team,
  canEdit,
}: {
  batch: Props['batch'];
  staff: { userId: string; role: string }[];
  team: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(updateBatch, initial);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="t-heading">Who runs it</h2>
        <p className="t-small muted mt-1">
          Tutors see the batch in their own dashboard; managers can act on it.
        </p>

        {team.length === 0 ? (
          <p className="t-small faint mt-4">No staff accounts yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  <th className="t-micro faint py-2 text-left font-semibold">Person</th>
                  {ROLES.map((r) => (
                    <th key={r.value} className="t-micro faint px-2 py-2 text-center font-semibold">
                      {r.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {team.map((member) => (
                  <StaffRow
                    key={member.id}
                    batchId={batch.id}
                    member={member}
                    staff={staff}
                    canEdit={canEdit}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="t-heading">Batch settings</h2>
        <form action={action} className="mt-4 space-y-4">
          <input type="hidden" name="id" value={batch.id} />

          <Field label="Name">
            <Input name="name" defaultValue={batch.name} required disabled={!canEdit} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts">
              <Input type="date" name="startDate" defaultValue={batch.startDate} disabled={!canEdit} />
            </Field>
            <Field label="Ends">
              <Input type="date" name="endDate" defaultValue={batch.endDate} disabled={!canEdit} />
            </Field>
          </div>

          <Field label="Seats" hint="Leave at 0 for no cap.">
            <Input
              type="number"
              name="capacity"
              min={0}
              defaultValue={batch.capacity || 0}
              disabled={!canEdit}
            />
          </Field>

          <Checkbox
            name="isDefault"
            label="Default batch for this course"
            hint="New enrolments land here unless they pick another batch."
            defaultChecked={batch.isDefault}
            disabled={!canEdit}
          />

          <FormError message={state.error} />
          <FormSuccess message={state.ok ? state.message : undefined} />

          {canEdit && (
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          )}
        </form>
      </Card>
    </div>
  );
}

function StaffRow({
  batchId,
  member,
  staff,
  canEdit,
}: {
  batchId: string;
  member: { id: string; name: string };
  staff: { userId: string; role: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [roles, setRoles] = useState<string[]>(
    staff.filter((s) => s.userId === member.id).map((s) => s.role),
  );
  const [error, setError] = useState<string>();

  function toggle(role: $Enums.BatchRole, on: boolean) {
    const previous = roles;
    setRoles(on ? [...roles, role] : roles.filter((r) => r !== role));
    start(async () => {
      const res = await setBatchStaff(batchId, member.id, role, on);
      if (res.error) {
        setRoles(previous);
        setError(res.error);
      } else {
        setError(undefined);
        router.refresh();
      }
    });
  }

  return (
    <tr className="border-b last:border-0">
      <td className="py-2">
        {member.name}
        {error && <p className="t-micro text-[var(--bad)]">{error}</p>}
      </td>
      {ROLES.map((r) => (
        <td key={r.value} className="px-2 py-2 text-center">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
            checked={roles.includes(r.value)}
            disabled={!canEdit || pending}
            aria-label={`${member.name} as ${r.label}`}
            onChange={(e) => toggle(r.value, e.target.checked)}
          />
        </td>
      ))}
    </tr>
  );
}

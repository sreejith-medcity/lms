'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';
import type { ActionState } from '@/server/courses';
import {
  addAvailabilityAction,
  cancelSeatAction,
  changeSeatTimeAction,
  changeSlotAction,
  chooseSlotAction,
  decideTutorLeaveAction,
  enrolTutoringAction,
  learnerFeedbackAction,
  learnerLeaveAction,
  placeSeatAction,
  reassignAction,
  removeAvailabilityAction,
  requestTutorLeaveAction,
  saveEmployeeCodeAction,
  saveOfferAction,
  tutorFeedbackAction,
  withdrawTutorLeaveAction,
} from '@/server/tutoring';

/**
 * Every form of online tutoring, for the office, the tutor and the learner.
 * Each is a thin shell over one server action: the rules are on the server.
 */

const initial: ActionState = {};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function useRefreshing(action: Action) {
  const router = useRouter();
  return useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) router.refresh();
    return r;
  }, initial);
}

function DayBoxes({ defaults }: { defaults: number[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {DAYS.map((d, i) => (
        <label key={d} className="t-small flex items-center gap-1.5">
          <input type="checkbox" name="weekdays" value={i} defaultChecked={defaults.includes(i)} className="h-4 w-4 accent-[var(--brand)]" />
          {d}
        </label>
      ))}
    </div>
  );
}

function Notes({ state }: { state: ActionState }) {
  return (
    <>
      <FormError message={state.error} />
      <FormSuccess message={state.message} />
    </>
  );
}

/* ------------------------------------------------------------ the office */

export interface OfferDefaults {
  courseId: string;
  format: string;
  groupSize: number;
  classMinutes: number;
  classesTotal: number;
  weekdays: number[];
  tutors: string[];
  active: boolean;
}

export function OfferForm({ courses, staff, defaults }: { courses: { id: string; title: string }[]; staff: { id: string; name: string }[]; defaults?: OfferDefaults }) {
  const [state, action, pending] = useRefreshing(saveOfferAction);
  const [format, setFormat] = useState(defaults?.format ?? 'ONE_TO_ONE');
  return (
    <form action={action} className="space-y-4">
      <Notes state={state} />
      {defaults ? (
        <input type="hidden" name="courseId" value={defaults.courseId} />
      ) : (
        <Field label="Course">
          <Select name="courseId" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Taught">
          <Select name="format" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="ONE_TO_ONE">One learner, one tutor</option>
            <option value="GROUP">A small group</option>
          </Select>
        </Field>
        {format === 'GROUP' && (
          <Field label="Learners in a group">
            <Input name="groupSize" type="number" min={2} max={30} defaultValue={defaults?.groupSize && defaults.groupSize > 1 ? defaults.groupSize : 4} />
          </Field>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Classes in the course">
          <Input name="classesTotal" type="number" min={1} max={365} defaultValue={defaults?.classesTotal ?? 30} required />
        </Field>
        <Field label="Minutes a class">
          <Input name="classMinutes" type="number" min={15} max={240} step={5} defaultValue={defaults?.classMinutes ?? 60} required />
        </Field>
      </div>
      <Field label="Class days">
        <DayBoxes defaults={defaults?.weekdays ?? [1, 2, 3, 4, 5, 6]} />
      </Field>
      <Field label="Tutors who teach it" hint="A learner is placed only with a tutor ticked here, in the hours that tutor has marked.">
        <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-[var(--radius-sm)] border p-3 sm:grid-cols-2">
          {staff.map((s) => (
            <label key={s.id} className="t-small flex items-center gap-2">
              <input type="checkbox" name="tutors" value={s.id} defaultChecked={defaults?.tutors.includes(s.id)} className="h-4 w-4 accent-[var(--brand)]" />
              {s.name}
            </label>
          ))}
        </div>
      </Field>
      <label className="t-small flex items-center gap-2">
        <input type="checkbox" name="active" value="on" defaultChecked={defaults?.active ?? true} className="h-4 w-4 accent-[var(--brand)]" />
        Open to new learners
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : defaults ? 'Save' : 'Offer this course with an online tutor'}
      </Button>
    </form>
  );
}

export function EnrolTutoringForm({ offers, today }: { offers: { id: string; title: string; tutors: { id: string; name: string }[] }[]; today: string }) {
  const [state, action, pending] = useRefreshing(enrolTutoringAction);
  const [offerId, setOfferId] = useState(offers[0]?.id ?? '');
  const tutors = offers.find((o) => o.id === offerId)?.tutors ?? [];
  if (!offers.length) return <p className="t-small muted">First offer a course with an online tutor, under Courses and tutors.</p>;
  return (
    <form action={action} className="space-y-4">
      <Notes state={state} />
      <Field label="Learner" hint="Their email address or phone number, as on their account.">
        <Input name="learner" required placeholder="asha@example.com" />
      </Field>
      <Field label="Course">
        <Select name="offerId" value={offerId} onChange={(e) => setOfferId(e.target.value)}>
          {offers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class time">
          <Input name="time" type="time" step={900} required />
        </Field>
        <Field label="Starts on">
          <Input name="fromDay" type="date" min={today} defaultValue={today} required />
        </Field>
      </div>
      <Field label="Tutor" hint="Left on automatic, the free tutor with the fewest groups is chosen.">
        <Select name="tutorId" defaultValue="">
          <option value="">Automatic</option>
          {tutors.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Note">
        <Input name="note" maxLength={300} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Placing…' : 'Enrol with an online tutor'}
      </Button>
    </form>
  );
}

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ error?: string; message?: string }>({});
  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      setNote({ error: r.error, message: r.message });
      if (!r.error) router.refresh();
    });
  return { pending, note, run };
}

function RunNote({ note }: { note: { error?: string; message?: string } }) {
  if (note.error) return <span className="t-small text-[var(--bad)]">{note.error}</span>;
  if (note.message) return <span className="t-small muted">{note.message}</span>;
  return null;
}

export function WaitingActions({ seatId, time, tutors }: { seatId: string; time: string; tutors: { id: string; name: string }[] }) {
  const { pending, note, run } = useRun();
  const [value, setValue] = useState(time);
  const [tutorId, setTutorId] = useState('');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Input type="time" step={900} value={value} onChange={(e) => setValue(e.target.value)} className="w-32" aria-label="Class time" />
        <Button size="sm" variant="secondary" disabled={pending || value === time} onClick={() => run(() => changeSeatTimeAction(seatId, value))}>
          Try this time
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Select value={tutorId} onChange={(e) => setTutorId(e.target.value)} className="w-44" aria-label="Tutor">
          <option value="">Any free tutor</option>
          {tutors.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Button size="sm" disabled={pending} onClick={() => run(() => placeSeatAction(seatId, tutorId || undefined))}>
          Place now
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelSeatAction(seatId))}>
          Remove
        </Button>
      </div>
      <div className="text-right">
        <RunNote note={note} />
      </div>
    </div>
  );
}

export function ReassignForm({ groupId, tutors, today }: { groupId: string; tutors: { id: string; name: string }[]; today: string }) {
  const [state, action, pending] = useRefreshing(reassignAction);
  return (
    <form action={action} className="space-y-3">
      <Notes state={state} />
      <input type="hidden" name="groupId" value={groupId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="New tutor">
          <Select name="tutorId" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {tutors.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From">
          <Input name="fromDay" type="date" min={today} defaultValue={today} required />
        </Field>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Handing over…' : 'Hand the group over'}
      </Button>
    </form>
  );
}

export function SlotForm({ groupId, time, today }: { groupId: string; time: string; today: string }) {
  const [state, action, pending] = useRefreshing(changeSlotAction);
  return (
    <form action={action} className="space-y-3">
      <Notes state={state} />
      <input type="hidden" name="groupId" value={groupId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="New time">
          <Input name="time" type="time" step={900} defaultValue={time} required />
        </Field>
        <Field label="Day">
          <Input name="fromDay" type="date" min={today} defaultValue={today} required />
        </Field>
        <Field label="Applies to">
          <Select name="scope" defaultValue="day">
            <option value="day">That day only</option>
            <option value="onwards">That day and every class after</option>
          </Select>
        </Field>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Moving…' : 'Move the class time'}
      </Button>
      <p className="t-small faint">The learners are told the new time at once.</p>
    </form>
  );
}

export function EmployeeCode({ userId, code }: { userId: string; code: string }) {
  const { pending, note, run } = useRun();
  const [value, setValue] = useState(code);
  return (
    <span className="inline-flex items-center gap-2">
      <Input value={value} onChange={(e) => setValue(e.target.value)} className="w-28" placeholder="Code" aria-label="Employee code" maxLength={40} />
      {value !== code && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => saveEmployeeCodeAction(userId, value))}>
          Save
        </Button>
      )}
      <RunNote note={{ error: note.error }} />
    </span>
  );
}

export function LeaveDecision({ leaveId }: { leaveId: string }) {
  const { pending, note, run } = useRun();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button size="sm" disabled={pending} onClick={() => run(() => decideTutorLeaveAction(leaveId, true))}>
        {pending ? 'Working…' : 'Approve'}
      </Button>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => decideTutorLeaveAction(leaveId, false))}>
        Refuse
      </Button>
      <RunNote note={note} />
    </div>
  );
}

/* ------------------------------------------------------------ the tutor */

export function AvailabilityForm({ userId }: { userId?: string }) {
  const [state, action, pending] = useRefreshing(addAvailabilityAction);
  return (
    <form action={action} className="space-y-3">
      <Notes state={state} />
      {userId && <input type="hidden" name="userId" value={userId} />}
      <Field label="Days">
        <DayBoxes defaults={[1, 2, 3, 4, 5, 6]} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From">
          <Input name="from" type="time" step={900} required />
        </Field>
        <Field label="To">
          <Input name="to" type="time" step={900} required />
        </Field>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Add these hours'}
      </Button>
    </form>
  );
}

export function RemoveAvailability({ id }: { id: string }) {
  const { pending, run } = useRun();
  return (
    <button type="button" disabled={pending} onClick={() => run(() => removeAvailabilityAction(id))} className="t-small underline disabled:opacity-50" aria-label="Remove these hours">
      remove
    </button>
  );
}

export function TutorLeaveForm({ today, userId }: { today: string; userId?: string }) {
  const [state, action, pending] = useRefreshing(requestTutorLeaveAction);
  return (
    <form action={action} className="space-y-3">
      <Notes state={state} />
      {userId && <input type="hidden" name="userId" value={userId} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First day">
          <Input name="fromDay" type="date" min={today} required />
        </Field>
        <Field label="Last day" hint="Empty for one day.">
          <Input name="toDay" type="date" min={today} />
        </Field>
      </div>
      <Field label="Reason">
        <Input name="reason" maxLength={500} />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Sending…' : userId ? 'Enter the leave' : 'Ask for leave'}
      </Button>
      <p className="t-small faint">
        Up to 7 days: the classes on those days are called off and added to the end of each course. More than 7 days: the groups go to another tutor.
      </p>
    </form>
  );
}

export function WithdrawLeave({ leaveId }: { leaveId: string }) {
  const { pending, note, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => withdrawTutorLeaveAction(leaveId))}>
        Withdraw
      </Button>
      <RunNote note={{ error: note.error }} />
    </span>
  );
}

function Stars({ name, label, required }: { name: string; label: string; required?: boolean }) {
  return (
    <label className="t-small flex items-center justify-between gap-3">
      <span>{label}</span>
      <Select name={name} required={required} defaultValue="" className="w-28">
        <option value="" disabled>
          Choose
        </option>
        <option value="5">5, excellent</option>
        <option value="4">4, good</option>
        <option value="3">3, fair</option>
        <option value="2">2, poor</option>
        <option value="1">1, bad</option>
      </Select>
    </label>
  );
}

export function TutorNoteForm({ feedbackId }: { feedbackId: string }) {
  const [state, action, pending] = useRefreshing(tutorFeedbackAction);
  return (
    <form action={action} className="space-y-3">
      <Notes state={state} />
      <input type="hidden" name="feedbackId" value={feedbackId} />
      <Stars name="rating" label="Progress overall" required />
      <Stars name="attendance" label="Attendance and punctuality" />
      <Stars name="participation" label="Takes part in class" />
      <Stars name="homework" label="Homework and practice" />
      <Field label="How they are doing, and what to work on">
        <Textarea name="comment" rows={3} required maxLength={2000} />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Sending…' : 'Send the progress note'}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------ the learner */

export function ChooseSlotForm({ offerId, times, today, days }: { offerId: string; times: { value: string; label: string }[]; today: string; days: string }) {
  const [state, action, pending] = useRefreshing(chooseSlotAction);
  if (!times.length) return <p className="t-small muted">No class times are open just now. The office has been shown that you are waiting; please check back, or contact them.</p>;
  return (
    <form action={action} className="space-y-3">
      <Notes state={state} />
      <input type="hidden" name="offerId" value={offerId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Class time" hint={`The same time on every class day (${days}).`}>
          <Select name="time" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {times.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start from">
          <Input name="fromDay" type="date" min={today} defaultValue={today} required />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Finding your tutor…' : 'Confirm my class time'}
      </Button>
    </form>
  );
}

export function LearnerLeaveForm({ seatId, today, group }: { seatId: string; today: string; group: boolean }) {
  const [state, action, pending] = useRefreshing(learnerLeaveAction);
  return (
    <form action={action} className="space-y-3">
      <Notes state={state} />
      <input type="hidden" name="seatId" value={seatId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First day">
          <Input name="fromDay" type="date" min={today} required />
        </Field>
        <Field label="Last day" hint="Empty for one day. Up to 3 days.">
          <Input name="toDay" type="date" min={today} />
        </Field>
      </div>
      <Field label="Reason">
        <Input name="reason" maxLength={500} />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Sending…' : 'Take leave'}
      </Button>
      <p className="t-small faint">
        {group ? 'Your tutor is told. The group class goes on, and you are marked excused.' : 'Your tutor is told. The classes on those days move to the end of your course, so you lose none.'}
      </p>
    </form>
  );
}

export function LearnerFeedbackForm({ feedbackId }: { feedbackId: string }) {
  const [state, action, pending] = useRefreshing(learnerFeedbackAction);
  return (
    <form action={action} className="space-y-3">
      <Notes state={state} />
      <input type="hidden" name="feedbackId" value={feedbackId} />
      <Stars name="rating" label="Your classes overall" required />
      <Stars name="clear" label="The tutor explains clearly" />
      <Stars name="punctual" label="Classes start on time" />
      <Stars name="pace" label="The pace suits you" />
      <Field label="Anything you want the office to know">
        <Textarea name="comment" rows={3} maxLength={2000} />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Sending…' : 'Send feedback'}
      </Button>
    </form>
  );
}

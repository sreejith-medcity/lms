import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audienceLine, foldAudience, meetingLine, noticeActions, parentNoticeRow, parseNotice } from '../src/lib/notices';

test('a notice needs a title, a message and somebody to go to', () => {
  assert.equal(parseNotice({ title: 'Hi', body: 'x' }).ok, false);
  const none = parseNotice({ title: 'Holiday on Monday', body: 'The academy is closed for Onam.' });
  assert.ok(!none.ok && /who this goes to/.test(none.error));
  const nobody = parseNotice({ title: 'Holiday on Monday', body: 'Closed.', everyone: 'on', toParents: 'off' });
  assert.ok(!nobody.ok && /parents, to learners/.test(nobody.error));
  const ok = parseNotice({ title: 'Holiday on Monday', body: 'Closed.', branchIds: ['b1', 'b1', 'b2'], learnerIds: 'l1, l2\nl2' });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.value.branchIds, ['b1', 'b2']);
    assert.deepEqual(ok.value.learnerIds, ['l1', 'l2']);
    assert.equal(ok.value.toParents, true);
    assert.equal(ok.value.toLearners, false);
    assert.equal(ok.value.meetingAt, null);
  }
});

test('a meeting needs a time and a place, and cannot end before it starts', () => {
  const base = { kind: 'MEETING', title: 'Parent-teacher meeting', body: 'Please come.', batchIds: ['b1'] };
  assert.match((parseNotice(base) as { error: string }).error, /date and time/);
  assert.match((parseNotice({ ...base, meetingAt: '2026-10-03T04:30:00.000Z' }) as { error: string }).error, /where the meeting is/);
  assert.match((parseNotice({ ...base, meetingAt: '2026-10-03T04:30:00.000Z', venue: 'Kochi', meetingEndsAt: '2026-10-03T04:00:00.000Z' }) as { error: string }).error, /ends before/);
  assert.match((parseNotice({ ...base, meetingAt: '2026-10-03T04:30:00.000Z', link: 'zoom.us/j/1' }) as { error: string }).error, /http/);
  const ok = parseNotice({ ...base, meetingAt: '2026-10-03T04:30:00.000Z', meetingEndsAt: '2026-10-03T05:30:00.000Z', venue: 'Kochi branch', instructions: 'Ask for Anu.' });
  assert.ok(ok.ok && ok.value.meetingAt?.toISOString() === '2026-10-03T04:30:00.000Z' && ok.value.venue === 'Kochi branch');
  // Meeting fields are dropped on a non-meeting notice.
  const general = parseNotice({ ...base, kind: 'GENERAL', meetingAt: '2026-10-03T04:30:00.000Z', venue: 'x' });
  assert.ok(general.ok && general.value.meetingAt === null && general.value.venue === null);
});

test('a learner reached twice counts once, and a parent of two children is one parent with both named', () => {
  const a = foldAudience([
    { id: 'l1', name: 'Anu', branchId: 'b1', parents: [{ contact: '9000000001', name: 'Mother' }] },
    { id: 'l1', name: 'Anu', branchId: 'b1', parents: [{ contact: '9000000001', name: 'Mother' }] },
    { id: 'l2', name: 'Ben', branchId: 'b1', parents: [{ contact: '9000000001', name: 'Mother' }, { contact: 'dad@x.in', name: 'Father' }] },
    { id: 'l3', name: 'Cyril', branchId: 'b2', parents: [] },
  ]);
  assert.equal(a.learners.length, 3);
  assert.equal(a.parents.length, 2);
  const mother = a.parents.find((p) => p.contact === '9000000001')!;
  assert.deepEqual(mother.children.map((c) => c.name), ['Anu', 'Ben']);
  assert.equal(audienceLine(a, { toParents: true, toLearners: false }), '2 parents of 3 learners, e.g. Anu, Ben, Cyril.');
  assert.equal(audienceLine(a, { toParents: true, toLearners: true }), '2 parents and 3 learners, e.g. Anu, Ben, Cyril.');
  assert.equal(audienceLine({ learners: [], parents: [] }, { toParents: true, toLearners: false }), '0 parents of 0 learners.');
});

test('the inbox row is one per parent, names every child, and says when it is a correction', () => {
  const row = parentNoticeRow({ id: 'n1', kind: 'MEETING', title: 'PTM on Saturday', version: 1, supersedesId: null }, [{ id: 'l1', name: 'Anu' }, { id: 'l2', name: 'Ben' }]);
  assert.equal(row.title, 'PTM on Saturday');
  assert.equal(row.body, 'Meeting for Anu, Ben. Open to read it.');
  assert.equal(row.href, '/parent/notices/n1');
  const fix = parentNoticeRow({ id: 'n2', kind: 'MEETING', title: 'PTM on Sunday', version: 2, supersedesId: 'n1' }, [{ id: 'l1', name: 'Anu' }]);
  assert.equal(fix.title, 'Correction: PTM on Sunday');
  assert.equal(fix.body, 'Meeting for Anu. Open to read it.');
});

test('a meeting line reads as one sentence, and a notice takes only the actions its state allows', () => {
  const fmt = (d: Date) => d.toISOString().slice(0, 16);
  const time = (d: Date) => d.toISOString().slice(11, 16);
  assert.equal(meetingLine({ meetingAt: new Date('2026-10-03T04:30:00Z'), meetingEndsAt: new Date('2026-10-03T05:30:00Z'), venue: 'Kochi', link: null }, fmt, time), '2026-10-03T04:30 to 05:30 · Kochi');
  assert.equal(meetingLine({ meetingAt: new Date('2026-10-03T04:30:00Z'), meetingEndsAt: null, venue: null, link: 'https://x' }, fmt, time), '2026-10-03T04:30 · online');
  assert.equal(meetingLine({ meetingAt: null, meetingEndsAt: null, venue: null, link: null }, fmt, time), null);
  assert.deepEqual(noticeActions('DRAFT', false), { edit: true, publish: true, withdraw: false, correct: false, discard: true });
  assert.deepEqual(noticeActions('PUBLISHED', false), { edit: false, publish: false, withdraw: true, correct: true, discard: false });
  assert.deepEqual(noticeActions('PUBLISHED', true), { edit: false, publish: false, withdraw: false, correct: false, discard: false });
  assert.deepEqual(noticeActions('WITHDRAWN', false), { edit: false, publish: false, withdraw: false, correct: false, discard: false });
});

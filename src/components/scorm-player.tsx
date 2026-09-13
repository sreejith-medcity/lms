'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { commitScorm } from '@/server/scorm';
import type { Cmi } from '@/lib/scorm/data-model';

/**
 * The frame the package runs in, and the API it looks for on the parent
 * window: `API` for SCORM 1.2, `API_1484_11` for 2004. Every value the
 * package sets is kept here and handed to the server on commit, on finish,
 * and when the tab closes. An xAPI package gets its launch parameters in
 * the URL instead and talks to the LRS routes itself.
 */

export interface ScormLaunch {
  packageId: string;
  standard: 'SCORM_1_2' | 'SCORM_2004' | 'XAPI';
  contentUrl: string;
  initialCmi: Cmi;
  lessonStatus: string;
  /** xAPI only. */
  xapi?: { endpoint: string; auth: string; actor: string; activityId: string; registration: string };
}

type Api12 = {
  LMSInitialize: (s: string) => string;
  LMSFinish: (s: string) => string;
  LMSGetValue: (k: string) => string;
  LMSSetValue: (k: string, v: string) => string;
  LMSCommit: (s: string) => string;
  LMSGetLastError: () => string;
  LMSGetErrorString: (c: string) => string;
  LMSGetDiagnostic: (c: string) => string;
};
type Api2004 = {
  Initialize: (s: string) => string;
  Terminate: (s: string) => string;
  GetValue: (k: string) => string;
  SetValue: (k: string, v: string) => string;
  Commit: (s: string) => string;
  GetLastError: () => string;
  GetErrorString: (c: string) => string;
  GetDiagnostic: (c: string) => string;
};

declare global {
  interface Window {
    API?: Api12;
    API_1484_11?: Api2004;
  }
}

const READ_ONLY_12 = new Set(['cmi.core.student_id', 'cmi.core.student_name', 'cmi.core.credit', 'cmi.core.entry', 'cmi.core.total_time', 'cmi.core.lesson_mode', 'cmi.launch_data', 'cmi.student_data.mastery_score']);
const READ_ONLY_2004 = new Set(['cmi.learner_id', 'cmi.learner_name', 'cmi.credit', 'cmi.entry', 'cmi.total_time', 'cmi.mode', 'cmi.launch_data', 'cmi.scaled_passing_score']);

export function ScormPlayer({ launch, title }: { launch: ScormLaunch; title: string }) {
  const router = useRouter();
  const cmi = useRef<Cmi>({ ...launch.initialCmi });
  const dirty = useRef(false);
  const started = useRef<number>(Date.now());
  const [status, setStatus] = useState(launch.lessonStatus);
  const [note, setNote] = useState<string | null>(null);
  const [ready, setReady] = useState(launch.standard === 'XAPI');

  const src = useMemo(() => {
    if (launch.standard !== 'XAPI' || !launch.xapi) return launch.contentUrl;
    const q = new URLSearchParams({ endpoint: launch.xapi.endpoint, auth: launch.xapi.auth, actor: launch.xapi.actor, activity_id: launch.xapi.activityId, registration: launch.xapi.registration });
    return `${launch.contentUrl}${launch.contentUrl.includes('?') ? '&' : '?'}${q.toString()}`;
  }, [launch]);

  useEffect(() => {
    if (launch.standard === 'XAPI') return;
    const is12 = launch.standard === 'SCORM_1_2';
    let lastError = '0';
    let initialised = false;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const sessionSeconds = () => Math.round((Date.now() - started.current) / 1000);
    const push = async (finish: boolean) => {
      if (!dirty.current && !finish) return;
      dirty.current = false;
      const r = await commitScorm(launch.packageId, { ...cmi.current }, sessionSeconds());
      if (r.ok && r.lessonStatus) {
        setStatus(r.lessonStatus);
        if (r.done) router.refresh();
      } else if (!r.ok) setNote(r.error ?? 'Progress could not be saved.');
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void push(false), 1500);
    };
    const get = (key: string): string => {
      if (!initialised) {
        lastError = is12 ? '301' : '122';
        return '';
      }
      if (key.endsWith('._children')) {
        lastError = '0';
        return childrenOf(key);
      }
      if (key.endsWith('._count')) {
        lastError = '0';
        return String(countOf(cmi.current, key.slice(0, -'._count'.length)));
      }
      if (key in cmi.current) {
        lastError = '0';
        return cmi.current[key];
      }
      lastError = is12 ? '201' : '401';
      return '';
    };
    const set = (key: string, value: string): string => {
      if (!initialised) {
        lastError = is12 ? '301' : '132';
        return 'false';
      }
      if ((is12 ? READ_ONLY_12 : READ_ONLY_2004).has(key)) {
        lastError = is12 ? '403' : '404';
        return 'false';
      }
      cmi.current[key] = String(value);
      dirty.current = true;
      lastError = '0';
      if (key === 'cmi.core.lesson_status' || key === 'cmi.completion_status' || key === 'cmi.success_status' || key === 'cmi.core.score.raw' || key === 'cmi.score.raw') schedule();
      return 'true';
    };
    const commit = (): string => {
      if (!initialised) {
        lastError = is12 ? '301' : '142';
        return 'false';
      }
      lastError = '0';
      void push(false);
      return 'true';
    };
    const init = (): string => {
      if (initialised) {
        lastError = is12 ? '101' : '103';
        return 'false';
      }
      initialised = true;
      finished = false;
      started.current = Date.now();
      lastError = '0';
      return 'true';
    };
    const finish = (): string => {
      if (!initialised || finished) {
        lastError = is12 ? '301' : '112';
        return 'false';
      }
      finished = true;
      initialised = false;
      // SCORM 1.2 lets a package leave "incomplete" unset and exit; treat an exit with data as at least incomplete.
      if (is12 && (!cmi.current['cmi.core.lesson_status'] || cmi.current['cmi.core.lesson_status'] === 'not attempted')) cmi.current['cmi.core.lesson_status'] = 'incomplete';
      if (!is12 && cmi.current['cmi.completion_status'] === 'not attempted') cmi.current['cmi.completion_status'] = 'incomplete';
      dirty.current = true;
      void push(true);
      lastError = '0';
      return 'true';
    };
    const errorString = (code: string) => ERRORS[code] ?? '';

    if (is12) {
      window.API = { LMSInitialize: init, LMSFinish: finish, LMSGetValue: get, LMSSetValue: set, LMSCommit: commit, LMSGetLastError: () => lastError, LMSGetErrorString: errorString, LMSGetDiagnostic: errorString };
    } else {
      window.API_1484_11 = { Initialize: init, Terminate: finish, GetValue: get, SetValue: set, Commit: commit, GetLastError: () => lastError, GetErrorString: errorString, GetDiagnostic: errorString };
    }
    setReady(true);

    const onLeave = () => {
      if (dirty.current || initialised) void push(true);
    };
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('beforeunload', onLeave);
      if (timer) clearTimeout(timer);
      if (dirty.current) void push(true);
      delete window.API;
      delete window.API_1484_11;
    };
  }, [launch.packageId, launch.standard, router]);

  const label = status === 'passed' ? 'Passed' : status === 'completed' ? 'Completed' : status === 'failed' ? 'Not passed yet' : status === 'incomplete' ? 'In progress' : 'Not started';

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <span className="t-small muted">{launch.standard === 'XAPI' ? 'xAPI package' : launch.standard === 'SCORM_1_2' ? 'SCORM 1.2 package' : 'SCORM 2004 package'} · {label}</span>
        <span className="flex items-center gap-3">
          {note && <span className="t-micro text-[var(--bad)]">{note}</span>}
          <a href={src} target="_blank" rel="noreferrer noopener" className="t-small underline">Open full screen</a>
        </span>
      </div>
      {ready && (
        <iframe
          src={src}
          title={title}
          className="h-[75vh] w-full bg-white"
          allow="autoplay; fullscreen; microphone; camera"
          allowFullScreen
        />
      )}
    </div>
  );
}

const ERRORS: Record<string, string> = {
  '0': 'No error',
  '101': 'General exception',
  '103': 'Already initialized',
  '112': 'Termination before initialization',
  '122': 'Retrieve data before initialization',
  '132': 'Store data before initialization',
  '142': 'Commit before initialization',
  '201': 'Invalid argument error',
  '301': 'Not initialized',
  '401': 'Undefined data model element',
  '403': 'Element is read only',
  '404': 'Data model element is read only',
};

function childrenOf(key: string): string {
  const base = key.slice(0, -'._children'.length);
  if (base === 'cmi.core') return 'student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time';
  if (base === 'cmi.core.score' || base === 'cmi.score') return 'raw,min,max,scaled';
  if (base === 'cmi.student_data') return 'mastery_score,max_time_allowed,time_limit_action';
  if (base === 'cmi.interactions') return 'id,objectives,time,type,correct_responses,weighting,student_response,result,latency';
  if (base === 'cmi.objectives') return 'id,score,status';
  if (base === 'cmi') return 'completion_status,success_status,score,location,suspend_data,session_time,total_time,learner_id,learner_name,entry,exit,mode,credit,interactions,objectives';
  return '';
}

function countOf(cmi: Cmi, base: string): number {
  const ids = new Set<string>();
  for (const k of Object.keys(cmi)) {
    if (!k.startsWith(`${base}.`)) continue;
    const idx = k.slice(base.length + 1).split('.')[0];
    if (/^\d+$/.test(idx)) ids.add(idx);
  }
  return ids.size;
}

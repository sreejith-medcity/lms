import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readZip } from '../src/lib/scorm/zip';
import { findManifest, parseImsManifest, parseTincan, safeRelativePath } from '../src/lib/scorm/manifest';
import { initialCmi, parseDuration, summarise } from '../src/lib/scorm/data-model';

const MANIFEST_12 = `<?xml version="1.0"?>
<manifest identifier="com.example.a1" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org1"><organization identifier="org1"><title>German A1 &amp; A2</title>
    <item identifier="i1" identifierref="r1"><title>Unit 1</title><adlcp:masteryscore xmlns:adlcp="x">80</adlcp:masteryscore></item>
  </organization></organizations>
  <resources><resource identifier="r1" type="webcontent" adlcp:scormtype="sco" href="content/index.html?v=2"><file href="content/index.html"/></resource></resources>
</manifest>`;

const MANIFEST_2004 = `<manifest identifier="m2"><metadata><schemaversion>2004 4th Edition</schemaversion></metadata>
<organizations><organization><title>Safety</title><item identifier="a" identifierref="res"><title>Module</title></item></organization></organizations>
<resources xml:base="pkg/"><resource identifier="res" href="story.html"/></resources></manifest>`;

test('a zip made by the system unzips back, stored and deflated alike', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scorm-'));
  mkdirSync(join(dir, 'content'));
  writeFileSync(join(dir, 'imsmanifest.xml'), MANIFEST_12);
  writeFileSync(join(dir, 'content', 'index.html'), '<html>hello</html>'.repeat(50));
  execFileSync('zip', ['-q', '-r', 'pkg.zip', 'imsmanifest.xml', 'content'], { cwd: dir });
  const entries = readZip(new Uint8Array(readFileSync(join(dir, 'pkg.zip'))));
  const names = entries.map((e) => e.name);
  assert.ok(names.includes('imsmanifest.xml'));
  assert.ok(names.includes('content/index.html'));
  const html = new TextDecoder().decode(entries.find((e) => e.name === 'content/index.html')!.read());
  assert.equal(html.length, '<html>hello</html>'.length * 50);
  assert.deepEqual(findManifest(names), { path: 'imsmanifest.xml', root: '', kind: 'scorm' });
  assert.deepEqual(findManifest(['Course/tincan.xml', 'Course/index.html']), { path: 'Course/tincan.xml', root: 'Course/', kind: 'xapi' });
});

test('a 1.2 manifest yields the launch file, title and mastery score', () => {
  const info = parseImsManifest(MANIFEST_12);
  assert.equal(info.standard, 'SCORM_1_2');
  assert.equal(info.title, 'German A1 & A2');
  assert.equal(info.launchPath, 'content/index.html');
  assert.equal(info.masteryScore, 80);
  assert.equal(info.identifier, 'com.example.a1');
});

test('a 2004 manifest honours xml:base', () => {
  const info = parseImsManifest(MANIFEST_2004);
  assert.equal(info.standard, 'SCORM_2004');
  assert.equal(info.launchPath, 'pkg/story.html');
  assert.equal(parseTincan('<tincan><activities><activity id="http://x/a" type="course"><name>Tin</name><launch lang="en">index.html</launch></activity></activities></tincan>').launchPath, 'index.html');
  assert.equal(safeRelativePath('../../etc/passwd'), null);
  assert.equal(safeRelativePath('a/./b/../c.html'), 'a/c.html');
});

test('the data model is summarised the same from either version', () => {
  const s12 = summarise('SCORM_1_2', { 'cmi.core.lesson_status': 'completed', 'cmi.core.score.raw': '85', 'cmi.core.score.max': '100', 'cmi.core.session_time': '00:12:30', 'cmi.suspend_data': 'abc' }, 80, 600);
  assert.equal(s12.lessonStatus, 'passed');
  assert.equal(s12.done, true);
  assert.equal(s12.totalSeconds, 1350);
  const fail12 = summarise('SCORM_1_2', { 'cmi.core.lesson_status': 'completed', 'cmi.core.score.raw': '50', 'cmi.core.score.max': '100' }, 80);
  assert.equal(fail12.lessonStatus, 'failed');
  const s2004 = summarise('SCORM_2004', { 'cmi.completion_status': 'completed', 'cmi.success_status': 'unknown', 'cmi.score.scaled': '0.9', 'cmi.session_time': 'PT1H2M3S' }, null);
  assert.equal(s2004.lessonStatus, 'completed');
  assert.equal(s2004.scoreRaw, 90);
  assert.equal(s2004.totalSeconds, 3723);
  assert.equal(parseDuration('0001:02:03.50'), 3723);
});

test('the launch values say whether this is a first go or a resume', () => {
  const fresh = initialCmi('SCORM_1_2', { learnerId: 'u1', learnerName: 'Anu', saved: null, lessonStatus: 'not attempted', suspendData: null, location: null, totalSeconds: 0, masteryScore: 80, scoreRaw: null });
  assert.equal(fresh['cmi.core.entry'], 'ab-initio');
  assert.equal(fresh['cmi.student_data.mastery_score'], '80');
  const back = initialCmi('SCORM_2004', { learnerId: 'u1', learnerName: 'Anu', saved: null, lessonStatus: 'incomplete', suspendData: 'x', location: 'p3', totalSeconds: 90, masteryScore: null, scoreRaw: null });
  assert.equal(back['cmi.entry'], 'resume');
  assert.equal(back['cmi.total_time'], 'PT0H1M30S');
  assert.equal(back['cmi.location'], 'p3');
});

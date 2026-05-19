#!/usr/bin/env node
// tests/scheduler.test.js
// Run with: node tests/scheduler.test.js
'use strict';

const fs   = require('fs');
const path = require('path');
const assert = require('assert');

// ── Extract runScheduler from app.html ────────────────────────────────────────
// The function is self-contained (all helpers defined inside it) so we can
// yank it out by brace-depth counting and eval it in isolation.
const appPath = path.join(__dirname, '..', 'app.html');
const html = fs.readFileSync(appPath, 'utf8');

function extractFn(src, name) {
  const marker = 'function ' + name + '(';
  const start = src.indexOf(marker);
  if (start === -1) throw new Error('Function not found: ' + name);
  let depth = 0, i = start, begun = false;
  while (i < src.length) {
    if (src[i] === '{') { depth++; begun = true; }
    else if (src[i] === '}') { if (begun && --depth === 0) return src.slice(start, i + 1); }
    i++;
  }
  throw new Error('Unbalanced braces in: ' + name);
}

// eslint-disable-next-line no-new-func
const runScheduler = new Function('return (' + extractFn(html, 'runScheduler') + ')')();

// ── Minimal test runner ───────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try   { fn(); console.log('  \x1b[32m✓\x1b[0m ' + name); passed++; }
  catch (e) { console.error('  \x1b[31m✗\x1b[0m ' + name + '\n      ' + e.message); failed++; }
}

// ── Factory helpers ───────────────────────────────────────────────────────────
let _id = 0;
const uid = () => 'id_' + (++_id);

const period  = (n) => ({ id: 'p' + n, label: 'Period ' + n, startTime: '', endTime: '' });
const PERIODS = [1,2,3,4,5,6].map(period);

const cls = (overrides) => Object.assign(
  { id: uid(), name: 'Class', grades: ['6','7','8'], periods: '', category: '' }, overrides);

const elec = (overrides) => Object.assign(
  { id: uid(), name: 'Elective', isYearLong: true, availablePeriods: '' }, overrides);

const student = (overrides) => Object.assign(
  { student_id: uid(), student_name: 'Test Student', grade: '7', designation: '' }, overrides);

// Four standard 7th-grade classes used across most tests
const STD = [
  cls({ id: 'math7', name: 'Math 7',          grades: ['7'], category: 'Math' }),
  cls({ id: 'ela7',  name: 'ELA 7',           grades: ['7'], category: 'ELA' }),
  cls({ id: 'sci7',  name: 'Science 7',       grades: ['7'], category: 'Science' }),
  cls({ id: 'ss7',   name: 'Social Studies 7',grades: ['7'], category: 'Social Studies' }),
];

const ART  = elec({ id: 'art',  name: 'Art',  isYearLong: true });
const BAND = elec({ id: 'band', name: 'Band', isYearLong: true });
const PE   = elec({ id: 'pe',   name: 'PE',   isYearLong: true });

const run = (students, electives, classes, extra) =>
  runScheduler(Object.assign(
    { periods: PERIODS, classes: classes || STD, electives, students, peaksPairs: [], teachers: [] },
    extra
  ));

// helpers to read an assignment
const stdSlots  = a => Object.values(a.schedule).filter(v => v && !v.startsWith('[E] '));
const elecSlots = a => Object.values(a.schedule).filter(v => v && v.startsWith('[E] '));
const elecNames = a => elecSlots(a).flatMap(v => v.replace('[E] ','').split(' | ').map(s => s.trim()));

// ── Basic assignment ──────────────────────────────────────────────────────────
console.log('\nBasic assignment');

test('assigns all 4 standard classes to a 7th grader', () => {
  const s = student({ choice_1: 'Art', choice_2: 'Band' });
  const { assignments } = run([s], [ART, BAND]);
  assert.strictEqual(stdSlots(assignments[0]).length, 4);
});

test('assigns exactly 2 elective slots', () => {
  const s = student({ choice_1: 'Art', choice_2: 'Band' });
  const { assignments } = run([s], [ART, BAND]);
  assert.strictEqual(elecSlots(assignments[0]).length, 2);
});

test('no conflicts when both choices are available', () => {
  const s = student({ choice_1: 'Art', choice_2: 'Band' });
  const { conflicts } = run([s], [ART, BAND]);
  assert.strictEqual(conflicts.length, 0);
});

test('produces a conflict when no choices are provided', () => {
  const s = student({});
  const { conflicts } = run([s], [ART, BAND]);
  assert.strictEqual(conflicts.length, 1);
});

// ── Elective choice ordering ──────────────────────────────────────────────────
console.log('\nElective choice ordering');

test('choice_1 is always assigned (not skipped for under-min)', () => {
  // Band has a high minSize to trigger under-min, but Art is choice_1
  const bandUnderMin = elec({ id: 'band', name: 'Band', isYearLong: true, minSize: '999' });
  const s = student({ choice_1: 'Art', choice_2: 'Band' });
  const { assignments } = run([s], [ART, bandUnderMin, PE]);
  assert.ok(elecNames(assignments[0]).includes('Art'), 'choice_1 Art should be assigned');
});

test('students do not receive an elective they never listed', () => {
  const s = student({ choice_1: 'Art', choice_2: 'Band' });
  const { assignments } = run([s], [ART, BAND, PE]);
  assert.ok(!elecNames(assignments[0]).includes('PE'), 'PE was not listed as a choice');
});

test('choice_1 beats choice_2 when only one slot remains', () => {
  // Give student only one elective slot by stuffing 5 standard classes
  // (use a period-pinned 5th class so it forces the scheduler to fill it)
  const extra = cls({ id: 'extra7', name: 'Extra 7', grades: ['7'], category: 'Extra', periods: 'p5' });
  const s = student({ choice_1: 'Art', choice_2: 'Band', choice_3: 'PE' });
  const result = run([s], [ART, BAND, PE], [...STD, extra]);
  const a = result.assignments[0];
  // If Art is assigned at all it should be choice_1, not Band or PE
  if (elecNames(a).includes('Art') || elecNames(a).includes('Band')) {
    const names = elecNames(a);
    const artIdx  = names.includes('Art')  ? 0 : Infinity;
    const bandIdx = names.includes('Band') ? 1 : Infinity;
    assert.ok(artIdx <= bandIdx, 'Art (choice_1) should rank ahead of Band (choice_2)');
  }
});

// ── Requires tag (eligibility gate) ──────────────────────────────────────────
console.log('\nRequires tag — eligibility gate');

test('ineligible student cannot be assigned a gated elective', () => {
  const band2 = elec({ name: 'Band 2', isYearLong: true, requiresTag: 'Band 2 Eligible' });
  const s = student({ designation: '', choice_1: 'Band 2', choice_2: 'Art' });
  const { assignments } = run([s], [band2, ART, BAND]);
  assert.ok(!elecNames(assignments[0]).includes('Band 2'), 'ineligible student should not get Band 2');
});

test('eligible student gets the gated elective they chose', () => {
  const band2 = elec({ name: 'Band 2', isYearLong: true, requiresTag: 'Band 2 Eligible' });
  const s = student({ designation: 'Band 2 Eligible', choice_1: 'Band 2', choice_2: 'Art' });
  const { assignments } = run([s], [band2, ART]);
  assert.ok(elecNames(assignments[0]).includes('Band 2'), 'eligible student should get Band 2');
});

test('multi-designation student gets gated elective matching one of their tags', () => {
  const band2 = elec({ name: 'Band 2', isYearLong: true, requiresTag: 'Band 2 Eligible' });
  const s = student({ designation: 'ESE|Band 2 Eligible', choice_1: 'Band 2', choice_2: 'Art' });
  const { assignments } = run([s], [band2, ART]);
  assert.ok(elecNames(assignments[0]).includes('Band 2'));
});

test('gated standard class not assigned to ineligible student', () => {
  const honorsMath = cls({ name: 'Honors Math', grades: ['7'], category: 'Math', requiresTag: 'Math Honors Eligible' });
  const s = student({ designation: '' });
  const classes = [honorsMath, ...STD.filter(c => c.category !== 'Math')];
  const { assignments } = run([s], [ART, BAND], classes);
  const names = stdSlots(assignments[0]).map(v => v);
  assert.ok(!names.includes('Honors Math'), 'ineligible student should not get Honors Math');
});

// ── Designation tag (forced assignment) ──────────────────────────────────────
console.log('\nDesignation tag — forced assignment');

test('student with designationTag gets that elective even without listing it', () => {
  const honors = elec({ name: 'Honors Elec', isYearLong: true, designationTag: 'Honors Track' });
  const s = student({ designation: 'Honors Track', choice_1: 'Art', choice_2: 'Band' });
  const { assignments } = run([s], [honors, ART, BAND]);
  assert.ok(elecNames(assignments[0]).includes('Honors Elec'));
});

// ── Grade restriction ─────────────────────────────────────────────────────────
console.log('\nGrade restriction');

test('grade-restricted elective not assigned to wrong grade', () => {
  const art6 = elec({ name: 'Art 6th', isYearLong: true, gradeRestriction: '6' });
  const s = student({ grade: '7', choice_1: 'Art 6th', choice_2: 'Band' });
  const { assignments } = run([s], [art6, BAND, PE]);
  assert.ok(!elecNames(assignments[0]).includes('Art 6th'));
});

test('grade-restricted elective IS assigned to correct grade', () => {
  const art6 = elec({ name: 'Art 6th', isYearLong: true, gradeRestriction: '6' });
  const std6 = [
    cls({ name: 'Math 6',          grades: ['6'], category: 'Math' }),
    cls({ name: 'ELA 6',           grades: ['6'], category: 'ELA' }),
    cls({ name: 'Science 6',       grades: ['6'], category: 'Science' }),
    cls({ name: 'Social Studies 6',grades: ['6'], category: 'Social Studies' }),
  ];
  const s = student({ grade: '6', choice_1: 'Art 6th', choice_2: 'Band' });
  const { assignments } = run([s], [art6, BAND], std6);
  assert.ok(elecNames(assignments[0]).includes('Art 6th'));
});

// ── Cap enforcement ───────────────────────────────────────────────────────────
console.log('\nCap enforcement');

test('maxSize=1 means at most 1 student per period section (not total)', () => {
  // maxSize is a per-section (per-period) cap, not a total enrollment cap.
  // Art with maxSize=1 can have 1 student in p1, 1 in p2, etc.
  const tinyArt = elec({ id: 'art', name: 'Art', isYearLong: true, maxSize: '1' });
  const students = [
    student({ choice_1: 'Art', choice_2: 'Band' }),
    student({ choice_1: 'Art', choice_2: 'PE' }),
    student({ choice_1: 'Art', choice_2: 'Band' }),
  ];
  const { assignments } = run(students, [tinyArt, BAND, PE]);
  const artPerPeriod = {};
  assignments.forEach(a => {
    Object.entries(a.schedule).forEach(function(kv) {
      if (kv[1] && kv[1].replace('[E] ', '').includes('Art'))
        artPerPeriod[kv[0]] = (artPerPeriod[kv[0]] || 0) + 1;
    });
  });
  const overCap = Object.values(artPerPeriod).some(function(n) { return n > 1; });
  assert.ok(!overCap, 'An Art section exceeded cap of 1');
});

// ── Semester pairing ──────────────────────────────────────────────────────────
console.log('\nSemester pairing');

test('two semester choices are paired into one slot', () => {
  const semArt  = elec({ name: 'Art',  isYearLong: false });
  const semBand = elec({ name: 'Band', isYearLong: false });
  const s = student({ choice_1: 'Art', choice_2: 'Band' });
  const { assignments } = run([s], [semArt, semBand, PE]);
  const paired = elecSlots(assignments[0]).some(v => v.includes(' | '));
  assert.ok(paired, 'semester pair should be combined into one slot');
});

test('semester pair leaves room for a second elective slot', () => {
  const semArt  = elec({ name: 'Art',  isYearLong: false });
  const semBand = elec({ name: 'Band', isYearLong: false });
  const s = student({ choice_1: 'Art', choice_2: 'Band', choice_3: 'PE' });
  const { assignments } = run([s], [semArt, semBand, PE]);
  // Paired slot + year-long slot = 2 total elective slots
  assert.strictEqual(elecSlots(assignments[0]).length, 2);
});

// ── Period constraints ────────────────────────────────────────────────────────
console.log('\nPeriod constraints');

test('class pinned to one period lands in that period', () => {
  const pinnedMath = cls({ name: 'Math 7', grades: ['7'], category: 'Math', periods: 'p1' });
  const s = student({ choice_1: 'Art', choice_2: 'Band' });
  const classes = [pinnedMath, ...STD.filter(c => c.name !== 'Math 7')];
  const { assignments } = run([s], [ART, BAND], classes);
  const a = assignments[0];
  assert.strictEqual(a.schedule['p1'], 'Math 7', 'Math 7 should be in p1');
});

// ── Multiple students ─────────────────────────────────────────────────────────
console.log('\nMultiple students');

test('all 10 students get a complete schedule', () => {
  const students = Array.from({ length: 10 }, (_, i) =>
    student({ student_id: 's' + i, choice_1: i % 2 === 0 ? 'Art' : 'Band', choice_2: i % 2 === 0 ? 'Band' : 'Art' })
  );
  const { assignments, conflicts } = run(students, [ART, BAND]);
  assert.strictEqual(assignments.length, 10);
  assert.strictEqual(conflicts.length, 0);
  assignments.forEach(a => {
    assert.strictEqual(stdSlots(a).length, 4, 'student ' + a.student.student_id + ' missing standard classes');
    assert.strictEqual(elecSlots(a).length, 2, 'student ' + a.student.student_id + ' missing elective slots');
  });
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + (failed === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m') +
  ' ' + passed + '/' + (passed + failed) + ' tests passed\n');
if (failed > 0) process.exit(1);

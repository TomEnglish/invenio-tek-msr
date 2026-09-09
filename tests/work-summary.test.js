const test = require('node:test');
const assert = require('node:assert/strict');
const { exceptionSummary, arrivalSummary, localDate, applyInboxFilter } = require('../js/utils/work-summary.js');
const today = '2026-09-09';
test('open, mine, unassigned and overdue counts include holds and exclude closed/non-exceptions', () => {
    const base = { has_exception: true, exception_resolved: false };
    const records = [
        {...base,id:'late',exception_due_date:'2026-09-08',exception_owner_id:'me',exception_resolution:'hold'},
        {...base,id:'today',exception_due_date:today,exception_owner_id:'someone'},
        {...base,id:'undated',exception_owner_id:null},
        {...base,id:'closed',exception_resolved:true,exception_due_date:'2020-01-01'},
        {...base,id:'ordinary',has_exception:false},
    ];
    const summary = exceptionSummary(records, 'me', today);
    assert.deepEqual(summary.counts, {open:3,mine:1,overdue:1,unassigned:1});
    assert.deepEqual(summary.items.map(r=>r.id), ['late','today','undated']);
    assert.deepEqual(exceptionSummary([], 'me', today).counts, {open:0,mine:0,overdue:0,unassigned:0});
});
test('arrivals distinguish late, next seven days and missing ETA, excluding delivered/cancelled', () => {
    const records = [
        {id:1,eta:'2026-09-08',status:'In Transit'}, {id:2,eta:today,status:'Not RTS'},
        {id:3,eta:'2026-09-16',status:'In Transit'}, {id:4,eta:'2026-09-17',status:'In Transit'},
        {id:5,eta:'2026-01-01',status:' delivered '}, {id:6,eta:null,status:'Cancelled'},
        {id:7,eta:null,status:'In Transit'}, {id:8,eta:'2026-02-30',status:'In Transit'},
    ];
    const summary=arrivalSummary(records,today);
    assert.deepEqual(summary.counts,{late:1,upcoming:2,undated:2});
    assert.deepEqual(summary.items.map(r=>r.id),[1,2,3]);
});
test('inbox queries share explicit local calendar cutoff and validate URL filters', () => {
    const calls=[]; const query={eq(...args){calls.push(['eq',...args]);return this;},lt(...args){calls.push(['lt',...args]);return this;},is(...args){calls.push(['is',...args]);return this;}};
    applyInboxFilter(query,'overdue','me',today);
    assert.deepEqual(calls,[['eq','has_exception',true],['eq','exception_resolved',false],['lt','exception_due_date',today]]);
    calls.length=0; applyInboxFilter(query,'unassigned','me',today);
    assert.deepEqual(calls.at(-1),['is','exception_owner_id',null]);
    calls.length=0; applyInboxFilter(query,'injected','me',today);
    assert.deepEqual(calls,[['eq','has_exception',true],['eq','exception_resolved',false]]);
    assert.equal(localDate(new Date(2026,8,9,0,1)),today);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {TEMPLATE,cleanEvent,effectiveEndDate,scheduleText,cleanPrefs,joinEvent,leaveEvent,setPrefs,assignRole,referencedMemberIds,hydrateEventNames} from '../api/domain.js';
const mk=(cap=4)=>({id:'event123',title:'測試團',category:'battle',date:'2026-11-07',time:'21:00',end:'23:00',cap,roleEnabled:true,waitlistEnabled:true,status:'active',host:'主揪',hostId:'host001',participants:[{id:'host001',name:'主揪',rolePreferences:{tank:'騎士'},assignment:{role:'tank',job:'騎士'}}],waitlist:[]});
const person=(uid)=>({uid,name:uid});
test('4/8/24 party templates',()=>{
 assert.deepEqual(TEMPLATE[4],{tank:1,healer:1,dps:2});
 assert.deepEqual(TEMPLATE[8],{tank:2,healer:2,dps:4});
 assert.deepEqual(TEMPLATE[24],{tank:3,healer:6,dps:15});
});
test('multiple preferences count as just one person',()=>{
 const {event,result}=joinEvent(mk(8),person('p1'),{tank:'戰士、暗黑騎士',healer:'賢者',dps:'舞者、召喚師'});
 assert.equal(result,'joined'); assert.equal(event.participants.length,2);
 assert.equal(Object.keys(event.participants[1].rolePreferences).length,3);
 assert.throws(()=>joinEvent(event,person('p1'),{tank:'戰士'}),/已報名/);
});
test('waitlist and automatic promotion with the same preferences',()=>{
 let e=mk(4);
 for(const id of ['p1','p2','p3'])e=joinEvent(e,person(id),{dps:'舞者'}).event;
 assert.equal(e.participants.length,4);
 const joined=joinEvent(e,person('p4'),{healer:'白魔導士'});
 assert.equal(joined.result,'wait'); assert.equal(joined.event.waitlist.length,1);
 const left=leaveEvent(joined.event,'p2');
 assert.equal(left.event.participants.length,4);assert.equal(left.event.waitlist.length,0);
 assert.equal(left.promoted.id,'p4');
 assert.equal(left.event.participants.find(x=>x.id==='p4').rolePreferences.healer,'白魔導士');
});
test('assignments enforce volunteered job and slot limits',()=>{
 let e=joinEvent(mk(4),person('p1'),{tank:'戰士',healer:'白魔導士',dps:'武士'}).event;
 assert.throws(()=>assignRole(e,'p1','tank','戰士'),/已經排滿/);
 assert.throws(()=>assignRole(e,'p1','healer','占星術士'),/不在玩家/);
 const next=assignRole(e,'p1','healer','白魔導士');
 assert.deepEqual(next.participants[1].assignment,{role:'healer',job:'白魔導士'});
 assert.deepEqual(e.participants[1].assignment,undefined);
});
test('changing preferences removes incompatible assignment',()=>{
 let e=joinEvent(mk(8),person('p1'),{healer:'白魔導士',dps:'舞者'}).event;
 e=assignRole(e,'p1','healer','白魔導士');
 e=setPrefs(e,'p1',{dps:'舞者'});
 assert.equal(e.participants[1].assignment,null);
});
test('invalid dates, over-limit and non-volunteered roles are rejected',()=>{
 assert.throws(()=>cleanEvent({title:'團',date:'2026-02-30',time:'21:00',end:'23:00',cap:8}),/日期/);
 assert.throws(()=>cleanPrefs({tank:''}),/職業/);
 assert.throws(()=>cleanPrefs({tank:'騎士',boss:'牛'}),/位置/);
 assert.throws(()=>leaveEvent(mk(4),'host001'),/主揪/);
});

test('renaming member updates host, attendee and waitlist labels for every reader',()=>{
 const event=mk(4);
 event.participants.push({id:'p1',name:'舊暱稱',rolePreferences:{dps:'舞者'}});
 event.waitlist.push({id:'p1',name:'舊暱稱'});
 const newNames=new Map([['host001','新主揪'],['p1','新的 FF14 暱稱']]);
 assert.deepEqual(referencedMemberIds([event]),['host001','p1']);
 const hydrated=hydrateEventNames(event,newNames);
 assert.equal(hydrated.host,'新主揪');
 assert.equal(hydrated.participants[0].name,'新主揪');
 assert.equal(hydrated.participants[1].name,'新的 FF14 暱稱');
 assert.equal(hydrated.waitlist[0].name,'新的 FF14 暱稱');
 assert.equal(hydrated.participants[0].assignment.job,'騎士');
 // Persisted event snapshots and team composition remain untouched.
 assert.equal(event.host,'主揪');
 assert.equal(event.participants[1].name,'舊暱稱');
 assert.equal(event.waitlist[0].name,'舊暱稱');
});
test('unknown member falls back to saved name, no roster loss',()=>{
 const event=mk(8);
 event.participants.push({id:'former001',name:'已離開的朋友'});
 const hydrated=hydrateEventNames(event,new Map([['host001','當前主揪']]));
 assert.equal(hydrated.host,'當前主揪');
 assert.equal(hydrated.participants[1].name,'已離開的朋友');
 assert.deepEqual(referencedMemberIds([]),[]);
});


test('24-hour time and same-day 22:00–23:00 stay same day',()=>{
 const event=cleanEvent({title:'一般夜團',date:'2026-11-07',time:'22:00',end:'23:00',cap:8});
 assert.equal(event.endDate,'2026-11-07');
 assert.equal(event.endDateManual,false);
 assert.equal(scheduleText(event),'2026-11-07 22:00–23:00');
});
test('cross-midnight 22:00–01:00 becomes following day automatically',()=>{
 const event=cleanEvent({title:'深夜團',date:'2026-11-07',time:'22:00',end:'01:00',cap:8});
 assert.equal(event.endDate,'2026-11-08');
 assert.equal(event.endDateManual,false);
 assert.equal(scheduleText(event),'2026-11-07 22:00 → 2026-11-08 01:00');
});
test('auto cross-midnight correctly handles month/year/leap-day boundaries',()=>{
 assert.equal(cleanEvent({title:'跨年',date:'2026-12-31',time:'23:50',end:'00:30',cap:8}).endDate,'2027-01-01');
 assert.equal(cleanEvent({title:'跨月',date:'2028-02-29',time:'23:50',end:'00:30',cap:8}).endDate,'2028-03-01');
});
test('explicit multi-day end date is preserved',()=>{
 const event=cleanEvent({title:'多日 RP',date:'2026-11-07',time:'22:00',end:'01:00',endDate:'2026-11-10',cap:0});
 assert.equal(event.endDate,'2026-11-10');
 assert.equal(event.endDateManual,true);
 assert.equal(scheduleText(event),'2026-11-07 22:00 → 2026-11-10 01:00');
});
test('same start/end clock without explicit next day is rejected',()=>{
 assert.throws(()=>cleanEvent({title:'同時',date:'2026-11-07',time:'22:00',end:'22:00',cap:8}),/相同/);
 const event=cleanEvent({title:'一天',date:'2026-11-07',time:'22:00',end:'22:00',endDate:'2026-11-08',cap:8});
 assert.equal(event.endDate,'2026-11-08');
});
test('end cannot precede start on an explicitly chosen date; invalid dates rejected',()=>{
 assert.throws(()=>cleanEvent({title:'錯誤',date:'2026-11-07',time:'22:00',end:'01:00',endDate:'2026-11-07',cap:8}),/必須晚於/);
 assert.throws(()=>cleanEvent({title:'錯誤',date:'2026-11-07',time:'22:00',end:'01:00',endDate:'2026-11-31',cap:8}),/日期格式/);
 assert.throws(()=>cleanEvent({title:'錯誤',date:'2026-11-07',time:'22:00',end:'',endDate:'2026-11-08',cap:8}),/先填寫結束時間/);
 assert.throws(()=>cleanEvent({title:'錯誤',date:'2026-11-07',time:'24:00',end:'01:00',cap:8}),/24 小時制/);
});
test('legacy events without endDate remain compatible',()=>{
 assert.equal(effectiveEndDate({date:'2026-11-07',time:'21:00',end:'23:00'}),'2026-11-07');
 assert.equal(scheduleText({date:'2026-11-07',time:'21:00',end:'23:00'}),'2026-11-07 21:00–23:00');
});

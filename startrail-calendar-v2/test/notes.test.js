import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanEvent,noteOccurrenceDate,nextNoteOccurrence,joinEvent,leaveEvent,setPrefs,assignRole} from '../api/domain.js';
import {announcementPayload} from '../api/discord.js';
const notePayload=(extra={})=>({title:'小花生日',date:'2026-11-07',category:'note',description:'祝你生日快樂 🎂',noteType:'birthday',recurrence:'yearly',...extra});
const saved=()=>({id:'note001',...cleanEvent(notePayload()),status:'active',hostId:'a001',host:'小明',participants:[],waitlist:[]});
test('birthday note needs only title and date; it never registers a host as attendee',()=>{
 const data=cleanEvent(notePayload({cap:8,roleEnabled:true,waitlistEnabled:true,time:'21:00',end:'23:00'}));
 assert.equal(data.category,'note');
 assert.equal(data.time,'00:00');assert.equal(data.end,'');assert.equal(data.allDay,true);
 assert.equal(data.cap,0);assert.equal(data.roleEnabled,false);assert.equal(data.waitlistEnabled,false);
 assert.equal(data.noteType,'birthday');assert.equal(data.recurrence,'yearly');
});
test('single note appears only in its own year and annual note repeats',()=>{
 const e=saved();
 assert.equal(noteOccurrenceDate(e,2026),'2026-11-07');
 assert.equal(noteOccurrenceDate(e,2027),'2027-11-07');
 assert.equal(noteOccurrenceDate(e,2025),null);
 assert.equal(nextNoteOccurrence(e,'2026-11-08'),'2027-11-07');
 assert.equal(nextNoteOccurrence(e,'2027-11-07'),'2027-11-07');
 const single={...e,recurrence:'none'};
 assert.equal(noteOccurrenceDate(single,2027),null);
 assert.equal(nextNoteOccurrence(single,'2026-11-08'),null);
});
test('Feb 29 birthday is never silently shifted to Feb 28',()=>{
 const e={...saved(),date:'2028-02-29'};
 assert.equal(noteOccurrenceDate(e,2029),null);
 assert.equal(noteOccurrenceDate(e,2032),'2032-02-29');
 assert.equal(nextNoteOccurrence(e,'2029-03-01'),'2032-02-29');
});
test('notes cannot accept +1, departures, preferences or job assignments',()=>{
 const n=saved();
 assert.throws(()=>joinEvent(n,{uid:'b001',name:'朋友'},null),/記事不開放報名/);
 assert.throws(()=>leaveEvent(n,'a001'),/記事沒有報名/);
 assert.throws(()=>setPrefs(n,'a001',{dps:'武士'}),/記事沒有職業/);
 assert.throws(()=>assignRole(n,'a001','dps','武士'),/沒有開啟職業分配/);
});
test('cannot convert a published raid to note (or note to raid)',()=>{
 const previous={...saved()};
 assert.throws(()=>cleanEvent({...notePayload(),category:'battle',time:'21:00',end:'23:00',cap:8},previous),/不能互相轉換/);
 assert.throws(()=>cleanEvent(notePayload(),{...previous,category:'battle'}),/不能互相轉換/);
});
test('notes reject malformed dates and normalize note type',()=>{
 assert.throws(()=>cleanEvent(notePayload({date:'2026-02-30'})),/日期格式/);
 assert.equal(cleanEvent(notePayload({noteType:'secret',recurrence:'month'})).noteType,'general');
 assert.equal(cleanEvent(notePayload({noteType:'secret',recurrence:'month'})).recurrence,'none');
});
test('non-note announcements remain unchanged',()=>{
 const raid={id:'raid001',title:'週末練習',category:'battle',date:'2026-11-07',time:'21:00',end:'23:00',host:'主揪',participants:[{id:'a',name:'主揪'}],waitlist:[],cap:8,status:'active',roleEnabled:false};
 assert.equal(announcementPayload(raid).components[0].components[0].label,'+1 我要參加');
});

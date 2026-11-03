import test from 'node:test';
import assert from 'node:assert/strict';
import {TEMPLATE,cleanEvent,cleanPrefs,joinEvent,leaveEvent,setPrefs,assignRole} from '../api/domain.js';
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

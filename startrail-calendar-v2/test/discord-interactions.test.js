import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyDiscordRequest,parseAction,modalValues,roleModal,linkModal} from '../api/discord-protocol.js';
import {announcementPayload} from '../api/discord.js';
import {issueLinkCode,redeemLinkCode,unlinkDiscord,resolveDiscordMember} from '../api/discord-link.js';
import {joinEvent,leaveEvent,fail} from '../api/domain.js';

const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const publicHex=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
const now=1_800_000_000_000;

test('Discord signature accepts valid signed raw request and rejects forgery / stale timestamps',()=>{
  const body=JSON.stringify({type:1});const ts=String(Math.floor(now/1000));
  const sig=sign(null,Buffer.from(ts+body),privateKey).toString('hex');
  assert.equal(verifyDiscordRequest(body,sig,ts,publicHex,{now:()=>now}),true);
  assert.equal(verifyDiscordRequest(body+' ',sig,ts,publicHex,{now:()=>now}),false);
  assert.equal(verifyDiscordRequest(body,'0'.repeat(128),ts,publicHex,{now:()=>now}),false);
  assert.equal(verifyDiscordRequest(body,sig,ts,publicHex,{now:()=>now+600_000}),false);
});

test('announcement has +1, cancel, link buttons; battle adds role-edit, no URL leak',()=>{
  const base={id:'abc123def456',status:'active',category:'battle',title:'練習團',date:'2026-11-07',time:'22:00',end:'01:00',roleEnabled:true,participants:[],waitlist:[],host:'小明',cap:8};
  const result=announcementPayload(base,'https://startrail.example');
  const buttons=result.components[0].components;
  assert.equal(buttons.length,5);
  assert.equal(buttons[0].custom_id,'st:join:b:abc123def456');
  assert.equal(buttons[1].custom_id,'st:leave:b:abc123def456');
  assert.equal(buttons[2].custom_id,'st:edit:b:abc123def456');
  assert.equal(buttons[3].custom_id,'st:link');
  assert.equal(buttons[4].style,5);
  assert.equal(parseAction(buttons[0].custom_id).kind,'join');
  assert.equal(parseAction('st:role:join:abc123def456').kind,'join-roles');
  assert.equal(roleModal(base.id).data.components.length,3);
  assert.equal(linkModal().data.components.length,1);
  assert.deepEqual(modalValues([{components:[{custom_id:'tank',value:'騎士、戰士'},{custom_id:'healer',value:''}]}]),{tank:'騎士、戰士',healer:''});
  assert.equal(announcementPayload({...base,status:'cancelled'},'https://startrail.example').components,undefined);
});

class MemoryDB{
  constructor(items={}){this.items=new Map(Object.entries(items));}
  collection(name){return {doc:(id)=>this.ref(`${name}/${id}`)};}
  ref(key){const db=this;return {key,id:key.split('/').at(-1),async get(){return db.snap(key)},};}
  snap(key){const data=this.items.get(key);return {exists:!!data,id:key.split('/').at(-1),data:()=>data?structuredClone(data):undefined};}
  async runTransaction(callback){const db=this;const ops=[];const tx={
    async get(ref){return db.snap(ref.key)},
    create(ref,value){ops.push(['create',ref.key,value])},
    set(ref,value){ops.push(['set',ref.key,value])},
    update(ref,value){ops.push(['update',ref.key,value])},
    delete(ref){ops.push(['delete',ref.key])}
  };const answer=await callback(tx);for(const [kind,key,data] of ops){if(kind==='delete'){db.items.delete(key);continue}if(kind==='create'&&db.items.has(key))throw Error('already exists');if(kind==='update'&&!db.items.has(key))throw Error('not found');db.items.set(key,kind==='update'?{...db.items.get(key),...data}:structuredClone(data))}return answer;}
}
const googleUid='GOOGLE_USER_12345678';
const discordUid='1567164569296572516';
const actor={uid:googleUid,email:'friend@example.com',name:'冒險好友',active:true};
const discordUser={id:discordUid,global_name:'雲朵莫古力'};

test('one-time Google to Discord binding is single-use and can be unlinked',async()=>{
  const db=new MemoryDB({[`members/${googleUid}`]:{email:actor.email,name:actor.name,active:true}});
  const issued=await issueLinkCode(db,actor,{code:'ABCD-EFGH-JKLM',clock:()=>now});
  assert.equal(issued.expiresAt,now+600000);
  const info=await redeemLinkCode(db,issued.code,discordUser,{clock:()=>now+1000});
  assert.equal(info.name,actor.name);
  assert.equal((await resolveDiscordMember(db,discordUid)).uid,googleUid);
  await assert.rejects(redeemLinkCode(db,issued.code,discordUser,{clock:()=>now+2000}),/已使用/);
  await unlinkDiscord(db,actor);
  assert.equal(await resolveDiscordMember(db,discordUid),null);
});

test('codes expire, old code invalidated on regeneration, no cross-account takeover',async()=>{
  const db=new MemoryDB({[`members/${googleUid}`]:{email:actor.email,name:actor.name,active:true}});
  const one=await issueLinkCode(db,actor,{code:'ABCD-EFGH-JKLM',clock:()=>now});
  await assert.rejects(redeemLinkCode(db,one.code,discordUser,{clock:()=>now+600001}),/過期/);
  const two=await issueLinkCode(db,actor,{code:'ABCD-EFGH-JKMN',clock:()=>now+100});
  await assert.rejects(redeemLinkCode(db,one.code,discordUser,{clock:()=>now+101}),/過期/);
  await redeemLinkCode(db,two.code,discordUser,{clock:()=>now+101});
  const secondUid='GOOGLE_USER_87654321';
  const second={uid:secondUid,email:'second@example.com',name:'第二位',active:true};
  db.items.set(`members/${secondUid}`,{email:second.email,name:second.name,active:true});
  const code=await issueLinkCode(db,second,{code:'PQRS-TUVW-XYZA',clock:()=>now});
  await assert.rejects(redeemLinkCode(db,code.code,discordUser,{clock:()=>now+101}),/其他會員/);
});

test('Discord-style join and leave use existing domain rules, with one slot for multiple roles',()=>{
  const e={id:'abc123def456',status:'active',cap:4,roleEnabled:true,hostId:'host',participants:[{id:'host',name:'主揪'}],waitlist:[],waitlistEnabled:true};
  const joined=joinEvent(e,{uid:googleUid,name:'冒險好友'},{tank:'騎士',healer:'白魔',dps:'舞者'}).event;
  assert.equal(joined.participants.length,2);
  assert.equal(Object.keys(joined.participants[1].rolePreferences).length,3);
  assert.throws(()=>joinEvent(joined,{uid:googleUid,name:'冒險好友'},{tank:'戰士'}),/已報名/);
  const left=leaveEvent(joined,googleUid).event;
  assert.equal(left.participants.length,1);
});

// End-to-end HTTP handshake tests without touching Firebase or Discord.
import {handleDiscordHTTP} from '../api/discord-handler-core.js';
const env={DISCORD_PUBLIC_KEY:publicHex,DISCORD_CHANNEL_ID:'1567164569296572516',DISCORD_CLIENT_ID:'1570000000000000000'};
function signedRequest(payload,time=Date.now()){
  const body=JSON.stringify(payload),ts=String(Math.floor(time/1000));
  const signature=sign(null,Buffer.from(ts+body),privateKey).toString('hex');
  return new Request('https://example.com/api/discord-interactions',{method:'POST',headers:{'x-signature-ed25519':signature,'x-signature-timestamp':ts},body});
}
test('signed Discord PING returns PONG; bad signatures rejected',async()=>{
  const r=await handleDiscordHTTP(signedRequest({type:1}),{env});
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{type:1});
  const invalid=new Request('https://example.com/api/discord-interactions',{method:'POST',body:'{}'});
  assert.equal((await handleDiscordHTTP(invalid,{env})).status,401);
});
test('battle join opens a modal, normal join defers a private reply',async()=>{
  const base={application_id:env.DISCORD_CLIENT_ID,channel_id:env.DISCORD_CHANNEL_ID,member:{user:{id:discordUid}}};
  const battle={...base,type:3,data:{custom_id:'st:join:b:abc123def456'}};
  const modal=await handleDiscordHTTP(signedRequest(battle),{env});
  assert.equal((await modal.json()).type,9);
  let processed=false,scheduled=null;
  const ordinary={...base,type:3,data:{custom_id:'st:join:n:abc123def456'}};
  const deferred=await handleDiscordHTTP(signedRequest(ordinary),{env,schedule:promise=>{scheduled=promise;},process:async()=>{processed=true}});
  assert.deepEqual(await deferred.json(),{type:5,data:{flags:64}});
  await scheduled;assert.equal(processed,true);
  const wrongChannel=await handleDiscordHTTP(signedRequest({...ordinary,channel_id:'1111111111111111111'}),{env,schedule:()=>{}});
  assert.match((await wrongChannel.json()).data.content,/公告頻道/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {announcementPayload,discordRequest,discordConfigured,eventLink,siteOrigin,syncAnnouncement} from '../api/discord.js';

const sample={id:'event_test_543210',title:'零式 @everyone 練習團',category:'battle',date:'2026-11-07',time:'21:00',end:'23:00',host:'新的 FF14 暱稱',hostId:'host01',location:'Elemental',description:'歡迎 @here 朋友一起打！',cap:8,status:'active',roleEnabled:true,revision:1,participants:[{id:'host01',name:'舊名',assignment:{role:'tank',job:'騎士'}}],waitlist:[]};
const token='fake-secret';const channelId='123456789012345678';
function fakeFetch(out,opts={}){
 return async (url,init)=>{
   const req={url,method:init.method,body:JSON.parse(init.body),headers:init.headers};out.push(req);
   return {ok:opts.ok??true,status:opts.status??200,json:async()=>({id:'987654321098765432'})};
 };
}
test('announcements show roster counts, mask accidental @pings and link to event',()=>{
 const p=announcementPayload(sample,'https://example.vercel.app');
 assert.equal(p.allowed_mentions.parse.length,0);
 assert.equal(p.embeds[0].url,'https://example.vercel.app/#event=event_test_543210');
 assert.match(p.embeds[0].title,/零式/);
 assert.match(p.embeds[0].description,/@\u200beveryone|@\u200bhere/);
 assert.equal(p.embeds[0].fields.find(f=>f.name==='👥 報名').value,'1 / 8');
 assert.match(p.embeds[0].fields.find(f=>f.name==='✦ 正式排位').value,/坦克 1\/2/);
 const cancelled=announcementPayload({...sample,status:'cancelled'},'https://example.vercel.app');
 assert.match(cancelled.content,/已取消/);
});
test('bot creates once using nonce, edits existing post without creating new message',async()=>{
 const calls=[];
 const first=await discordRequest({event:sample,token,channelId,origin:'https://example.vercel.app',fetcher:fakeFetch(calls)});
 assert.equal(first.messageId,'987654321098765432');
 assert.equal(calls[0].method,'POST');
 assert.equal(calls[0].body.enforce_nonce,true);
 assert.equal(calls[0].body.nonce,sample.id);
 assert.equal(calls[0].headers.Authorization,`Bot ${token}`);
 await discordRequest({event:{...sample,participants:[...sample.participants,{id:'new',name:'小花'}]},messageId:first.messageId,token,channelId,fetcher:fakeFetch(calls)});
 assert.equal(calls[1].method,'PATCH');
 assert.match(calls[1].url,/\/987654321098765432$/);
 assert.equal(calls[1].body.enforce_nonce,undefined);
 assert.equal(calls[1].body.embeds[0].fields[2].value,'2 / 8');
});
test('errors produce HTTP status but never include token in message',async()=>{
 await assert.rejects(discordRequest({event:sample,token,channelId,fetcher:fakeFetch([],{ok:false,status:403})}),e=>e.code==='HTTP_403'&&!e.message.includes(token));
 assert.equal(discordConfigured({DISCORD_BOT_TOKEN:token,DISCORD_CHANNEL_ID:channelId}),true);
 assert.equal(discordConfigured({DISCORD_BOT_TOKEN:token,DISCORD_CHANNEL_ID:'bad'}),false);
 assert.equal(siteOrigin('https://preview.example', {VERCEL_PROJECT_PRODUCTION_URL:'the-domain.vercel.app'}),'https://the-domain.vercel.app');
 assert.equal(eventLink(sample,''),'');
});

class Store {
 constructor(){this.documents=new Map();}
 collection(name){return {doc:(id)=>new Doc(this,`${name}/${id}`)};}
 async getAll(...refs){return Promise.all(refs.map(ref=>ref.get()));}
 async runTransaction(fn){
   const writes=[];
   const tx={get:ref=>ref.get(),set:(ref,record,opts)=>writes.push([ref,record,opts])};
   const result=await fn(tx);
   for(const [ref,record,opts] of writes)await ref.set(record,opts);
   return result;
 }
}
class Doc {
 constructor(store,path){this.store=store;this.path=path;this.id=path.split('/').at(-1);}
 async get(){const value=this.store.documents.get(this.path);return {id:this.id,exists:!!value,data:()=>structuredClone(value)};}
 async set(data,opts={}){const old=this.store.documents.get(this.path)||{};this.store.documents.set(this.path,structuredClone(opts.merge?{...old,...data}:data));}
}
test('Firestore syncing sends one post, reuses it for updates and refreshes stored nicknames',async()=>{
 const db=new Store();const calls=[];
 await db.collection('events').doc(sample.id).set(sample);
 await db.collection('members').doc('host01').set({name:'最新的主揪暱稱'});
 const options={env:{DISCORD_CHANNEL_ID:channelId,DISCORD_BOT_TOKEN:token},fetcher:fakeFetch(calls)};
 const result=await syncAnnouncement(db,sample.id,'https://example.vercel.app',options);
 assert.equal(result.status,'sent');
 assert.equal(calls.length,1);
 assert.equal(calls[0].body.embeds[0].fields[1].value,'最新的主揪暱稱');
 await db.collection('events').doc(sample.id).set({...sample,revision:2,participants:[...sample.participants,{id:'p2',name:'阿花'}]});
 const next=await syncAnnouncement(db,sample.id,'https://example.vercel.app',options);
 assert.equal(next.status,'sent');
 assert.equal(calls.length,2);
 assert.equal(calls[1].method,'PATCH');
 assert.equal(calls[1].body.embeds[0].fields[2].value,'2 / 8');
 const meta=await db.collection('discordAnnouncements').doc(sample.id).get();
 assert.equal(meta.data().messageId,'987654321098765432');
});
test('when Discord is unavailable, activity data remains intact and manual sync can retry',async()=>{
 const db=new Store();await db.collection('events').doc(sample.id).set(sample);
 const config={DISCORD_CHANNEL_ID:channelId,DISCORD_BOT_TOKEN:token};
 const failed=await syncAnnouncement(db,sample.id,'',{env:config,fetcher:fakeFetch([],{ok:false,status:403})});
 assert.equal(failed.status,'error');
 assert.equal((await db.collection('events').doc(sample.id).get()).data().title,sample.title);
 const recovered=await syncAnnouncement(db,sample.id,'',{env:config,fetcher:fakeFetch([])});
 assert.equal(recovered.status,'sent');
});

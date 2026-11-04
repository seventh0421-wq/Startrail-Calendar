// Server-only Discord announcements. Never expose a bot token to a browser.
import {referencedMemberIds,hydrateEventNames,scheduleText} from './domain.js';

const TYPE = {
  battle:['⚔️ 戰鬥','#d69aaa',0xd69aaa],
  explore:['🗺️ 探索','#83c9b8',0x83c9b8],
  photo:['📸 攝影','#95a8ee',0x95a8ee],
  rp:['🎭 RP','#b9a1dc',0xb9a1dc],
  other:['✨ 其他','#e9c88c',0xe9c88c]
};
const ROLE_LABEL = {tank:'🛡️ 坦克',healer:'💚 補師',dps:'⚔️ 輸出'};
const ROLE_SLOTS = {4:{tank:1,healer:1,dps:2},8:{tank:2,healer:2,dps:4},24:{tank:3,healer:6,dps:15}};
const safe = (value,max=1000)=>String(value??'').replace(/@/g,'@\u200b').slice(0,max);
const singleLine = (v,max)=>safe(v,max).replace(/[\r\n\t]+/g,' ').trim()||'（未提供）';

// A stable URL is preferred. Vercel defines VERCEL_PROJECT_PRODUCTION_URL automatically.
export function siteOrigin(requestUrl,env=process.env){
  const host=env.PUBLIC_SITE_URL||env.VERCEL_PROJECT_PRODUCTION_URL||env.VERCEL_URL||'';
  try{
    if(host){const url=new URL(/^https?:\/\//.test(host)?host:`https://${host}`);if(url.protocol==='https:')return url.origin;}
    const origin=new URL(requestUrl).origin;
    return origin.startsWith('https://')?origin:'';
  }catch{return '';}
}
export function eventLink(event,origin){return origin?`${origin}/#event=${encodeURIComponent(event.id)}`:'';}

export function announcementPayload(event,origin=''){
  const [category,_,color]=TYPE[event.category]||TYPE.other;
  const count=event.participants?.length||0;
  const wait=event.waitlist?.length||0;
  const title=singleLine(event.title,200);
  const cancelled=event.status==='cancelled';
  const fields=[
    {name:'📅 時間（台灣 · 24 小時制）',value:singleLine(scheduleText(event),65),inline:true},
    {name:'🌙 主揪',value:singleLine(event.host,60),inline:true},
    {name:'👥 報名',value:`${count}${event.cap?` / ${event.cap}`:' 人（不限人數）'}${wait?` · 候補 ${wait} 人`:''}`,inline:true},
    {name:'📍 集合地點',value:singleLine(event.location||'主揪尚未公布',200),inline:false}
  ];
  if(event.roleEnabled){
    const plan=ROLE_SLOTS[event.cap];
    const label=Object.entries(ROLE_LABEL).map(([role,text])=>{
      const assigned=(event.participants||[]).filter(p=>p.assignment?.role===role).length;
      return `${text} ${assigned}${plan?`/${plan[role]}`:''}`;
    }).join(' · ');
    fields.push({name:'✦ 正式排位',value:label,inline:false});
  }
  const url=eventLink(event,origin);
  const description=safe(event.description||'一起出發冒險吧！',1000);
  const suffix=String(event.id||'');
  const canButtons=/^[a-zA-Z0-9_-]{6,78}$/.test(suffix);
  const components=(!cancelled&&canButtons)?[{type:1,components:[
    {type:2,style:3,label:'+1 我要參加',custom_id:`st:join:${event.roleEnabled?'b':'n'}:${suffix}`},
    {type:2,style:2,label:'取消報名',custom_id:`st:leave:${event.roleEnabled?'b':'n'}:${suffix}`},
    ...(event.roleEnabled?[{type:2,style:1,label:'修改職業志願',custom_id:`st:edit:b:${suffix}`}]:[]),
    {type:2,style:2,label:'綁定帳號',custom_id:'st:link'},
    ...(url?[{type:2,style:5,label:'查看網站',url}]:[])
  ]}]:[];
  return {
    ...(components.length?{components}:{}),
    content:cancelled?'☁️ 庫啵！這場冒險已取消。':'☁️ 庫啵！星旅日誌有冒險邀請！',
    embeds:[{
      title:`${cancelled?'❌ [已取消] ':''}${title}`,
      ...(url?{url}:{}),
      description:`${category}\n\n${description}${url?'\n\n點擊標題可開啟網站活動詳情。':''}`,
      color:cancelled?0xa9636d:color,
      fields,
      footer:{text:'星旅日誌 · Eorzea Adventure Log'}
    }],
    allowed_mentions:{parse:[]}
  };
}

// Separate from the member-facing API: no bot token or member email is returned.
export function discordConfigured(env=process.env){
  return Boolean(env.DISCORD_BOT_TOKEN&&/^\d{15,23}$/.test(env.DISCORD_CHANNEL_ID||''));
}
export async function discordRequest({token,channelId,messageId,event,origin,fetcher=fetch}){
  const isEdit=Boolean(messageId);
  const url=`https://discord.com/api/v10/channels/${channelId}/messages${isEdit?`/${messageId}`:''}`;
  const payload=announcementPayload(event,origin);
  if(!isEdit){
    // Discord de-duplicates repeated creates from the same bot with this nonce
    // for a short period; Firestore keeps the message ID for long-term edits.
    payload.nonce=String(event.id).slice(0,25);
    payload.enforce_nonce=true;
  }
  const response=await fetcher(url,{
    method:isEdit?'PATCH':'POST',
    headers:{'Authorization':`Bot ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify(payload),
    signal:AbortSignal.timeout(6500)
  });
  if(!response.ok){
    const err=new Error(`Discord HTTP ${response.status}`);
    err.code=`HTTP_${response.status}`;
    throw err;
  }
  const data=await response.json();
  if(!/^\d{15,23}$/.test(String(data.id||'')))throw new Error('Discord 未傳回有效的訊息 ID');
  return {messageId:data.id,edited:isEdit};
}

async function freshEvent(db,eventId){
  const snap=await db.collection('events').doc(eventId).get();
  if(!snap.exists)return null;
  const event={id:snap.id,...snap.data()};
  const ids=referencedMemberIds([event]);
  if(!ids.length)return event;
  const names=new Map();
  for(let start=0;start<ids.length;start+=100){
    const members=await db.getAll(...ids.slice(start,start+100).map(id=>db.collection('members').doc(id)));
    for(const item of members)if(typeof item.data()?.name==='string'&&item.data().name.trim())names.set(item.id,item.data().name);
  }
  return hydrateEventNames(event,names);
}

// A short Firestore lease prevents most competing requests from posting twice.
// The retry action can recover a failed announcement without changing the event.
export async function syncAnnouncement(db,eventId,origin,options={}){
  const env=options.env||process.env;
  if(!discordConfigured(env))return {status:'unconfigured'};
  // Defensive boundary: notes must never be posted as joinable Discord announcements.
  const initial=await db.collection('events').doc(eventId).get();
  if(initial.exists&&initial.data()?.category==='note')return {status:'skipped'};
  const announcements=db.collection('discordAnnouncements');
  const ref=announcements.doc(eventId);
  const channelId=env.DISCORD_CHANNEL_ID;
  let outcome={status:'pending'};
  for(let attempt=0;attempt<2;attempt++){
    const now=Date.now();
    let claim;
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref);
      const existing=snap.exists?snap.data():{};
      if(existing.leaseUntil>now){claim=null;return;}
      claim={messageId:existing.channelId===channelId?existing.messageId:null};
      tx.set(ref,{channelId,status:'sending',leaseUntil:now+12000,lastAttemptAt:new Date(now).toISOString()}, {merge:true});
    });
    if(!claim)return outcome;
    let revision;
    try{
      const event=await freshEvent(db,eventId);
      if(!event)throw new Error('活動不存在');
      revision=event.revision||event.updatedAt||'';
      let message;
      try{
        message=await discordRequest({token:env.DISCORD_BOT_TOKEN,channelId,messageId:claim.messageId,event,origin,fetcher:options.fetcher||fetch});
      }catch(error){
        // If someone deleted the old Discord message, re-create it instead.
        if(claim.messageId&&error.code==='HTTP_404'){
          message=await discordRequest({token:env.DISCORD_BOT_TOKEN,channelId,event,origin,fetcher:options.fetcher||fetch});
        }else throw error;
      }
      await ref.set({channelId,messageId:message.messageId,status:'sent',leaseUntil:0,lastSyncedRevision:revision,lastSentAt:new Date().toISOString(),lastError:null},{merge:true});
      outcome={status:'sent',messageId:message.messageId};
      const newest=await db.collection('events').doc(eventId).get();
      // If a join happened while the message was being sent, refresh once.
      if((newest.data()?.revision||newest.data()?.updatedAt||'')!==revision)continue;
      return outcome;
    }catch(error){
      console.error('Startrail Discord announcement:',error.code||error.message);
      await ref.set({status:'error',leaseUntil:0,lastError:String(error.code||error.name||'UNKNOWN').slice(0,40),lastAttemptAt:new Date().toISOString()},{merge:true});
      return {status:'error',message:'活動已儲存，但 Discord 公告暫時失敗；主揪可在活動詳情重新同步。'};
    }
  }
  return outcome;
}

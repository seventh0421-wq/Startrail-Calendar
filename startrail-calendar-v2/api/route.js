import {createHash} from 'node:crypto';
import {getApps,initializeApp,cert} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {cleanEmail,cleanEvent,cleanProfile,joinEvent,leaveEvent,setPrefs,assignRole,copyForUpdate,referencedMemberIds,hydrateEventNames,fail} from './domain.js';

const stamp=()=>new Date().toISOString();
const idForEmail=email=>createHash('sha256').update(cleanEmail(email)).digest('hex');
const ok=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function init(){
  if(!process.env.OWNER_EMAIL||!process.env.FIREBASE_PROJECT_ID) fail('伺服器尚未設定 OWNER_EMAIL 或 FIREBASE_PROJECT_ID',503);
  if(!getApps().length){
    if(!process.env.FIREBASE_SERVICE_ACCOUNT_JSON)fail('伺服器尚未設定 Firebase 管理員憑證',503);
    let secret;
    try{secret=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)}catch{fail('Firebase 管理員憑證格式錯誤',503)}
    if(secret.project_id!==process.env.FIREBASE_PROJECT_ID)fail('Firebase 管理員憑證的專案不一致',503);
    initializeApp({credential:cert(secret),projectId:process.env.FIREBASE_PROJECT_ID});
  }
  return getFirestore();
}
async function identity(request){
  const bearer=request.headers.get('authorization')||'';
  if(!/^Bearer\s+\S+$/.test(bearer))fail('請先使用 Google 帳號登入',401);
  let token;
  try{token=await getAuth().verifyIdToken(bearer.replace(/^Bearer\s+/,'').trim(),true)}catch{fail('登入已失效，請重新登入',401)}
  if(token.firebase?.sign_in_provider!=='google.com'||token.email_verified!==true||!token.email) fail('請使用已驗證的 Google 帳號',403);
  return {uid:token.uid,email:cleanEmail(token.email),displayName:token.name||token.email.split('@')[0]};
}
async function memberFor(db, user){
  const ref=db.collection('members').doc(user.uid),snapshot=await ref.get(),owner=cleanEmail(process.env.OWNER_EMAIL);
  if(snapshot.exists){
    const m=snapshot.data();
    if(!m.active||m.email!==user.email)fail('帳號沒有好友行事曆的使用權限',403);
    return {uid:user.uid,...m};
  }
  const isOwner=user.email===owner;
  if(!isOwner){
    const invite=await db.collection('invites').doc(idForEmail(user.email)).get();
    if(!invite.exists||!invite.data().active)fail('這個 Google 帳號尚未受邀。請聯絡行事曆管理員。',403);
  }
  const m={email:user.email,name:user.displayName.slice(0,25),avatar:'🌙',role:isOwner?'admin':'member',active:true,createdAt:stamp()};
  try{await ref.create(m)}catch(e){if(e.code!==6&&e.code!=='already-exists')throw e;}
  const current=(await ref.get()).data();
  if(!current?.active||current.email!==user.email)fail('帳號沒有使用權限',403);
  return {uid:user.uid,...current};
}
const isManager=(actor,e)=>actor.role==='admin'||e.hostId===actor.uid;
function eventRef(db,id){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{6,100}$/.test(id))fail('活動識別碼錯誤');return db.collection('events').doc(id)}
function parseEvent(snap){return {id:snap.id,...snap.data()}}
async function transactionEvent(db, id, actor, fn){
  const ref=eventRef(db,id);
  return db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists)fail('找不到這場活動',404);
    const e=parseEvent(snap);
    const result=fn(e);
    const next=result?.event||result;
    tx.update(ref,{...copyForUpdate(next),updatedAt:stamp()});
    return {event:{...next,updatedAt:stamp()},result:result?.result||null,promoted:result?.promoted?.name||null};
  });
}
async function action(db, actor, body){
  const what=body.action;
  switch(what){
    case 'bootstrap':return {member:actor};
    case 'list': {
      const snap=await db.collection('events').orderBy('date','desc').limit(250).get();
      const events=snap.docs.map(parseEvent);
      // Names saved inside old events are snapshots, not authoritative profiles.
      // Resolve all referenced members once per refresh, in bounded batches.
      const ids=referencedMemberIds(events);
      const memberNames=new Map();
      for(let start=0;start<ids.length;start+=100){
        const refs=ids.slice(start,start+100).map(uid=>db.collection('members').doc(uid));
        const members=await db.getAll(...refs);
        for(const member of members){
          const currentName=member.exists?member.data()?.name:null;
          if(typeof currentName==='string'&&currentName.trim()) memberNames.set(member.id,currentName);
        }
      }
      return {events:events.map(e=>hydrateEventNames(e,memberNames))};
    }
    case 'create': {
      const fields=cleanEvent(body.event);
      const ref=db.collection('events').doc();
      const e={...fields,id:ref.id,host:actor.name,hostId:actor.uid,
        participants:[{id:actor.uid,name:actor.name}],waitlist:[],status:'active',createdAt:stamp(),updatedAt:stamp()};
      await ref.create(copyForUpdate(e));return {event:e};
    }
    case 'update':return transactionEvent(db,body.id,actor,e=>{
      if(!isManager(actor,e))fail('只有主揪或管理員可以修改活動',403);
      if(e.status!=='active')fail('已取消的活動不能編輯');
      const fields=cleanEvent(body.event,e);
      if(fields.cap && fields.cap<e.participants.length)fail('名額小於報名人數');
      if(!fields.waitlistEnabled&&e.waitlist.length)fail('請先處理候補名單，才能關閉候補');
      return {...e,...fields};
    });
    case 'join':return transactionEvent(db,body.id,actor,e=>joinEvent(e,actor,body.prefs));
    case 'leave':return transactionEvent(db,body.id,actor,e=>leaveEvent(e,actor.uid));
    case 'prefs':return transactionEvent(db,body.id,actor,e=>setPrefs(e,actor.uid,body.prefs));
    case 'assign':return transactionEvent(db,body.id,actor,e=>{
      if(!isManager(actor,e))fail('只有主揪或管理員可以安排職業',403);
      return assignRole(e,body.playerId,body.role,body.job);
    });
    case 'cancel':return transactionEvent(db,body.id,actor,e=>{
      if(!isManager(actor,e))fail('只有主揪或管理員能取消活動',403);
      return {...e,status:'cancelled'};
    });
    case 'profile': {
      const profile=cleanProfile(body.profile);
      await db.collection('members').doc(actor.uid).update({...profile,updatedAt:stamp()});
      return {member:{...actor,...profile}};
    }
    case 'invite': {
      if(actor.role!=='admin')fail('只有管理員能邀請朋友',403);
      const email=cleanEmail(body.email);
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('請輸入正確的電子郵件');
      await db.collection('invites').doc(idForEmail(email)).set({email,active:true,invitedBy:actor.uid,updatedAt:stamp()},{merge:true});
      return {email};
    }
    case 'members': {
      if(actor.role!=='admin')fail('只有管理員可以查詢成員',403);
      const [m,i]=await Promise.all([db.collection('members').limit(150).get(),db.collection('invites').limit(150).get()]);
      return {members:m.docs.map(x=>({uid:x.id,...x.data()})),invites:i.docs.map(x=>x.data())};
    }
    case 'disableMember': {
      if(actor.role!=='admin')fail('只有管理員可以管理成員',403);
      if(body.uid===actor.uid)fail('不能停用自己的帳號');
      const uid=String(body.uid||'');
      if(!/^[a-zA-Z0-9_-]{6,150}$/.test(uid))fail('成員識別碼錯誤');
      const ref=db.collection('members').doc(uid);
      const snap=await ref.get();
      if(!snap.exists)fail('找不到成員');
      if(snap.data().role==='admin')fail('不能停用其他管理員');
      await ref.update({active:body.active===true,updatedAt:stamp()});
      return {uid,active:body.active===true};
    }
    default:fail('未知的操作',404);
  }
}
export async function POST(request){
  try{
    if(request.headers.get('content-type')?.split(';')[0]!=='application/json')fail('只接受 JSON 請求',415);
    const bodyText=await request.text();
    if(bodyText.length>25000)fail('資料過大',413);
    let body;
    try{body=JSON.parse(bodyText)}catch{fail('JSON 格式不正確')}
    if(!body||typeof body.action!=='string')fail('缺少操作名稱');
    const db=init();
    const id=await identity(request);
    const actor=await memberFor(db,id);
    return ok(await action(db,actor,body));
  }catch(err){
    if(!err.status)console.error('Startrail API error:',err);
    return ok({error:err.status?err.message:'伺服器處理失敗，請稍後再試'},err.status||500);
  }
}

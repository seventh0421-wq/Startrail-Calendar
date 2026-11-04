// One-time-code association: prove ownership of an invited Google account on
// the website AND control of a Discord account in a signed interaction.
// Never accept a Discord ID supplied by the browser.
import {randomBytes,createHash} from 'node:crypto';
import {fail} from './domain.js';

const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codeHash=value=>createHash('sha256').update(String(value||'').replace(/[-\s]/g,'').toUpperCase()).digest('hex');
const nowISO=()=>new Date().toISOString();
const memberRef=(db,uid)=>db.collection('members').doc(uid);
const links=db=>db.collection('discordLinks');
export const discordSnowflake=value=>/^\d{15,23}$/.test(String(value||''));

export function makeLinkCode(random=randomBytes){
  // 12 characters drawn from 32 symbols = 60 bits of entropy.
  const bytes=random(12);
  return Array.from(bytes,x=>ALPHABET[x&31]).join('').replace(/(.{4})(?=.)/g,'$1-');
}
export async function issueLinkCode(db,actor,{code=makeLinkCode(),clock=Date.now}={}){
  if(actor.discordId)fail('這個帳號已綁定 Discord；若要換帳號，請先解除綁定');
  const hash=codeHash(code), expiresAt=clock()+10*60*1000;
  const ref=db.collection('discordLinkCodes').doc(hash),member=memberRef(db,actor.uid);
  await db.runTransaction(async tx=>{
    const snap=await tx.get(member);
    if(!snap.exists||!snap.data().active||snap.data().email!==actor.email)fail('帳號已失效，請重新登入',403);
    if(snap.data().discordId)fail('已經綁定 Discord');
    tx.create(ref,{uid:actor.uid,expiresAt,createdAt:nowISO()});
    tx.update(member,{pendingDiscordCodeHash:hash,pendingDiscordCodeExpiresAt:expiresAt,updatedAt:nowISO()});
  });
  return {code,expiresAt};
}
export async function redeemLinkCode(db,rawCode,discordUser,{clock=Date.now}={}){
  const normalized=String(rawCode||'').replace(/[-\s]/g,'').toUpperCase();
  if(!/^[A-HJ-NP-Z2-9]{12}$/.test(normalized))fail('綁定碼格式不正確');
  if(!discordSnowflake(discordUser?.id))fail('無法驗證 Discord 帳號');
  const hash=codeHash(normalized),ref=db.collection('discordLinkCodes').doc(hash);
  const discordId=String(discordUser.id);
  const discordName=String(discordUser.global_name||discordUser.username||'Discord 好友').slice(0,50);
  return db.runTransaction(async tx=>{
    const codeSnap=await tx.get(ref);
    if(!codeSnap.exists)fail('綁定碼不存在或已使用，請回網站重新產生');
    const code=codeSnap.data(),member=memberRef(db,code.uid),linked=links(db).doc(discordId);
    const [memberSnap,linkedSnap]=await Promise.all([tx.get(member),tx.get(linked)]);
    if(!memberSnap.exists||!memberSnap.data().active)fail('會員已停用',403);
    const m=memberSnap.data();
    if(code.expiresAt<=clock()||m.pendingDiscordCodeHash!==hash||m.pendingDiscordCodeExpiresAt!==code.expiresAt)fail('綁定碼已過期，請重新產生');
    if(linkedSnap.exists&&linkedSnap.data().uid!==code.uid)fail('此 Discord 帳號已與其他會員綁定');
    if(m.discordId&&m.discordId!==discordId)fail('Google 帳號已綁定其他 Discord，請先至網站解除');
    tx.set(linked,{uid:code.uid,linkedAt:nowISO(),discordName});
    tx.update(member,{discordId,discordName,pendingDiscordCodeHash:null,pendingDiscordCodeExpiresAt:null,updatedAt:nowISO()});
    tx.delete(ref);
    return {name:m.name||'冒險者',discordName};
  });
}
export async function unlinkDiscord(db,actor){
  const member=memberRef(db,actor.uid);
  await db.runTransaction(async tx=>{
    const snap=await tx.get(member);
    if(!snap.exists||!snap.data().active)fail('會員不存在',403);
    const discordId=snap.data().discordId;
    const link=discordSnowflake(discordId)?links(db).doc(discordId):null;
    const linked=link?await tx.get(link):null;
    if(linked?.exists&&linked.data().uid===actor.uid)tx.delete(link);
    tx.update(member,{discordId:null,discordName:null,pendingDiscordCodeHash:null,pendingDiscordCodeExpiresAt:null,updatedAt:nowISO()});
  });
  return {discordId:null,discordName:null};
}
export async function resolveDiscordMember(db,discordId){
  if(!discordSnowflake(discordId))return null;
  const link=await links(db).doc(discordId).get();
  if(!link.exists)return null;
  const uid=link.data().uid;
  if(typeof uid!=='string')return null;
  const member=await memberRef(db,uid).get();
  if(!member.exists)return null;
  const m=member.data();
  return m.active&&m.discordId===discordId?{uid,...m}:null;
}

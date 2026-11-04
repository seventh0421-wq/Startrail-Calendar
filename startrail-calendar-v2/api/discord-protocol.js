// Pure, testable Discord interaction protocol helpers.
import {createPublicKey,verify as verifySignature} from 'node:crypto';

const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export const ephemeral=content=>({type:4,data:{content,flags:64,allowed_mentions:{parse:[]}}});
export const deferEphemeral=()=>({type:5,data:{flags:64}});
export function verifyDiscordRequest(body,signature,timestamp,publicKey,{now=Date.now}={}){
  try{
    if(!/^[a-fA-F0-9]{128}$/.test(signature||'')||!/^[a-fA-F0-9]{64}$/.test(publicKey||'')||!/^\d{10,13}$/.test(timestamp||''))return false;
    const ts=Number(timestamp)*1000;
    if(!Number.isFinite(ts)||Math.abs(now()-ts)>5*60*1000)return false;
    const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(publicKey,'hex')]),format:'der',type:'spki'});
    return verifySignature(null,Buffer.from(timestamp+body,'utf8'),key,Buffer.from(signature,'hex'));
  }catch{return false;}
}
export function roleModal(eventId,mode='join'){
  const input=(name,label)=>({type:1,components:[{type:4,custom_id:name,style:1,label,required:false,max_length:150,placeholder:'可輸入多個職業，以頓號或逗號分隔'}]});
  return {type:9,data:{custom_id:`st:role:${mode}:${eventId}`,title:mode==='edit'?'修改可打職業':'副本報名｜可打職業',components:[input('tank','🛡️ 坦克（可留空）'),input('healer','💚 補師（可留空）'),input('dps','⚔️ 輸出（可留空）')]}};
}
export function linkModal(){return {type:9,data:{custom_id:'st:link-submit',title:'綁定星旅日誌帳號',components:[{type:1,components:[{type:4,custom_id:'code',style:1,label:'網站個人頁的一次性綁定碼',required:true,min_length:12,max_length:16,placeholder:'XXXX-XXXX-XXXX'}]}]}};}
export function modalValues(components){const out={};for(const row of components||[])for(const input of row.components||[])if(typeof input.custom_id==='string')out[input.custom_id]=String(input.value||'').trim();return out;}
export function parseAction(customId){
  if(customId==='st:link')return {kind:'link-modal'};
  if(customId==='st:link-submit')return {kind:'link-submit'};
  const m=String(customId||'').match(/^st:(join|leave|edit):([bn]):([A-Za-z0-9_-]{6,78})$/);
  if(m)return {kind:m[1],battle:m[2]==='b',id:m[3]};
  const modal=String(customId||'').match(/^st:role:(join|edit):([A-Za-z0-9_-]{6,78})$/);
  if(modal)return {kind:modal[1]==='join'?'join-roles':'edit-roles',id:modal[2]};
  return null;
}
export {json};

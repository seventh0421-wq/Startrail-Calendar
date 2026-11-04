// Discord HTTP interactions endpoint. Public network entry-point: verify every
// signature before trusting the Discord user ID or any custom_id.
import {waitUntil} from '@vercel/functions';
import {init,transactionEvent} from './route.js';
import {joinEvent,leaveEvent,setPrefs,fail} from './domain.js';
import {redeemLinkCode,resolveDiscordMember} from './discord-link.js';
import {syncAnnouncement,siteOrigin} from './discord.js';
import {modalValues} from './discord-protocol.js';
import {handleDiscordHTTP} from './discord-handler-core.js';

function senderId(interaction){return String(interaction.member?.user?.id||interaction.user?.id||'');}
async function updatePrivateReply(interaction,message,fetcher=fetch){
  const url=`https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
  const result=await fetcher(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:message,allowed_mentions:{parse:[]}}),signal:AbortSignal.timeout(7000)});
  if(!result.ok)throw new Error(`Discord 回覆 HTTP ${result.status}`);
}
function roleInput(interaction){
  const values=modalValues(interaction.data?.components);
  const prefs=Object.fromEntries(['tank','healer','dps'].filter(role=>values[role]).map(role=>[role,values[role]]));
  return prefs;
}
async function processAction(interaction,parsed,origin,{database=init(),fetcher=fetch}={}){
  let message='操作已完成。',syncId=null;
  try{
    if(parsed.kind==='link-submit'){
      const {code}=modalValues(interaction.data?.components);
      const result=await redeemLinkCode(database,code,interaction.member?.user||interaction.user);
      message=`☁️ 庫啵！綁定成功！歡迎 ${result.name}，現在可以直接在這裡 +1 報名了。`;
    }else{
      const actor=await resolveDiscordMember(database,senderId(interaction));
      if(!actor){
        message='🔗 你還沒綁定《星旅日誌》帳號。先到網站「個人」頁產生一次性綁定碼，再點活動公告的「綁定帳號」按鈕輸入。';
      }else{
        const {id,kind}=parsed;
        const change=await transactionEvent(database,id,actor,event=>{
          if(kind==='join'||kind==='join-roles')return joinEvent(event,actor,kind==='join-roles'?roleInput(interaction):null);
          if(kind==='leave')return leaveEvent(event,actor.uid);
          if(kind==='edit-roles')return setPrefs(event,actor.uid,roleInput(interaction));
          fail('不支援的報名操作');
        });
        syncId=id;
        if(kind==='leave')message='✅ 已取消 +1／候補，網站名單也會跟著更新。';
        else if(kind==='edit-roles')message='✅ 已更新可打位置與職業！主揪的正式排位不會自動改動。';
        else message=change.result==='wait'?'🕒 已加入候補名單！你只會占一個候補位置。':'✅ +1 報名成功！即使填寫三種位置，也只算一個人。';
      }
    }
  }catch(error){
    console.error('Startrail Discord action:',error.status||error.name||'error');
    message=`⚠ ${error.status?error.message:'莫古力暫時無法完成操作，請稍後重試或到網站報名。'}`;
  }
  try{await updatePrivateReply(interaction,message,fetcher)}catch(error){console.error('Startrail Discord private reply:',error.message)}
  if(syncId){
    try{await syncAnnouncement(database,syncId,origin,{fetcher})}catch(error){console.error('Startrail announcement resync:',error.message)}
  }
}

export async function POST(request){
  return handleDiscordHTTP(request,{
    schedule:waitUntil,
    origin:siteOrigin(request.url),
    process:(interaction,parsed,origin)=>processAction(interaction,parsed,origin)
      .catch(error=>console.error('Startrail Discord background:',error.message))
  });
}

// Injectable HTTP entry logic for signed Discord requests. Keeps the public
// security boundary unit-testable without deploying or requiring credentials.
import {verifyDiscordRequest,ephemeral,deferEphemeral,roleModal,linkModal,parseAction,json} from './discord-protocol.js';
export async function handleDiscordHTTP(request,{env=process.env,schedule,process:processAction,origin}={}){
  try{
    const raw=await request.text();
    if(raw.length>30000)return new Response('too large',{status:413});
    if(!env.DISCORD_PUBLIC_KEY)return new Response('Discord public key not configured',{status:503});
    const verified=verifyDiscordRequest(raw,request.headers.get('x-signature-ed25519'),request.headers.get('x-signature-timestamp'),env.DISCORD_PUBLIC_KEY);
    if(!verified)return new Response('invalid request signature',{status:401});
    let interaction;
    try{interaction=JSON.parse(raw)}catch{return new Response('invalid JSON',{status:400})}
    if(interaction.type===1)return json({type:1});
    if(env.DISCORD_CLIENT_ID&&interaction.application_id!==env.DISCORD_CLIENT_ID)return new Response('wrong application',{status:403});
    if(!['3','5'].includes(String(interaction.type)))return json(ephemeral('這個互動尚未支援。'));
    if(interaction.channel_id!==env.DISCORD_CHANNEL_ID)return json(ephemeral('請從星旅活動公告頻道操作。'));
    const parsed=parseAction(interaction.data?.custom_id);
    if(!parsed)return json(ephemeral('按鈕已失效，請使用最新活動公告。'));
    if(parsed.kind==='link-modal')return json(linkModal());
    if(interaction.type===3&&parsed.kind==='join'&&parsed.battle)return json(roleModal(parsed.id,'join'));
    if(interaction.type===3&&parsed.kind==='edit'&&parsed.battle)return json(roleModal(parsed.id,'edit'));
    // Process only in the Vercel waitUntil lifecycle, and immediately ACK with
    // an ephemeral defer to satisfy Discord's three-second interaction window.
    schedule(Promise.resolve().then(()=>processAction(interaction,parsed,origin)));
    return json(deferEphemeral());
  }catch(error){
    console.error('Startrail Discord endpoint:',error.message);
    return new Response('interaction failed',{status:500});
  }
}

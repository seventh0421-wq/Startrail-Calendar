// Domain checks have no Firebase dependency and are unit-testable.
export const TEMPLATE = Object.freeze({
  4: {tank: 1, healer: 1, dps: 2},
  8: {tank: 2, healer: 2, dps: 4},
  24: {tank: 3, healer: 6, dps: 15}
});
export const ROLES = ['tank','healer','dps'];
const cats = ['battle','explore','photo','rp','other'];
export function fail(message, status=400) {const e = new Error(message); e.status=status; throw e;}
export function str(v,max=100) {return typeof v==='string'?v.trim().slice(0,max):'';}
export function requireText(v,max=100,label='文字') {
  if (typeof v!=='string'||!v.trim()||v.trim().length>max) fail(`${label}需要填寫，且不得超過 ${max} 個字`);
  return v.trim();
}
export function cleanEmail(email) {return str(email,254).toLowerCase();}
export function cleanProfile(v) {
  return {name:requireText(v?.name,25,'角色暱稱'), avatar:['🌙','✨','🦊','⭐','🌸'].includes(v?.avatar)?v.avatar:'🌙'};
}
// All event date/time strings are wall-clock time in Asia/Taipei (UTC+8).
// We store an explicit endDate so an overnight event is unambiguous in the
// calendar, Discord announcement and API; old events without endDate still work.
const isValidDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
  && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;
const isValidTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function addCalendarDays(date, days=1) {
  const d=new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}
export function effectiveEndDate(event) {
  if(!event.end)return event.date;
  // Legacy records have no endDate and could only be same-day events.
  return isValidDate(event.endDate)?event.endDate:(event.end<event.time?addCalendarDays(event.date):event.date);
}
export function scheduleText(event) {
  const beginning=`${event.date} ${event.time}`;
  if(!event.end)return beginning;
  const ending=effectiveEndDate(event);
  return ending===event.date?`${beginning}–${event.end}`:`${beginning} → ${ending} ${event.end}`;
}
export function cleanEvent(v, previous=null) {
  const title=requireText(v?.title,55,'活動名稱');
  const date=str(v?.date,10),time=str(v?.time,5),end=str(v?.end,5);
  const submittedEndDate=str(v?.endDate,10);
  if(!isValidDate(date))fail('日期格式錯誤');
  if(!isValidTime(time))fail('開始時間格式錯誤（請使用 24 小時制）');
  if(end&&!isValidTime(end))fail('結束時間格式錯誤（請使用 24 小時制）');
  if(!end&&submittedEndDate)fail('請先填寫結束時間，再設定結束日期');
  if(submittedEndDate&&!isValidDate(submittedEndDate))fail('結束日期格式錯誤');
  // No specified end date: an earlier end clock implies *next day*.
  // Equal clock times are ambiguous: require an explicit following date.
  if(end&&!submittedEndDate&&end===time)fail('結束時間與開始時間相同；如需跨日，請手動指定結束日期');
  const endDate=end?(submittedEndDate||(end<time?addCalendarDays(date):date)):'';
  if(end&&`${endDate}T${end}`<=`${date}T${time}`)fail('結束日期與時間必須晚於開始時間');
  const endDateManual=Boolean(end&&submittedEndDate);
  const cap=Number(v?.cap);
  if(![0,4,6,8,24].includes(cap))fail('參加人數設定錯誤');
  if(previous && cap && previous.participants.length>cap)fail('新名額不能少於已報名人數');
  const category=cats.includes(v?.category)?v.category:'other';
  return {title,date,time,end,endDate,endDateManual,cap,category,
    location:str(v?.location,100),description:str(v?.description,1500),
    roleEnabled:category==='battle'&&v?.roleEnabled===true,
    waitlistEnabled:v?.waitlistEnabled===true};
}
export function roleJobs(text) {
  return [...new Set(String(text||'').split(/[、，,／/;；\n]+/).map(x=>x.trim()).filter(Boolean))];
}
export function cleanPrefs(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))fail('請選擇可打位置');
  const prefs={};
  for(const role of ROLES){
    if(Object.prototype.hasOwnProperty.call(value,role)){
      let job=requireText(value[role],150,'職業');
      if(roleJobs(job).length>12)fail('每個位置最多填寫 12 個職業');
      prefs[role]=job;
    }
  }
  if(!Object.keys(prefs).length)fail('請至少選一個可打位置');
  if(Object.keys(value).some(k=>!ROLES.includes(k)))fail('位置資料不正確');
  return prefs;
}
export function joinEvent(e, member, prefs) {
  if(e.status!=='active')fail('活動已取消');
  if([...e.participants,...e.waitlist].some(p=>p.id===member.uid)) fail('你已報名這場活動');
  const participant={id:member.uid,name:member.name};
  if(e.roleEnabled) participant.rolePreferences=cleanPrefs(prefs);
  const copy=structuredClone(e);
  if(copy.cap>0&&copy.participants.length>=copy.cap){
    if(!copy.waitlistEnabled)fail('活動已額滿');
    if(copy.waitlist.length>=100)fail('候補名單已滿');
    copy.waitlist.push(participant);
    return {event:copy,result:'wait'};
  }
  if(copy.participants.length>=100)fail('活動參加名單已達上限');
  copy.participants.push(participant);
  return {event:copy,result:'joined'};
}
export function leaveEvent(e, uid) {
  if(e.hostId===uid)fail('主揪預設參團，不能直接退出；請取消活動或修改活動',403);
  const copy=structuredClone(e);
  const before=copy.participants.length, beforeWait=copy.waitlist.length;
  copy.participants=copy.participants.filter(p=>p.id!==uid);
  copy.waitlist=copy.waitlist.filter(p=>p.id!==uid);
  if(before===copy.participants.length&&beforeWait===copy.waitlist.length)fail('你尚未報名');
  let promoted=null;
  if(before!==copy.participants.length&&copy.status==='active'&&copy.waitlistEnabled&&copy.waitlist.length&&(!copy.cap||copy.participants.length<copy.cap)){
    promoted=copy.waitlist.shift();copy.participants.push(promoted);
  }
  return {event:copy,promoted};
}
export function setPrefs(e, uid, prefs) {
  if(!e.roleEnabled)fail('這場活動沒有開啟職業志願');
  const copy=structuredClone(e);
  const p=[...copy.participants,...copy.waitlist].find(x=>x.id===uid);
  if(!p)fail('你尚未報名');
  p.rolePreferences=cleanPrefs(prefs);
  if(p.assignment&&(!p.rolePreferences[p.assignment.role]||!roleJobs(p.rolePreferences[p.assignment.role]).includes(p.assignment.job))){p.assignment=null;}
  return copy;
}
export function assignRole(e, playerId, role, job) {
  if(!e.roleEnabled)fail('這場活動沒有開啟職業分配');
  const copy=structuredClone(e);
  const p=copy.participants.find(x=>x.id===playerId);
  if(!p)fail('玩家不在正式參加名單');
  if(!role){p.assignment=null;return copy;}
  if(!ROLES.includes(role))fail('未知的位置');
  if(!p.rolePreferences?.[role])fail('玩家沒有勾選該位置');
  if(!roleJobs(p.rolePreferences[role]).includes(job))fail('職業不在玩家的自填職業清單');
  const plan=TEMPLATE[copy.cap];
  if(plan && copy.participants.filter(x=>x.id!==p.id&&x.assignment?.role===role).length>=plan[role]) fail('這個位置已經排滿');
  p.assignment={role,job};return copy;
}
// Event records keep historical name snapshots for compatibility. The member profile
// is the authoritative display name; hydrate names at read time so renames appear
// for hosts, participants, waitlist and copied Discord text without rewriting events.
export function referencedMemberIds(events) {
  const ids = new Set();
  for (const e of events) {
    if (typeof e.hostId === 'string' && e.hostId) ids.add(e.hostId);
    for (const p of [...(e.participants || []), ...(e.waitlist || [])]) {
      if (typeof p.id === 'string' && p.id) ids.add(p.id);
    }
  }
  return [...ids];
}
export function hydrateEventNames(event, memberNames) {
  const nameFor = (uid, fallback) => memberNames.get(uid) || fallback;
  return {
    ...event,
    host: nameFor(event.hostId, event.host),
    participants: (event.participants || []).map(p => ({...p, name: nameFor(p.id, p.name)})),
    waitlist: (event.waitlist || []).map(p => ({...p, name: nameFor(p.id, p.name)}))
  };
}
export function copyForUpdate(e){const copy=structuredClone(e);delete copy.id;return copy;}

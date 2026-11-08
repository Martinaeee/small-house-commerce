"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import { copyText } from "@/lib/clipboard";
import { canManageMarketingPage, marketingApi, type CampaignLinkRow, type CampaignLinkQuery } from "@/lib/marketing-api";
import { EditPostDialog } from "./EditPostDialog";
import { SourceSections } from "./SourceSections";

const buttonClass="rounded-md border border-admin-border px-2 py-1.5 text-xs disabled:opacity-40";
export function ProductPostsDrawer({ productId, productName, filters, onClose, onChanged, onCreate, onClone }: {
 productId: string; productName: string; filters: CampaignLinkQuery;
 onClose: () => void; onChanged: () => void; onCreate: () => void; onClone: (row: CampaignLinkRow) => void;
}) {
 const {admin}=useAdminAuth(); const {t}=useAdminI18n();
 const [page,setPage]=useState(1),[revision,setRevision]=useState(0);
 const [loaded,setLoaded]=useState<{key:string;items:CampaignLinkRow[];total:number}|null>(null);
 const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[editing,setEditing]=useState<CampaignLinkRow|null>(null);
 const [copied,setCopied]=useState<{url:string;ok:boolean}|null>(null);
 const [adidNotice,setAdidNotice]=useState<string|null>(null);
 const panel=useRef<HTMLElement>(null),operation=useRef(false),closeRef=useRef(onClose);
 useEffect(()=>{closeRef.current=onClose;});
 const filterKey=JSON.stringify(filters),key=JSON.stringify([productId,filterKey,page,revision,admin?.id]);
 useEffect(()=>{
  let alive=true;
  const query:CampaignLinkQuery=JSON.parse(filterKey);
  marketingApi.listLinks({...query,productId,page,pageSize:100,orderBy:"POST_DATE_DESC"}).then(result=>{if(alive){setLoaded({key,...result});setError(null);}}).catch(reason=>{if(alive)setError(String(reason instanceof Error?reason.message:reason));});
  return()=>{alive=false;};
 },[key,filterKey,productId,page]);
 useEffect(()=>{
  if(editing)return;
  const trigger=document.activeElement as HTMLElement|null,previous=document.body.style.overflow;
  document.body.style.overflow="hidden"; panel.current?.focus();
  function keydown(e:KeyboardEvent){
   if(e.key==="Escape"){e.stopPropagation();closeRef.current();}
   if(e.key!=="Tab")return;
   const nodes=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select')??[]).filter(el=>el.offsetParent!==null);
   const first=nodes[0],last=nodes.at(-1);if(!first){e.preventDefault();return;}
   if(e.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){e.preventDefault();last?.focus();}
   else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===panel.current)){e.preventDefault();first.focus();}
  }
  document.addEventListener("keydown",keydown);
  return()=>{document.removeEventListener("keydown",keydown);document.body.style.overflow=previous;trigger?.focus();};
 },[editing]);
 async function mutate(row:CampaignLinkRow,action:"archive"|"unarchive"|"disable"){
  if(operation.current||!canManageMarketingPage(admin,row.ownerUserId))return;
  const message=action==="archive"?"marketing_post_archive_confirm":action==="unarchive"?"marketing_post_unarchive_confirm":"marketing_link_disable_confirm";
  if(!window.confirm(t(message)))return;
  operation.current=true;setBusy(true);setError(null);
  try{if(action==="archive")await marketingApi.archiveLink(row.id,row.version);else if(action==="unarchive")await marketingApi.unarchiveLink(row.id,row.version);else await marketingApi.disableLink(row.id,row.version);setRevision(v=>v+1);onChanged();}
  catch(e){setError(e instanceof AdminApiError&&e.status===409?t("marketing_post_conflict"):e instanceof Error?e.message:String(e));}
  finally{operation.current=false;setBusy(false);}
 }
 async function copy(row:CampaignLinkRow){
  let url=new URL(row.path,window.location.origin).href;
  if(row.attributionMode==="CL"){try{url=new URL((await marketingApi.createShortLink({url:row.path})).path,window.location.origin).href;}catch{/* full URL remains available */}}
  let ok=false;try{ok=await copyText(url);}catch{/* selectable fallback */}setCopied({url,ok});
 }
 async function copyAdid(adid:string){
  let ok=false;try{ok=await copyText(adid);}catch{/* the number stays selectable */}setAdidNotice(t(ok?"link_builder_copied":"common_copy_failed_manual"));
 }
 const data=loaded?.key===key?loaded:null;
 if(editing)return <EditPostDialog link={editing} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);setRevision(v=>v+1);onChanged();}}/>;
 const canCreate=Boolean(admin?.permissions.some(p=>p==="MARKETING_MANAGE_ALL"||p==="MARKETING_MANAGE_OWN"));
 return <div className="fixed inset-0 z-50 bg-black/30" onClick={e=>{if(e.target===e.currentTarget&&!busy)onClose();}}>
  <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t("marketing_post_drawer_title")} className="ml-auto flex h-dvh w-full max-w-5xl flex-col bg-white shadow-xl outline-none">
   <header className="flex flex-wrap items-center justify-between gap-3 border-b border-admin-border p-4"><div><h2 className="font-semibold">{productName}</h2><p className="text-xs text-admin-muted">{t("marketing_post_drawer_note")}</p></div><div className="flex gap-2">{canCreate&&<button type="button" className={buttonClass} disabled={busy} onClick={onCreate}>{t("marketing_post_add")}</button>}<button type="button" disabled={busy} className={buttonClass} onClick={onClose}>{t("common_close")}</button></div></header>
   {error&&<p role="alert" className="p-3 text-sm text-red-700">{error}</p>}
   {copied&&<div className="space-y-1 p-3 text-sm"><p role="status">{t(copied.ok?"link_builder_copied":"common_copy_failed_manual")}</p><input aria-label={t("marketing_link_url")} readOnly value={copied.url} onFocus={e=>e.currentTarget.select()} className="w-full rounded border p-2 text-xs"/></div>}
   {adidNotice&&<p role="status" className="px-3 pt-3 text-sm">{adidNotice}</p>}
   <div className="min-h-0 flex-1 overflow-y-auto p-3">
    {!data&&!error&&<p>{t("common_loading")}</p>}
    {data&&<SourceSections rows={data.items} renderRow={row=>{const manage=canManageMarketingPage(admin,row.ownerUserId);return <article key={row.id} className="flex flex-col gap-2 border-t border-admin-border px-3 py-4 md:flex-row md:items-start md:gap-4">
     <div className="text-sm md:w-32 md:shrink-0">{row.postDate??(row.sourceType==="FB_POST"?t("marketing_post_unregistered"):"—")}</div>
     <div className="min-w-0 flex-1"><p className="break-words font-medium">{row.name}</p><p className="mt-1 text-xs text-admin-muted">{row.ownerName} · {row.aid} · {t(row.status==="ACTIVE"?"marketing_link_active":"marketing_status_DISABLED")}{row.archivedAt&&<span className="ml-2 text-amber-800">{t("marketing_post_archived")}</span>}{row.postUrl&&<a className="ml-2 underline" href={row.postUrl} target="_blank" rel="noopener noreferrer">{t("marketing_post_original")}</a>}</p>{row.adid&&<p className="mt-1 break-words text-xs text-admin-muted">{t("marketing_link_adid")}: <span className="font-mono text-ink">{row.adid}</span></p>}</div>
     <div className="flex flex-wrap content-start gap-1 md:w-[21rem] md:shrink-0 md:justify-end"><button type="button" className={buttonClass} onClick={()=>void copy(row)}>{t("marketing_link_copy_url")}</button>{row.adid&&<button type="button" className={buttonClass} onClick={()=>void copyAdid(row.adid!)}>{t("marketing_link_copy_adid")}</button>}{row.attributionMode==="AID"&&<button type="button" className={buttonClass} onClick={()=>void copyAdid(row.metaUrlParameters)}>{t("link_builder_copy_meta_parameters")}</button>}{row.attributionMode==="AID"?<span className="self-center text-xs text-admin-muted">{t("marketing_aid_report_pending")}</span>:<><Link className={buttonClass} href={`/admin/marketing/reports?${new URLSearchParams({productId:row.productId,linkId:row.id})}`}>{t("marketing_reports")}</Link><Link className={buttonClass} href={`/admin/marketing/costs?${new URLSearchParams({productId:row.productId,linkId:row.id})}`}>{t("marketing_costs")}</Link></>}{manage&&<><button type="button" className={buttonClass} disabled={busy} onClick={()=>setEditing(row)}>{t("marketing_post_edit")}</button><button type="button" className={buttonClass} disabled={busy} onClick={()=>onClone(row)}>{t("marketing_link_clone")}</button><button type="button" className={buttonClass} disabled={busy} onClick={()=>void mutate(row,row.archivedAt?"unarchive":"archive")}>{t(row.archivedAt?"marketing_post_unarchive":"marketing_post_archive")}</button>{row.status==="ACTIVE"&&<button type="button" className={buttonClass} disabled={busy} onClick={()=>void mutate(row,"disable")}>{t("marketing_disable")}</button>}</>}</div>
    </article>;}}/>}
    {data&&!data.items.length&&<p className="p-4 text-sm text-admin-muted">{t("marketing_links_empty")}</p>}
   </div>
   {data&&<footer className="flex items-center justify-between border-t p-3 text-xs"><span>{t("marketing_post_count",{count:String(data.total)})}</span>{data.total>100&&<div className="flex items-center gap-2"><button type="button" className={buttonClass} disabled={page===1||busy} onClick={()=>setPage(v=>v-1)}>{t("marketing_previous")}</button><span>{page}</span><button type="button" className={buttonClass} disabled={page*100>=data.total||busy} onClick={()=>setPage(v=>v+1)}>{t("marketing_next")}</button></div>}</footer>}
  </section>
 </div>;
}

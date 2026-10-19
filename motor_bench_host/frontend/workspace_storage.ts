export function loadLibrary(key: string, parse: (text:string)=>any) {
  try {
    const raw=JSON.parse(localStorage.getItem(key)??'[]');
    if(!Array.isArray(raw)||raw.length>20)throw Error('invalid');
    return {items:raw.map(item=>parse(JSON.stringify(item))),warning:''};
  } catch {return {items:[] as any[],warning:'本地模板库损坏或不可用，已回退空列表；原存储未覆盖'};}
}
export function saveLibrary(key:string,items:unknown[]) {
  if(items.length>20)throw Error('本地模板最多20个，请先删除不用的模板');
  try{localStorage.setItem(key,JSON.stringify(items));}catch{throw Error('浏览器存储不可用或容量不足，请导出文件保存');}
}
export function downloadFile(filename:string,text:string,type='application/json') {
  const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function readFile(event:Event,maxBytes=100000) {
  const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file)return '';
  input.value='';if(file.size>maxBytes)throw Error(`文件超过 ${Math.round(maxBytes/1000)} KB 上限`);return file.text();
}
export function waitUntil(predicate:()=>boolean,timeoutMs=3500) {
  return new Promise<void>((resolve,reject)=>{const started=Date.now();const check=()=>{if(predicate()){resolve();return;}if(Date.now()-started>timeoutMs){reject(Error('等待板端确认超时，应用已中止，请核对部分已生效的配置'));return;}setTimeout(check,50);};check();});
}

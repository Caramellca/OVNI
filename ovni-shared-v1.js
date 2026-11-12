/* OVNI shared UI v1.0.0: site and userscript. */
(() => {
'use strict';
const BLACK_MARKET_ORDER=['defi-titans','pack-nyx','pack-harmonie','pack-hera','boite-pandore','pomme-or','toison-or','tyche-crown','5th-element','pierre-philosophale','bras-morphee','sablier-chronos','fragment-nuage','baton-fertilite','eclair-zeus','corne-abondance','sang-meduse','rayon-helios','larmes-aphrodite','eau-jouvence','pomme-vintage','orchidee-noire','talon-achille','caresse-philotes','lyre-apollon','fleche-artemis','parchemin-ploutos','couverture-hypnos'];
const itemKey=(item,catalog)=>String(catalog.get(item.itemId)?.identifier||item.itemId||'').toLowerCase();
const heliosFamily=key=>key==='rayon-helios-ow'?'rayon-helios':key;
const marketRank=key=>{const i=BLACK_MARKET_ORDER.indexOf(heliosFamily(key));return i<0?10000:i;};
function equipmentFamily(key){if(key.startsWith('bonnet-'))return'bonnet';if(key.startsWith('tapis-'))return'tapis';if(key.startsWith('bande-'))return'bande';if(key.startsWith('selle-'))return'selle';if(key.startsWith('bride-'))return'bride';return'other';}
function layoutBlocks(groupId,entries,catalog){const keyOf=e=>itemKey(e.item,catalog),labelOf=e=>String(catalog.get(e.item.itemId)?.name||e.item.itemId||'');const bonusFirst=['pack-poseidon','pack-bonus','pactole-cresus'],bonusOrder=['main','crampons','eperons','longe','cloches','cravache'],equipOrder=['bonnet','tapis','bande','selle','bride','other'];function compareItems(a,b){const ka=keyOf(a),kb=keyOf(b);if(groupId==='black-market'){const d=marketRank(ka)-marketRank(kb);if(d)return d;if(heliosFamily(ka)==='rayon-helios'&&heliosFamily(kb)==='rayon-helios'){const d2=(ka==='rayon-helios'?0:1)-(kb==='rayon-helios'?0:1);if(d2)return d2;}}if(groupId==='bonuses'){const ia=bonusFirst.indexOf(ka),ib=bonusFirst.indexOf(kb);if(ia>=0||ib>=0){const d=(ia<0?999:ia)-(ib<0?999:ib);if(d)return d;}}return labelOf(a).localeCompare(labelOf(b),'ru')||ka.localeCompare(kb)||String(a.item.itemId).localeCompare(String(b.item.itemId))||a.position-b.position;}
const buckets=new Map();for(const e of entries){const k=keyOf(e);let block;if(groupId==='black-market')block=heliosFamily(k);else if(groupId==='equipment')block=equipmentFamily(k);else if(groupId==='bonuses')block=bonusFirst.includes(k)?'main':k;else if(groupId==='agriculture'||groupId==='check-list')block=k;else block='all';if(!buckets.has(block))buckets.set(block,[]);buckets.get(block).push(e);}for(const list of buckets.values())list.sort(compareItems);if(groupId==='black-market'){const singles=[],repeat=[];for(const[key,list]of buckets){if(list.length===1)singles.push(...list);else repeat.push({key,entries:list});}singles.sort(compareItems);repeat.sort((a,b)=>marketRank(a.key)-marketRank(b.key)||compareItems(a.entries[0],b.entries[0]));return[...(singles.length?[{key:'unique',entries:singles}]:[]),...repeat];}const blocks=[...buckets].map(([key,entries])=>({key,entries}));function blockRank(key){if(groupId==='equipment')return equipOrder.indexOf(key);if(groupId==='bonuses'){const i=bonusOrder.indexOf(key);return i<0?999:i;}if(groupId==='agriculture')return key==='graines-pass'?0:1;if(groupId==='check-list')return key==='cadeau'?0:key==='none'?1:2;return 0;}blocks.sort((a,b)=>blockRank(a.key)-blockRank(b.key)||compareItems(a.entries[0],b.entries[0]));return blocks;}
function hiddenEquipment1x(item,sourceSection,catalog){const entry=catalog.get(item.itemId);const group=entry?.groupId||sourceSection;if(group!=='equipment')return false;const identifiers=[entry?.identifier,item.itemId].filter(Boolean).map(v=>String(v).toLowerCase());return identifiers.some(id=>/(^|-)1x(?=-|$)/.test(id));}
function publicCardVisible(item,sourceSection,catalog){if(!item.itemId||item.inactive===true)return false;const entry=catalog.get(item.itemId);if(!entry)return false;const group=entry.groupId||sourceSection;if(group==='check-list')return false;if(group==='agriculture'&&itemKey(item,catalog)!=='graines-pass')return false;if(hiddenEquipment1x(item,sourceSection,catalog))return false;return true;}
function localImageUrls(entry,fallbackId,base="images/60/",pageBase=document.baseURI){const ids=[];if(entry?.img){try{const name=decodeURIComponent(new URL(entry.img,pageBase).pathname.split('/').pop());if(/\.png$/i.test(name))ids.push(name.replace(/\.png$/i,''));}catch{}}ids.push(entry?.identifier,fallbackId);return [...new Set(ids.filter(Boolean).map(String).filter(id=>/^[A-Za-z0-9_-]+$/.test(id)))].map(id=>`${base}${id}.png`);}
function decodeFirestoreValue(value){if('nullValue'in value)return null;if('booleanValue'in value)return value.booleanValue;if('integerValue'in value)return Number(value.integerValue);if('doubleValue'in value)return Number(value.doubleValue);if('stringValue'in value)return value.stringValue;if('timestampValue'in value)return value.timestampValue;if('arrayValue'in value)return (value.arrayValue.values||[]).map(decodeFirestoreValue);if('mapValue'in value)return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([k,v])=>[k,decodeFirestoreValue(v)]));throw {code:'invalid-rest-data'};}
function decodeFirestoreDocument(document){return Object.fromEntries(Object.entries(document.fields||{}).map(([key,value])=>[key,decodeFirestoreValue(value)]));}
function createNewsUI(container,driver,options={}) {
  const READ_KEY=options.readKey||'ovni-news-read-v2';
  let records=[],read=new Set(),admin=false,view='list',selected=null,draft=null,busy=false,loaded=false,dirty=false,loadSequence=0;
  let unsubscribeNews=null;
  const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  container.classList.add('nui');
  const status=node('div','nu-status');status.setAttribute('role','status');status.hidden=true;
  const area=node('div');container.replaceChildren(status,area);
  const types=[['paragraph','Абзац'],['heading','Подзаголовок'],['image','Картинка'],['warning','Предупреждение'],['list','Нумерованный список'],['fine','Серая подпись']];
  function message(text='',error=false){status.textContent=text;status.hidden=!text;status.classList.toggle('nu-error',error);}
  function readLocal(){try{const value=JSON.parse(localStorage.getItem(READ_KEY)||'[]');if(Array.isArray(value))read=new Set(value.filter(x=>typeof x==='string'));}catch{}}
  function saveLocal(){try{localStorage.setItem(READ_KEY,JSON.stringify([...read]));}catch{}}
  function badge(){options.onUnread?.(records.filter(n=>n.published&&!read.has(n.id)).length);}
  function dateText(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return '';
    const [year,month,day]=value.split('-').map(Number);
    const parts=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).formatToParts(new Date(year,month-1,day));
    const part=type=>parts.find(p=>p.type===type)?.value||'';
    return `${part('day')} ${part('month')} ${part('year')}`;
  }
  function safeURL(raw,image=false){try{const u=new URL(String(raw||'').trim(),options.siteBase||document.baseURI);if(u.protocol!=='https:')return null;if(image&&u.origin!==new URL(options.siteBase||document.baseURI).origin)return null;return u.href;}catch{return null;}}
  function rich(parent,text){const value=String(text||''),rx=/\[([^\]\n]+)\]\(([^\s)]+)\)/g;let pos=0,match;while((match=rx.exec(value))){parent.append(document.createTextNode(value.slice(pos,match.index)));const url=safeURL(match[2]);if(url){const a=node('a','',match[1]);const u=new URL(url);a.href=u.origin===location.origin?u.pathname+u.search+u.hash:url;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);}else parent.append(document.createTextNode(match[0]));pos=rx.lastIndex;}parent.append(document.createTextNode(value.slice(pos)));}
  function body(parent,blocks){for(const block of Array.isArray(blocks)?blocks:[]){if(!block||typeof block!=='object')continue;let e;if(block.type==='image'){const url=safeURL(block.src,true);if(!url)continue;e=node('figure');const img=node('img');img.src=url;img.alt=String(block.alt||'');img.loading='lazy';img.decoding='async';img.addEventListener('error',()=>{const f=node('div','nu-image-error','Изображение пока недоступно');img.replaceWith(f);},{once:true});e.append(img);}else if(block.type==='list'){e=node('ol');for(const text of Array.isArray(block.items)?block.items:[]){const li=node('li');rich(li,text);e.append(li);}}else{const tag=block.type==='heading'?'h3':block.type==='warning'?'blockquote':'p';e=node(tag,block.type==='fine'?'nu-fine':'');rich(e,block.text);}parent.append(e);}}
  function button(text,fn,cls=''){const b=node('button',cls,text);b.type='button';b.addEventListener('click',fn);return b;}
  function scrollTop(){options.scrollElement?.scrollTo({top:0,behavior:'instant'});}
  function leaveEditor(){return !dirty||confirm('Выйти без сохранения изменений новости?');}
  function list(){view='list';selected=null;draft=null;dirty=false;area.replaceChildren();if(admin){const actions=node('div','nu-actions');actions.append(button('+ Добавить новость',()=>edit(null)));area.append(actions);}
    if(!records.length){area.append(node('p','nu-help',loaded?'Новостей пока нет.':'Загрузка новостей…'));return;}
    for(const n of records){const row=button('',()=>article(n),'nu-list-row'+(read.has(n.id)?' nu-read':''));const dot=node('span','nu-dot');dot.setAttribute('aria-hidden','true');const text=node('span');text.append(node('span','nu-row-title',n.title||'Без заголовка'));text.append(node('span','nu-row-meta',`${dateText(n.date)}, ${n.author||'barsa'}`));if(!n.published)text.append(node('span','nu-draft','Черновик'));const arrow=node('span','nu-arrow','›');arrow.setAttribute('aria-hidden','true');row.append(dot,text,arrow);area.append(row);}badge();}
  function article(n,preview=false){view=preview?'preview':'article';selected=n;area.replaceChildren();const actions=node('div','nu-actions');actions.append(button(preview?'← К редактированию':'← Все новости',()=>{if(preview)editor();else{list();scrollTop();}},'nu-link'));if(admin&&!preview)actions.append(button('Редактировать',()=>edit(n),'nu-link'));area.append(actions);const article=node('article','nu-article');const title=node('h2','nu-title',n.title||'Без заголовка');article.append(title,node('div','nu-meta',`${dateText(n.date)}, ${n.author||'barsa'}${n.published?'':' — Черновик'}`));const content=node('div','nu-body');body(content,n.blocks);article.append(content);area.append(article);if(n.published&&!preview){read.add(n.id);saveLocal();badge();}scrollTop();}
  function field(label,value,type='text'){const l=node('label','',label),input=node('input');input.type=type;input.value=value||'';l.append(input);return{label:l,input};}
  function edit(n){view='edit';draft=JSON.parse(JSON.stringify(n||{title:'',author:'barsa',date:new Date().toLocaleDateString('sv-SE'),published:false,blocks:[]}));if(!draft.blocks)draft.blocks=[];dirty=false;editor();scrollTop();}
  function editor(){view='edit';area.replaceChildren();const actions=node('div','nu-actions');actions.append(button('← Все новости',()=>{if(leaveEditor()){list();scrollTop();}},'nu-link'));area.append(actions,node('h2','nu-title',draft.id?'Редактирование новости':'Новая новость'));
    const form=node('div','nu-form');const title=field('Заголовок',draft.title);title.input.maxLength=200;title.input.addEventListener('input',()=>{draft.title=title.input.value;dirty=true;});form.append(title.label);
    const fields=node('div','nu-fields'),author=field('Автор',draft.author),date=field('Дата',draft.date,'date');author.input.maxLength=60;author.input.addEventListener('input',()=>{draft.author=author.input.value;dirty=true;});date.input.addEventListener('input',()=>{draft.date=date.input.value;dirty=true;});fields.append(author.label,date.label);form.append(fields);area.append(form);
    const help=node('div','nu-help nu-editor-help');
    help.append(node('div','','Ссылка в тексте:'));
    help.append(node('code','','[текст ссылки](https://адрес)'));
    help.append(node('div','','Например: [Tampermonkey](https://www.tampermonkey.net/)'));
    help.append(node('div','','Картинки: images/news/имя.png. Один пункт списка — одна строка.'));
    area.append(help);
    const blocks=node('div');area.append(blocks);
    draft.blocks.forEach((block,index)=>{const box=node('div','nu-block'),top=node('div','nu-block-top'),select=node('select');for(const [value,label]of types){const option=node('option','',label);option.value=value;select.append(option);}select.value=block.type;select.addEventListener('change',()=>{draft.blocks[index]={type:select.value,...(select.value==='image'?{src:'',alt:''}:select.value==='list'?{items:[]}:{text:''})};dirty=true;editor();});top.append(select);
      const up=button('↑',()=>{[draft.blocks[index-1],draft.blocks[index]]=[draft.blocks[index],draft.blocks[index-1]];dirty=true;editor();});up.disabled=index===0;up.title='Выше';const down=button('↓',()=>{[draft.blocks[index+1],draft.blocks[index]]=[draft.blocks[index],draft.blocks[index+1]];dirty=true;editor();});down.disabled=index===draft.blocks.length-1;down.title='Ниже';top.append(up,down,button('×',()=>{draft.blocks.splice(index,1);dirty=true;editor();},'nu-danger'));box.append(top);
      if(block.type==='image'){const src=field('Путь к картинке',block.src),alt=field('Описание картинки',block.alt);src.input.addEventListener('input',()=>{block.src=src.input.value;dirty=true;});alt.input.addEventListener('input',()=>{block.alt=alt.input.value;dirty=true;});box.append(src.label,alt.label);}else{const input=node('textarea');input.value=block.type==='list'?(block.items||[]).join('\n'):block.text||'';input.addEventListener('input',()=>{if(block.type==='list')block.items=input.value.split('\n');else block.text=input.value;dirty=true;});box.append(input);}blocks.append(box);});
    const add=node('div','nu-actions');for(const [type,label]of types)add.append(button('+ '+label,()=>{draft.blocks.push({type,...(type==='image'?{src:'',alt:''}:type==='list'?{items:[]}:{text:''})});dirty=true;editor();}));area.append(add);
    const actionsEnd=node('div','nu-actions end');actionsEnd.append(button('Предпросмотр',()=>article(draft,true)),button('Сохранить черновик',()=>save(false)),button('Опубликовать',()=>save(true),'nu-publish'));if(draft.id){actionsEnd.append(button('Удалить',remove,'nu-danger'));}area.append(actionsEnd);}
  function validate(n){if(!String(n.title||'').trim())throw new Error('Введите заголовок.');if(!String(n.author||'').trim())throw new Error('Укажите автора.');if(!/^\d{4}-\d{2}-\d{2}$/.test(n.date||''))throw new Error('Укажите дату.');if(!n.blocks.length)throw new Error('Добавьте содержимое новости.');if(n.blocks.length>100)throw new Error('Не больше 100 блоков в новости.');for(const b of n.blocks){if(!types.some(([t])=>t===b.type))throw new Error('Неизвестный блок.');if(b.type==='image'&&!safeURL(b.src,true))throw new Error('Для картинки нужен HTTPS-адрес вашего сайта или путь images/…');}if(JSON.stringify(n).length>200000)throw new Error('Слишком большая новость.');}
  async function save(published){if(busy||!admin)return;try{validate(draft);}catch(e){message(e.message,true);scrollTop();return;}busy=true;container.setAttribute('aria-busy','true');area.querySelectorAll('button').forEach(b=>b.disabled=true);message('Сохранение…');try{const now=Date.now(),id=draft.id||crypto.randomUUID(),payload={title:draft.title.trim(),author:draft.author.trim(),date:draft.date,published,blocks:JSON.parse(JSON.stringify(draft.blocks)),createdAt:Number(draft.createdAt)||now,updatedAt:now,schemaVersion:1};await driver.save(id,payload);dirty=false;draft=null;view='list';message('Новость сохранена.');await refresh(false);}catch(e){message('Не удалось сохранить: '+e.message,true);editor();}finally{busy=false;container.removeAttribute('aria-busy');if(view==='list')acceptRecords(records);}}
  async function remove(){if(busy||!admin||!draft?.id)return;if(!confirm('Удалить эту новость без возможности восстановления?'))return;busy=true;try{await driver.remove(draft.id);dirty=false;draft=null;view='list';await refresh(false);}catch(e){message('Не удалось удалить: '+e.message,true);}finally{busy=false;}}
  function acceptRecords(values){
    records=values.filter(n=>admin||n.published===true).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||Number(b.createdAt||0)-Number(a.createdAt||0));
    loaded=true;
    if(!busy)message();
    badge();
    // События из базы обновляют список и счётчик, но не трогают редактор.
    if(busy||view==='edit'||view==='preview')return;
    const position=options.scrollElement?.scrollTop||0;
    if(view==='list'){
      list();
      if(options.scrollElement)options.scrollElement.scrollTop=position;
    }else if(view==='article'){
      const fresh=records.find(n=>n.id===selected?.id);
      if(!fresh){list();scrollTop();}
      else if(JSON.stringify(fresh)!==JSON.stringify(selected)){
        article(fresh);
        if(options.scrollElement)options.scrollElement.scrollTop=position;
      }
    }
  }
  function stopWatching(){
    loadSequence++;
    if(unsubscribeNews){unsubscribeNews();unsubscribeNews=null;}
  }
  function startWatching(){
    if(unsubscribeNews)return;
    const sequence=++loadSequence,requestedAdmin=admin;
    if(!loaded)message('Загрузка новостей…');
    try{
      unsubscribeNews=driver.watch(requestedAdmin,values=>{
        if(sequence!==loadSequence||requestedAdmin!==admin)return;
        acceptRecords(values);
      },error=>{
        if(sequence!==loadSequence)return;
        unsubscribeNews=null;
        message('Не удалось подключить новости: '+error.message+(loaded?'\nПоказаны ранее загруженные записи.':''),true);
      });
    }catch(error){
      unsubscribeNews=null;
      message('Не удалось подключить новости: '+error.message,true);
    }
  }
  async function refresh(){
    const watching=!!unsubscribeNews;
    startWatching();
    if(watching&&driver.refresh)await driver.refresh();
    if(loaded)acceptRecords(records);
  }
  async function open(){
    readLocal();
    if(!dirty){list();scrollTop();}
    badge();
    startWatching();
  }
  function setAdmin(value){
    if(admin===value)return;
    stopWatching();
    admin=value;records=[];loaded=false;view='list';draft=null;selected=null;dirty=false;
    list();badge();startWatching();
  }
  window.addEventListener('online',()=>startWatching());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)startWatching();});
  window.addEventListener('storage',e=>{if(e.key===READ_KEY||e.key===null){read=new Set();readLocal();badge();if(view==='list')list();}});
  readLocal();list();
  return{open,refresh,setAdmin,canLeave:leaveEditor,initialize:startWatching};
}


globalThis.OVNIShared=Object.freeze({version:'1.0.0',layoutBlocks,publicCardVisible,localImageUrls,decodeFirestoreDocument,createNewsUI});
})();

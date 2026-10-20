const fs=require('node:fs'),cp=require('node:child_process');
const parser=require(process.env.TEMP+'/capstone-ui-review/node_modules/@babel/parser');
const files=cp.execFileSync('git',['diff','--name-only','--','src/app/components'],{encoding:'utf8',stdio:['pipe','pipe','ignore']}).trim().split(/\r?\n/).filter(x=>x.endsWith('.jsx'));
function clean(node){
 if(Array.isArray(node))return node.filter(x=>!(x?.type==='JSXAttribute'&&x.name?.name==='className')).map(clean);
 if(!node||typeof node!=='object')return node;
 if(node.type==='StringLiteral'&&/(?:^|\s)(?:rounded-|min-w-|grid |flex |text-|space-y-|bg-)/.test(node.value))return {type:'CSSUtilityString'};
 if(node.type==='TemplateElement'&&/(?:^|\s)(?:rounded-|min-w-|grid |flex |text-|space-y-|bg-)/.test(node.value.raw))return {type:'CSSUtilityTemplate',tail:node.tail};
 return Object.fromEntries(Object.entries(node).filter(([k])=>!['start','end','loc','extra','comments','leadingComments','trailingComments','innerComments','tokens'].includes(k)).map(([k,v])=>[k,clean(v)]));
}
const mismatches=[];
for(const file of files){const before=cp.execFileSync('git',['show','HEAD:'+file],{encoding:'utf8'});const after=fs.readFileSync(file,'utf8');const parse=s=>JSON.stringify(clean(parser.parse(s,{sourceType:'module',plugins:['jsx']})));if(parse(before)!==parse(after))mismatches.push(file);}
console.log(JSON.stringify({componentsReviewed:files.length,nonStylingChanges:mismatches}));

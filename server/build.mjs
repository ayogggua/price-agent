import {transform} from 'esbuild';
import fs from 'node:fs/promises';
await fs.mkdir('client/build',{recursive:true});
const files=[['components','designs/quote-input/components.jsx'],['form','designs/quote-input/app.jsx'],...['shared','project','quote','libraries','platform'].map(name=>[name,'client/'+name+'.jsx'])];
for(const [name,file] of files){const {code}=await transform(await fs.readFile(file,'utf8'),{loader:'jsx',format:'iife',target:'es2020',minify:true,legalComments:'none'});await fs.writeFile('client/build/'+name+'.js',code);}
console.log('报价页面已构建');

/** API routing only. Authentication is performed by real GoTrue; financial
 * requests go unchanged to real PostgREST/RLS. No auth/storage emulation. */
import http from 'node:http';
import {state} from './local-stack.mjs';
const s=await state();
http.createServer((req,res)=>{
 if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':s.app,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS'});return res.end();}
 if(![s.anon,s.service].includes(req.headers.apikey)){res.writeHead(401,{'content-type':'application/json'});return res.end('{"message":"Local certification API key required"}');}
 const auth=req.url.startsWith('/auth/v1/'),rest=req.url.startsWith('/rest/v1/');
 if(!auth&&!rest){res.writeHead(501);return res.end('Only real Auth and REST are covered by this local stack');}
 const headers={...req.headers,host:`127.0.0.1:${auth?54327:54326}`};
 if(rest&&!headers.authorization)headers.authorization=`Bearer ${s.anon}`;
 const upstream=http.request({host:'127.0.0.1',port:auth?54327:54326,path:req.url.replace(auth?'/auth/v1':'/rest/v1',''),method:req.method,headers},r=>{res.writeHead(r.statusCode,{...r.headers,'access-control-allow-origin':s.app});r.pipe(res);});
 upstream.on('error',()=>{res.writeHead(502);res.end('Local certification service unavailable');});req.pipe(upstream);
}).listen(54329,'127.0.0.1',()=>console.log('Local certification API bound to loopback:54329; real GoTrue and PostgREST'));

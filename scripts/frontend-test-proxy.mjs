import http from 'node:http';import fs from 'node:fs';
// Test-only proxy. Both listeners and the upstream are restricted to loopback.
const rulesFile=process.env.FRONTEND_TEST_FAULT_FILE??'work/frontend/faults.json';
http.createServer(async(req,res)=>{
  const chunks=[];for await(const b of req)chunks.push(b);const body=Buffer.concat(chunks);
  let rules=[];try{rules=JSON.parse(fs.readFileSync(rulesFile));}catch{}
  const rule=rules.find(r=>req.url.includes(r.path)&&(!r.method||r.method===req.method)&&r.remaining>0);
  if(rule){rule.remaining--;fs.writeFileSync(rulesFile,JSON.stringify(rules));}
  if(rule?.mode==='error'){res.writeHead(503,{'content-type':'application/json','access-control-allow-origin':'*'});return res.end(JSON.stringify({code:'TEST',message:rule.message??'Synthetic service temporarily unavailable'}));}
  const upstream=http.request('http://127.0.0.1:55431'+req.url,{method:req.method,headers:{...req.headers,host:'127.0.0.1:55431'}},up=>{
    if(rule?.mode==='lost'){
      up.resume();up.on('end',()=>{res.writeHead(502,{'content-type':'application/json','access-control-allow-origin':'*'});res.end(JSON.stringify({message:'Network response lost'}));});
    }else{res.writeHead(up.statusCode,up.headers);up.pipe(res);}
  });upstream.on('error',()=>{res.writeHead(502);res.end();});upstream.end(body);
}).listen(55429,'127.0.0.1');

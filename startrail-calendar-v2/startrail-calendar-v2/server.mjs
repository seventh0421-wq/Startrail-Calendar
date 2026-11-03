// Local development server; npm install first and set .env.local with admin credentials.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {POST} from './api/route.js';
const port=Number(process.env.PORT||3000),base=resolve('public');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
createServer(async(req,res)=>{
  if(req.url?.split('?')[0]==='/api/route'){
    const buffers=[];for await(const chunk of req)buffers.push(chunk);
    const request=new Request(`http://localhost:${port}/api/route`,{method:req.method||'POST',headers:req.headers,body:Buffer.concat(buffers)});
    const response=await POST(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  const location=new URL(req.url||'/',`http://localhost:${port}`);
  const f=resolve(base,'.'+decodeURIComponent(location.pathname==='/'?'/index.html':location.pathname));
  if(!f.startsWith(base+sep)){res.writeHead(403);res.end('Forbidden');return;}
  try{if(!(await stat(f)).isFile())throw Error('not file');res.writeHead(200,{'Content-Type':types[extname(f)]||'application/octet-stream'});res.end(await readFile(f));}
  catch{res.writeHead(404);res.end('Not found')}
}).listen(port,()=>console.log(`Startrail local preview: http://localhost:${port}`));

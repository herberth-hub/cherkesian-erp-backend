const http=require('http'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'public');
const mimes={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png'};
http.createServer((q,s)=>{let f=decodeURIComponent(q.url.split('?')[0]);if(f==='/')f='/index.html';const fp=path.join(root,f);fs.readFile(fp,(e,d)=>{if(e){s.writeHead(404);s.end('nf');return;}s.writeHead(200,{'Content-Type':mimes[path.extname(fp)]||'application/octet-stream'});s.end(d);});}).listen(8099,()=>console.log('on 8099'));
